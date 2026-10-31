import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collect, close, dispatch, resume, status, wait } from "../../src/core/index.ts";
import type { FakeBackend } from "../../src/core/fake-backend.ts";
import { git } from "../../src/core/git.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { backend, context, sandbox, task, writeReport, type Sandbox } from "./helpers/sandbox.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

const REPORT = ".radiant/reports/TC-0099.1.md";

function record(id = "TC-0099.1"): TaskRecord {
  return JSON.parse(readFileSync(join(resolveProject(sb.repo, sb.env)?.dir ?? "", "tasks", `${id}.json`), "utf8")) as TaskRecord;
}

async function launched(be: FakeBackend, humanApproved = false) {
  const ctx = context(sb, be);
  const d = await dispatch({ task: task(), humanApproved }, ctx);
  const t = d.envelope.tasks[0];
  if (t === undefined) throw new Error("no task");
  return { ctx, t };
}

describe("observed state in two fields (R10)", () => {
  // Protects: a report present with the agent still working lets wait
  // return and still blocks close. Fails if `report` hides `agent`.
  test("report present and agent working: wait returns, close refuses", async () => {
    const be = backend(sb);
    const { ctx, t } = await launched(be);
    writeReport(t.worktree, REPORT);
    const w = await wait({ ids: [t.id], timeoutMs: 1000 }, ctx);
    expect(w.code).toBe(0);
    expect(w.envelope.tasks[0]?.agent).toBe("working");
    expect(w.envelope.tasks[0]?.report).toBe("present");
    const x = await close({ id: t.id, discardWorktree: false }, ctx);
    expect(x.envelope.refusal?.code).toBe("task-working");
  });

  // Protects: the two fields stay independent for every agent state. Fails
  // if a present report masks lost or blocked.
  for (const [agent, act] of [["lost", (be: FakeBackend, name: string) => be.dropAgent(name)], ["blocked", (be: FakeBackend, name: string) => be.setAgentStatus(name, "blocked")]] as const) {
    test(`report present with agent ${agent}`, async () => {
      const be = backend(sb);
      const { ctx, t } = await launched(be);
      writeReport(t.worktree, REPORT);
      act(be, t.agent_name);
      const s = await status({ ids: [t.id], all: false }, ctx);
      expect(s.envelope.tasks[0]?.agent).toBe(agent);
      expect(s.envelope.tasks[0]?.report).toBe("present");
      expect(s.code).toBe(1);
    });
  }

  // Protects: wait stops when the agent turns unknown, and times out on the
  // injected clock. Fails if wait spins forever on a silent agent.
  test("wait stops on unknown and times out otherwise", async () => {
    const be = backend(sb);
    const { ctx, t } = await launched(be);
    let fake = 0;
    const timed = { ...ctx, now: () => fake, sleep: async (ms: number) => { fake += ms; } };
    const w1 = await wait({ ids: [t.id], timeoutMs: 100 }, timed);
    expect(w1.code).toBe(1);
    expect(w1.envelope.tasks[0]?.agent).toBe("working");
    be.setAgentStatus(t.agent_name, "unknown");
    const w2 = await wait({ ids: [t.id], timeoutMs: null }, timed);
    expect(w2.code).toBe(1);
    expect(w2.envelope.tasks[0]?.agent).toBe("unknown");
  });
});

describe("command matrix of Spec 4 (R14)", () => {
  // Protects: each command accepts only the lifecycles of its row. Fails if
  // a command acts on a lifecycle the matrix refuses.
  test("resume: accepts only launched with request_sent false", async () => {
    const be = backend(sb, { startup: "blocked", failAfter: null });
    const { ctx, t } = await launched(be);
    be.setAgentStatus(t.agent_name, "idle");
    expect((await resume(t.id, ctx)).code).toBe(0);
    expect((await resume(t.id, ctx)).envelope.refusal?.code).toBe("request-already-sent");
  });

  test("resume on unknown request_sent is refused", async () => {
    const be = backend(sb, { send: "unknown" });
    const { ctx, t } = await launched(be);
    expect(record().request_sent).toBe("unknown");
    expect((await resume(t.id, ctx)).envelope.refusal?.code).toBe("request-already-sent");
  });

  test("resume, wait, collect refuse launch-failed", async () => {
    const be = backend(sb, { failAfter: "worktree" });
    const { ctx, t } = await launched(be);
    expect(t.lifecycle).toBe("launch-failed");
    expect((await resume(t.id, ctx)).envelope.refusal?.code).toBe("wrong-lifecycle");
    expect((await wait({ ids: [t.id], timeoutMs: 10 }, ctx)).envelope.refusal?.code).toBe("wrong-lifecycle");
    expect((await collect(t.id, ctx)).envelope.refusal?.code).toBe("wrong-lifecycle");
  });

  test("close accepts launch-failed and closes the workspace it created", async () => {
    const be = backend(sb, { failAfter: "workspace" });
    const { ctx, t } = await launched(be);
    const x = await close({ id: t.id, discardWorktree: false }, ctx);
    expect(x.code).toBe(0);
    expect(be.effectCalls().map((c) => c.op)).toEqual(["launch", "closeWorkspace"]);
  });

  test("collect works on launched and collected and reports a changed digest", async () => {
    const be = backend(sb);
    const { ctx, t } = await launched(be);
    expect((await collect(t.id, ctx)).code).toBe(1);
    writeReport(t.worktree, REPORT, "um\n");
    const first = await collect(t.id, ctx);
    expect(first.envelope.tasks[0]?.collected?.digest_changed).toBe(false);
    writeReport(t.worktree, REPORT, "dois\n");
    const second = await collect(t.id, ctx);
    expect(second.envelope.tasks[0]?.lifecycle).toBe("collected");
    expect(second.envelope.tasks[0]?.collected?.digest_changed).toBe(true);
    expect(be.effectCalls().filter((c) => c.op !== "launch" && c.op !== "send")).toEqual([]);
  });

  test("collect does not talk to the backend", async () => {
    const be = backend(sb);
    const { ctx, t } = await launched(be);
    writeReport(t.worktree, REPORT);
    be.script({ running: false });
    const callsBefore = be.calls.length;
    const c = await collect(t.id, ctx);
    expect(c.code).toBe(0);
    expect(c.envelope.tasks[0]?.agent).toBeNull();
    expect(be.calls.length).toBe(callsBefore);
  });

  test("close twice: the second is wrong-lifecycle", async () => {
    const be = backend(sb, { statusAfterSend: "idle" });
    const { ctx, t } = await launched(be);
    expect((await close({ id: t.id, discardWorktree: false }, ctx)).code).toBe(0);
    expect((await close({ id: t.id, discardWorktree: false }, ctx)).envelope.refusal?.code).toBe("wrong-lifecycle");
  });

  // Protects: --discard-worktree never forces; a refused removal leaves the
  // worktree, exits 1, and can be repeated on the closed task without the
  // backend. Fails if the discard uses --force or deletes the branch.
  test("discard refused with changes, then repeated after cleanup", async () => {
    const be = backend(sb, { statusAfterSend: "idle" });
    const { ctx, t } = await launched(be);
    writeFileSync(join(t.worktree, "untracked.txt"), "trabalho\n");
    const x = await close({ id: t.id, discardWorktree: true }, ctx);
    expect(x.code).toBe(1);
    expect(x.envelope.tasks[0]?.lifecycle).toBe("closed");
    expect(x.envelope.tasks[0]?.discard?.removed).toBe(false);
    expect(existsSync(t.worktree)).toBe(true);

    git(t.worktree, ["clean", "-fdq"], sb.env);
    be.script({ running: false });
    const again = await close({ id: t.id, discardWorktree: true }, ctx);
    expect(again.code).toBe(0);
    expect(existsSync(t.worktree)).toBe(false);
    expect(git(sb.repo, ["show-ref", "--verify", "--quiet", `refs/heads/${t.branch}`], sb.env).code).toBe(0);
    expect((await close({ id: t.id, discardWorktree: true }, ctx)).envelope.refusal?.code).toBe("wrong-lifecycle");
  });

  // Protects: every command that talks to the backend refuses a stopped
  // backend. Fails if one acts on a stale registry.
  test("backend-unavailable in resume, status, wait and close", async () => {
    const be = backend(sb, { startup: "blocked" });
    const { ctx, t } = await launched(be);
    be.script({ running: false });
    expect((await resume(t.id, ctx)).envelope.refusal?.code).toBe("backend-unavailable");
    expect((await status({ ids: [], all: false }, ctx)).envelope.refusal?.code).toBe("backend-unavailable");
    expect((await wait({ ids: [t.id], timeoutMs: 10 }, ctx)).envelope.refusal?.code).toBe("backend-unavailable");
    expect((await close({ id: t.id, discardWorktree: false }, ctx)).envelope.refusal?.code).toBe("backend-unavailable");
  });

  test("status refuses an unknown ID", async () => {
    const be = backend(sb);
    expect((await status({ ids: ["TC-0099.7"], all: false }, context(sb, be))).envelope.refusal?.code).toBe("task-not-found");
  });
});

describe("human flags are recorded (R17)", () => {
  // Protects: Spec 6, the registry keeps that each human flag was used.
  // Fails if either flag is dropped.
  test("--human-approved and --discard-worktree", async () => {
    const be = backend(sb, { statusAfterSend: "idle" });
    const { ctx, t } = await launched(be, true);
    expect(record().flags.human_approved).toBe(true);
    await close({ id: t.id, discardWorktree: true }, ctx);
    expect(record().flags.discard_worktree).toBe(true);
  });
});
