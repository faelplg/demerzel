import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dispatch, resume } from "../../src/core/index.ts";
import { FakeBackend, type FakeScript } from "../../src/core/fake-backend.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { spawnChild } from "./helpers/processes.ts";
import { context, sandbox, task, type Sandbox } from "./helpers/sandbox.ts";

// TC-0003, output 1: the launch check of Spec 2.5, revision 0.10, at resume.
// resume checks every Claude Code task right before it sends, whether the
// task reached `launched` through a blocked startup or through the recovery
// of an interrupted dispatch, which never checks (Spec 2.3).

let sb: Sandbox;
let stateFile: string;
beforeEach(() => {
  sb = sandbox();
  stateFile = join(sb.root, "fake-backend.json");
  new FakeBackend(sb.env, { stateFile });
});
afterEach(() => sb.cleanup());

const ID = "TC-0099.1";
const claude = () => task({ harness: "claude-code", model: "claude-sonnet-5-5", effort: "low" });

function record(): TaskRecord {
  return JSON.parse(readFileSync(join(resolveProject(sb.repo, sb.env)?.dir ?? "", "tasks", `${ID}.json`), "utf8")) as TaskRecord;
}

// The two ways a Claude Code task reaches `launched` with the request not
// sent. Each returns a backend over the same state file and the agent name.
type Origin = (script: Partial<FakeScript>) => Promise<{ be: FakeBackend; name: string }>;

const origins: Record<string, Origin> = {
  // A dispatch killed right after the agent was recorded; the next lock
  // holder recovers it as launched with request_sent false.
  "recovered from launching": async (script) => {
    const child = spawnChild(sb, stateFile, { name: "k", command: "dispatch", input: claude(), killOn: "wrote:created:agent" });
    await child.proc.exited;
    expect(child.proc.signalCode).toBe("SIGKILL");
    expect(record().lifecycle).toBe("launching");
    const be = new FakeBackend(sb.env, { stateFile, script });
    return { be, name: record().agent_name };
  },
  // A startup the human has to free in the tab; then the agent is idle.
  "from a blocked startup": async (script) => {
    const first = new FakeBackend(sb.env, { stateFile, script: { startup: "blocked" } });
    const d = await dispatch({ task: claude(), humanApproved: false }, context(sb, first));
    expect(d.code).toBe(1);
    expect(d.envelope.tasks[0]?.request_sent).toBe(false);
    const name = d.envelope.tasks[0]?.agent_name ?? "";
    first.setAgentStatus(name, "idle");
    return { be: new FakeBackend(sb.env, { stateFile, script }), name };
  },
};

const ops = (be: FakeBackend) => be.calls.map((c) => c.op);

for (const [origin, start] of Object.entries(origins)) {
  describe(`resume of a Claude Code task ${origin} (P2 to P5)`, () => {
    // Protects: a check that holds lets resume send the recorded request
    // once, and the check comes before send-started. Fails if resume sends
    // without checking or checks after the send started.
    test("a check that holds sends once", async () => {
      const { be } = await start({ verify: "ok" });
      const r = await resume(ID, context(sb, be));
      expect(r.code).toBe(0);
      expect(r.envelope.tasks[0]?.request_sent).toBe(true);
      const calls = ops(be);
      expect(calls.filter((op) => op === "send")).toHaveLength(1);
      expect(calls.indexOf("verifyLaunch")).toBeGreaterThan(-1);
      expect(calls.indexOf("verifyLaunch")).toBeLessThan(calls.indexOf("send"));
      const events = record().history.map((h) => h.event);
      expect(events.lastIndexOf("send-started")).toBeGreaterThan(-1);
    });

    // Protects: P3, a check that does not hold takes the task from launched
    // to launch-failed with the reason, keeps `created`, exits 1 and never
    // sends. Fails if resume sends to an unchecked worktree.
    test("a check that does not hold goes to launch-failed without sending", async () => {
      const { be } = await start({ verify: "fail" });
      const r = await resume(ID, context(sb, be));
      expect(r.code).toBe(1);
      expect(be.calls.filter((c) => c.op === "send")).toEqual([]);
      const after = record();
      expect(after.lifecycle).toBe("launch-failed");
      expect(after.request_sent).toBe(false);
      expect(after.send_started_at).toBeNull();
      expect(after.created.map((c) => c.kind).sort()).toEqual(["agent", "pane", "tab", "workspace", "worktree"]);
      const last = after.history.at(-1);
      expect(last?.event).toBe("launch-failed");
      expect(String(last?.detail?.["reason"])).toContain("pós-condição do lançamento não confere");
      expect(r.envelope.tasks[0]?.lifecycle).toBe("launch-failed");
    });

    // Protects: P4, a backend failure during the check is the refusal
    // backend-unavailable and writes nothing, not even the recovery of the
    // interrupted dispatch. Fails if the check failure is taken as a
    // mismatch or anything is written before it.
    test("a backend failure during the check writes nothing", async () => {
      const { be } = await start({ verify: "error" });
      const before = sb.tasksSnapshot();
      const r = await resume(ID, context(sb, be));
      expect(r.code).toBe(2);
      expect(r.envelope.refusal?.code).toBe("backend-unavailable");
      expect(r.envelope.refusal?.message).toContain("fake verifyLaunch: falha injetada na conferência");
      expect(sb.tasksSnapshot()).toEqual(before);
      expect(be.calls.filter((c) => c.op === "send")).toEqual([]);
    });

    // Protects: P2, an agent still blocked exits 1 without checking or
    // sending. Fails if the check runs, or the request goes, while the
    // human has not freed the startup.
    test("an agent still blocked exits 1 without checking", async () => {
      const { be, name } = await start({ verify: "ok" });
      be.setAgentStatus(name, "blocked");
      const r = await resume(ID, context(sb, be));
      expect(r.code).toBe(1);
      expect(ops(be)).not.toContain("verifyLaunch");
      expect(ops(be)).not.toContain("send");
      expect(record().request_sent).toBe(false);
    });
  });
}

describe("what the check compares", () => {
  // Protects: resume checks the recorded agent, branch, base commit and
  // worktree, never values computed again. Fails if any field is taken from
  // somewhere other than the record.
  test("the check carries the recorded launch", async () => {
    const { be } = await origins["from a blocked startup"]!({ verify: "ok" });
    await resume(ID, context(sb, be));
    const check = be.calls.find((c) => c.op === "verifyLaunch")?.args ?? {};
    const r = record();
    expect(check).toEqual({
      agentName: r.agent_name,
      harness: "claude-code",
      branch: r.branch,
      baseCommit: r.base.commit,
      worktreePath: r.worktree,
      mainCheckout: resolveProject(sb.repo, sb.env)?.mainCheckout ?? "",
    });
  });

  // Protects: a Codex task is checked too, and its check holds without a
  // postcondition, so a Codex resume still sends. Fails if resume skips
  // Codex or the fake refuses it.
  test("a Codex task holds and sends", async () => {
    const first = new FakeBackend(sb.env, { stateFile, script: { startup: "blocked" } });
    const d = await dispatch({ task: task(), humanApproved: false }, context(sb, first));
    first.setAgentStatus(d.envelope.tasks[0]?.agent_name ?? "", "idle");
    const be = new FakeBackend(sb.env, { stateFile, script: { verify: "fail" } });
    const r = await resume(ID, context(sb, be));
    expect(r.code).toBe(0);
    expect(ops(be)).toContain("verifyLaunch");
  });
});
