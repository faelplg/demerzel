import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Probe, SendOutcome, Snapshot } from "../../src/core/backend.ts";
import { BackendError, close, dispatch, resume, status, wait } from "../../src/core/index.ts";
import { FakeBackend, type FakeScript } from "../../src/core/fake-backend.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { context, sandbox, task, type Sandbox } from "./helpers/sandbox.ts";

// TC-0002, output 6: a backend failure in the middle of a command follows the
// Spec 2.3, revision 0.9. Before the first effect it is backend-unavailable
// without effect; after it, the command keeps what it recorded and exits 1.

type Method = "probe" | "snapshot" | "send" | "closeWorkspace" | "launch";

// Throws BackendError on the listed call numbers of each method, counting
// from 1, and otherwise behaves like the fake backend.
class Flaky extends FakeBackend {
  private counts = new Map<Method, number>();
  constructor(sb: Sandbox, private failOn: Partial<Record<Method, number[]>>, script: Partial<FakeScript> = {}, private probeDetail: string | null = null, stateFile?: string) {
    super(sb.env, stateFile === undefined ? { script } : { script, stateFile });
  }
  private hit(method: Method): void {
    const n = (this.counts.get(method) ?? 0) + 1;
    this.counts.set(method, n);
    if (this.failOn[method]?.includes(n)) throw new BackendError(`herdr ${method}`, `falha injetada na chamada ${n}`);
  }
  override async probe(): Promise<Probe> {
    this.hit("probe");
    const probe = await super.probe();
    return this.probeDetail === null ? probe : { ...probe, running: false, detail: this.probeDetail };
  }
  override async snapshot(): Promise<Snapshot> {
    this.hit("snapshot");
    return super.snapshot();
  }
  override async send(agentName: string, text: string): Promise<SendOutcome> {
    this.hit("send");
    return super.send(agentName, text);
  }
  override async closeWorkspace(workspaceId: string): Promise<void> {
    this.hit("closeWorkspace");
    return super.closeWorkspace(workspaceId);
  }
  override async launch(...args: Parameters<FakeBackend["launch"]>) {
    this.hit("launch");
    return super.launch(...args);
  }
}

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

function record(id = "TC-0099.1"): TaskRecord {
  return JSON.parse(readFileSync(join(resolveProject(sb.repo, sb.env)?.dir ?? "", "tasks", `${id}.json`), "utf8")) as TaskRecord;
}

describe("backend failure before the first effect", () => {
  // Protects: a failure between the probe and the snapshot is a refusal
  // without effect, with the backend command in the message. Fails if the
  // exception escapes the envelope or the task file changes.
  test("status, wait, dispatch, resume and close refuse with backend-unavailable", async () => {
    const be = new Flaky(sb, {}, { statusAfterSend: "idle" });
    await dispatch({ task: task(), humanApproved: false }, context(sb, be));
    const before = sb.tasksSnapshot();

    const cases: Array<[string, () => Promise<{ code: number; envelope: { refusal: { code: string; message: string } | null } }>]> = [
      ["status", () => status({ ids: [], all: false }, context(sb, new Flaky(sb, { snapshot: [1] })))],
      ["wait", () => wait({ ids: ["TC-0099.1"], timeoutMs: 1000 }, context(sb, new Flaky(sb, { snapshot: [1] })))],
      ["dispatch", () => dispatch({ task: task({ id: "TC-0099.2", writes: ["b/"] }), humanApproved: false }, context(sb, new Flaky(sb, { snapshot: [1] })))],
      ["resume", () => resume("TC-0099.1", context(sb, new Flaky(sb, { snapshot: [1] })))],
      ["close", () => close({ id: "TC-0099.1", discardWorktree: false }, context(sb, new Flaky(sb, { snapshot: [1] })))],
    ];
    for (const [name, act] of cases) {
      const outcome = await act();
      expect(outcome.code, name).toBe(2);
      expect(outcome.envelope.refusal?.code, name).toBe("backend-unavailable");
      expect(outcome.envelope.refusal?.message, name).toContain("herdr snapshot: falha injetada na chamada 1");
      expect(sb.tasksSnapshot(), name).toEqual(before);
    }
  });

  // Protects: a wait that already ran a cycle refuses when a later snapshot
  // fails. Fails if wait hides the failure as an agent state.
  test("wait refuses when a later cycle fails", async () => {
    const stateFile = join(sb.root, "fake.json");
    await dispatch({ task: task(), humanApproved: false }, context(sb, new FakeBackend(sb.env, { stateFile })));
    const w = await wait({ ids: ["TC-0099.1"], timeoutMs: null }, context(sb, new Flaky(sb, { snapshot: [2] }, {}, null, stateFile), { sleep: async () => {} }));
    expect(w.code).toBe(2);
    expect(w.envelope.refusal?.message).toContain("herdr snapshot");
  });

  // Protects: a probe that throws, and a probe that explains why the backend
  // is down, both reach the message. Fails if the detail is dropped.
  test("the probe's error and detail reach the refusal", async () => {
    const thrown = await status({ ids: [], all: false }, context(sb, new Flaky(sb, { probe: [1] })));
    expect(thrown.envelope.refusal?.message).toContain("herdr probe: falha injetada na chamada 1");
    const said = await status({ ids: [], all: false }, context(sb, new Flaky(sb, {}, {}, "servidor parado na sessão dz-test")));
    expect(said.envelope.refusal?.code).toBe("backend-unavailable");
    expect(said.envelope.refusal?.message).toContain("servidor parado na sessão dz-test");
  });
});

describe("backend failure after the first effect", () => {
  // Protects: a launch that throws ends in launch-failed with the backend
  // command in the reason. Fails if the reason loses the command.
  test("launch throwing", async () => {
    const d = await dispatch({ task: task(), humanApproved: false }, context(sb, new Flaky(sb, { launch: [1] })));
    expect(d.code).toBe(1);
    expect(record().lifecycle).toBe("launch-failed");
    expect(String(record().history.at(-1)?.detail?.["reason"])).toContain("herdr launch: falha injetada");
  });

  // Protects: a send that throws leaves request_sent unknown, keeps the
  // backend error in the history, and exits 1. Fails if it is recorded as
  // sent or not sent.
  test("send throwing in dispatch and in resume", async () => {
    const d = await dispatch({ task: task(), humanApproved: false }, context(sb, new Flaky(sb, { send: [1] })));
    expect(d.code).toBe(1);
    expect(record().request_sent).toBe("unknown");
    expect(String(record().history.at(-1)?.detail?.["backend_error"])).toContain("herdr send");

    const be = new Flaky(sb, { send: [1] }, { startup: "blocked" });
    const b = await dispatch({ task: task({ id: "TC-0099.2", writes: ["b/"] }), humanApproved: false }, context(sb, be));
    be.setAgentStatus(b.envelope.tasks[0]?.agent_name ?? "", "idle");
    const r = await resume("TC-0099.2", context(sb, be));
    expect(r.code).toBe(1);
    expect(record("TC-0099.2").request_sent).toBe("unknown");
  });

  // Protects: a snapshot that fails after a confirmed send keeps the task
  // launched and sent, observes the agent as unknown and exits 1. Fails if
  // the failure throws after the effect or exits 0.
  test("snapshot failing after the send", async () => {
    const d = await dispatch({ task: task(), humanApproved: false }, context(sb, new Flaky(sb, { snapshot: [2] })));
    expect(d.code).toBe(1);
    expect(record().lifecycle).toBe("launched");
    expect(record().request_sent).toBe(true);
    expect(d.envelope.tasks[0]?.agent).toBe("unknown");
    expect(d.envelope.tasks[0]?.backend_error).toContain("herdr snapshot: falha injetada na chamada 2");
  });

  // Protects: a close whose backend call fails keeps the lifecycle, records
  // the failure and exits 1. Fails if the task is marked closed anyway.
  test("closeWorkspace throwing", async () => {
    const be = new Flaky(sb, { closeWorkspace: [1] }, { statusAfterSend: "idle" });
    await dispatch({ task: task(), humanApproved: false }, context(sb, be));
    const x = await close({ id: "TC-0099.1", discardWorktree: false }, context(sb, be));
    expect(x.code).toBe(1);
    expect(x.envelope.tasks[0]?.agent).toBe("unknown");
    expect(record().lifecycle).toBe("launched");
    expect(record().history.at(-1)?.event).toBe("close-failed");
    expect(String(record().history.at(-1)?.detail?.["backend_error"])).toContain("herdr closeWorkspace");
  });
});
