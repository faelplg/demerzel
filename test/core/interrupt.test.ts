import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { close, collect, dispatch, resume, status } from "../../src/core/index.ts";
import { workspaceLabel } from "../../src/core/commands/common.ts";
import { FakeBackend } from "../../src/core/fake-backend.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { spawnChild } from "./helpers/processes.ts";
import { context, sandbox, task, writeReport, type Sandbox } from "./helpers/sandbox.ts";

let sb: Sandbox;
let stateFile: string;
beforeEach(() => {
  sb = sandbox();
  stateFile = join(sb.root, "fake-backend.json");
  new FakeBackend(sb.env, { stateFile });
});
afterEach(() => sb.cleanup());

function record(id = "TC-0099.1"): TaskRecord {
  return JSON.parse(readFileSync(join(resolveProject(sb.repo, sb.env)?.dir ?? "", "tasks", `${id}.json`), "utf8")) as TaskRecord;
}

function kinds(r: TaskRecord): string[] {
  return r.created.map((c): string => c.kind).sort();
}

type Expectation = { lifecycle: TaskRecord["lifecycle"]; created: string[]; requestSent: TaskRecord["request_sent"] };

const SESSION = ["workspace", "tab", "pane"];
const ALL = ["worktree", ...SESSION, "agent"];
const lf = (created: string[]): Expectation => ({ lifecycle: "launch-failed", created, requestSent: false });

// Every point of the write order of Spec 2.3, in the order of each mode.
const CASES: Record<string, Array<[string, Expectation]>> = {
  codex: [
    ["wrote:recorded", lf([])],
    ["wrote:launching", lf([])],
    ["wrote:created:worktree", lf(["worktree"])],
    ["wrote:created:workspace", lf(["worktree", ...SESSION])],
    ["wrote:created:tab", lf(["worktree", ...SESSION])],
    ["wrote:created:pane", lf(["worktree", ...SESSION])],
    ["wrote:created:agent", { lifecycle: "launched", created: ALL, requestSent: false }],
    ["wrote:send-started", { lifecycle: "launched", created: ALL, requestSent: "unknown" }],
  ],
  "claude-code": [
    ["wrote:recorded", lf([])],
    ["wrote:launching", lf([])],
    ["wrote:created:workspace", lf(SESSION)],
    ["wrote:created:tab", lf(SESSION)],
    ["wrote:created:pane", lf(SESSION)],
    ["wrote:created:worktree", lf(["worktree", ...SESSION])],
    ["wrote:created:agent", { lifecycle: "launched", created: ALL, requestSent: false }],
    ["wrote:send-started", { lifecycle: "launched", created: ALL, requestSent: "unknown" }],
  ],
};

async function interrupt(point: string, harness = "codex"): Promise<void> {
  const child = spawnChild(sb, stateFile, { name: "k", command: "dispatch", input: task({ harness }), killOn: point });
  await child.proc.exited;
  expect(child.proc.signalCode).toBe("SIGKILL");
}

describe("interrupted dispatch and its recovery (R6, R7)", () => {
  for (const [harness, cases] of Object.entries(CASES)) {
    for (const [point, want] of cases) {
      // Protects: a dispatch killed at this point leaves a registry the next
      // lock holder recovers with every resource that exists, without
      // relaunching or resending. Fails if a write lands after its effect,
      // a resource is dropped, or recovery guesses wrong.
      test(`${harness}: killed after ${point}`, async () => {
        await interrupt(point, harness);
        expect(record().lifecycle).not.toBe("launched");

        const be = new FakeBackend(sb.env, { stateFile });
        const ctx = context(sb, be);
        const before = await status({ ids: ["TC-0099.1"], all: false }, ctx);
        expect(before.code).toBe(1);
        expect(before.envelope.tasks[0]?.interrupted).toBe(true);

        const effectsBefore = be.effectCalls().length;
        const next = await dispatch({ task: task({ id: "TC-0099.2", writes: ["other/"] }), humanApproved: false }, ctx);
        expect(next.code).toBe(0);

        const recovered = record();
        expect(recovered.lifecycle).toBe(want.lifecycle);
        expect(kinds(recovered)).toEqual([...want.created].sort());
        expect(recovered.request_sent).toBe(want.requestSent);
        expect(recovered.history.at(-1)?.detail?.["reason"]).toBe("interrupted");
        const newEffects = be.effectCalls().slice(effectsBefore);
        expect(newEffects.filter((c) => c.args["task"] === "TC-0099.1" || c.args["agent"] === recovered.agent_name)).toEqual([]);
      });
    }
  }

  // Protects: resume and close also recover before acting. Fails if only
  // dispatch recovers.
  test("resume recovers, then sends the request once", async () => {
    await interrupt("wrote:created:agent");
    const be = new FakeBackend(sb.env, { stateFile });
    const r = await resume("TC-0099.1", context(sb, be));
    expect(r.code).toBe(0);
    expect(record().history.some((h) => h.detail?.["reason"] === "interrupted")).toBe(true);
    expect(be.effectCalls().filter((c) => c.op === "send")).toHaveLength(1);
  });

  test("close recovers, then closes what exists", async () => {
    await interrupt("wrote:created:pane");
    const be = new FakeBackend(sb.env, { stateFile });
    const x = await close({ id: "TC-0099.1", discardWorktree: false }, context(sb, be));
    expect(x.code).toBe(0);
    expect(record().lifecycle).toBe("closed");
    expect(be.effectCalls().filter((c) => c.op === "closeWorkspace")).toHaveLength(1);
    expect(be.snapshotNow().workspaces).toEqual([]);
  });

  // Protects: a refusal leaves every task file as it was, also when an
  // interrupted task is waiting for recovery (Spec 5). Fails if recovery is
  // written before the refusal.
  test("task-exists after an interrupted dispatch changes no task file", async () => {
    await interrupt("wrote:recorded");
    const be = new FakeBackend(sb.env, { stateFile });
    const before = sb.tasksSnapshot();
    const again = await dispatch({ task: task(), humanApproved: false }, context(sb, be));
    expect(again.envelope.refusal?.code).toBe("task-exists");
    expect(sb.tasksSnapshot()).toEqual(before);
  });

  // Protects: collect does not recover (Spec 2.3, revision 0.7). Fails if
  // collect touches an interrupted task.
  test("collect leaves an interrupted task intact", async () => {
    const be = new FakeBackend(sb.env, { stateFile, script: { statusAfterSend: "idle" } });
    const ctx = context(sb, be);
    const d = await dispatch({ task: task({ id: "TC-0099.2", writes: ["other/"] }), humanApproved: false }, ctx);
    writeReport(d.envelope.tasks[0]?.worktree ?? "", ".radiant/reports/TC-0099.2.md");
    await interrupt("wrote:launching");
    const interrupted = JSON.stringify(record());
    expect((await collect("TC-0099.2", context(sb, new FakeBackend(sb.env, { stateFile })))).code).toBe(0);
    expect(JSON.stringify(record())).toBe(interrupted);
  });
});

describe("interrupted resume (R16)", () => {
  // Protects: a resume killed after it started sending never lets a later
  // resume send again. Fails if request_sent stays false during the send.
  test("killed after send-started: the next resume refuses", async () => {
    const be = new FakeBackend(sb.env, { stateFile, script: { startup: "blocked" } });
    const ctx = context(sb, be);
    const d = await dispatch({ task: task(), humanApproved: false }, ctx);
    be.setAgentStatus(d.envelope.tasks[0]?.agent_name ?? "", "idle");
    const child = spawnChild(sb, stateFile, { name: "r", command: "resume", input: "TC-0099.1", killOn: "wrote:send-started" });
    await child.proc.exited;
    expect(child.proc.signalCode).toBe("SIGKILL");
    expect(record().request_sent).toBe("unknown");
    const again = await resume("TC-0099.1", context(sb, new FakeBackend(sb.env, { stateFile })));
    expect(again.envelope.refusal?.code).toBe("request-already-sent");
  });
});

describe("status during an active dispatch (emenda 1)", () => {
  // Protects: a dispatch that finishes while status reads the backend is
  // not reported as interrupted. Fails if status classifies stale records.
  test("a dispatch finishing mid-status is not interrupted", async () => {
    const child = spawnChild(sb, stateFile, { name: "a", command: "dispatch", input: task(), holdOn: "wrote:launching" });
    await child.held();
    const real = new FakeBackend(sb.env, { stateFile });
    const racing = Object.create(real) as FakeBackend;
    racing.snapshot = async () => {
      child.go();
      await child.proc.exited;
      return real.snapshot();
    };
    const s = await status({ ids: ["TC-0099.1"], all: false }, context(sb, racing));
    expect(child.result()?.code).toBe(0);
    expect(s.envelope.tasks[0]?.interrupted).toBe(false);
    expect(s.envelope.tasks[0]?.lifecycle).toBe("launched");
  });

  // Protects: with the lock busy, a half-done task is shown as it is and
  // does not count as attention. Fails if status waits or flags it.
  test("a dispatch holding the lock is shown as it is", async () => {
    const child = spawnChild(sb, stateFile, { name: "b", command: "dispatch", input: task(), holdOn: "wrote:launching" });
    await child.held();
    const s = await status({ ids: ["TC-0099.1"], all: false }, context(sb, new FakeBackend(sb.env, { stateFile })));
    child.go();
    await child.proc.exited;
    expect(s.envelope.tasks[0]?.lifecycle).toBe("launching");
    expect(s.envelope.tasks[0]?.interrupted).toBe(false);
    expect(s.code).toBe(0);
  });
});

describe("workspace identity across projects (Spec 2.5, revision 0.8)", () => {
  // Protects: a recorded workspace ID wins over any workspace that shares
  // the label. Fails if recovery looks the label up when the ID is known.
  test("a recorded workspace ID beats a decoy with the same label", async () => {
    await interrupt("wrote:created:workspace");
    const recordedId = record().backend_ids.workspace ?? "missing";
    const be = new FakeBackend(sb.env, { stateFile });
    const decoy = be.addWorkspace(workspaceLabel(record()));
    await close({ id: "TC-0099.1", discardWorktree: false }, context(sb, be));
    expect(record().backend_ids.workspace).toBe(recordedId);
    expect(be.effectCalls().filter((c) => c.op === "closeWorkspace").map((c) => c.args["workspace"])).toEqual([recordedId]);
    expect(be.snapshotNow().workspaces.map((w) => w.id)).toEqual([decoy]);
  });

  // Protects: a recovery that has only the label never takes another
  // project's workspace for the same task ID. Fails if the label goes back
  // to the bare task ID, or a recorded workspace ID is overridden.
  test("two projects with the same task ID", async () => {
    const other = sandbox();
    try {
      const be = new FakeBackend(sb.env, { stateFile });
      const first = await dispatch({ task: task(), humanApproved: false }, context(other, be));
      const firstWorkspace = first.envelope.tasks[0]?.backend_ids.workspace ?? "missing";

      const child = spawnChild(sb, stateFile, { name: "k", command: "dispatch", input: task(), killOn: "wrote:launching" });
      await child.proc.exited;
      const mine = be.addWorkspace(workspaceLabel(record()));

      const x = await close({ id: "TC-0099.1", discardWorktree: false }, context(sb, be));
      expect(x.code).toBe(0);
      expect(record().backend_ids.workspace).toBe(mine);
      const closed = be.effectCalls().filter((c) => c.op === "closeWorkspace").map((c) => c.args["workspace"]);
      expect(closed).toEqual([mine]);
      expect(be.snapshotNow().workspaces.map((w) => w.id)).toEqual([firstWorkspace]);
    } finally {
      other.cleanup();
    }
  });
});
