import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { collect, close, dispatch, resume, status, wait } from "../../src/core/index.ts";
import { git } from "../../src/core/git.ts";
import { backend, context, sandbox, task, writeReport, type Sandbox } from "./helpers/sandbox.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

describe("verification 1: dispatch to close with the fake backend", () => {
  // Protects: the whole lifecycle of Spec 2.3 and 4 through the six commands,
  // with temporary state and no Radiant. Fails if any command stops chaining
  // into the next, or a transition is skipped.
  for (const harness of ["codex", "claude-code"]) {
    test(`${harness}: dispatch, status, wait, collect, close`, async () => {
      const be = backend(sb);
      const ctx = context(sb, be);
      const t = task({ harness });
      const d = await dispatch({ task: t, humanApproved: false }, ctx);
      expect(d.code).toBe(0);
      const [launched] = d.envelope.tasks;
      expect(launched?.lifecycle).toBe("launched");
      expect(launched?.request_sent).toBe(true);
      expect(launched?.agent).toBe("working");
      expect(launched?.report).toBe("absent");
      const worktree = launched?.worktree ?? "";
      expect(existsSync(worktree)).toBe(true);
      expect(git(sb.repo, ["rev-parse", "radiant/TC-0099.1"], sb.env).stdout).toBe(git(sb.repo, ["rev-parse", "main"], sb.env).stdout);

      const s = await status({ ids: [], all: false }, ctx);
      expect(s.code).toBe(0);
      expect(s.envelope.tasks.map((x) => x.id)).toEqual(["TC-0099.1"]);

      writeReport(worktree, ".radiant/reports/TC-0099.1.md", "pronto\n");
      be.setAgentStatus(launched?.agent_name ?? "", "done");
      const w = await wait({ ids: ["TC-0099.1"], timeoutMs: 1000 }, ctx);
      expect(w.code).toBe(0);
      expect(w.envelope.tasks[0]?.report).toBe("present");

      const c = await collect("TC-0099.1", ctx);
      expect(c.code).toBe(0);
      expect(c.envelope.tasks[0]?.collected?.content).toBe("pronto\n");

      const x = await close({ id: "TC-0099.1", discardWorktree: false }, ctx);
      expect(x.code).toBe(0);
      expect(x.envelope.tasks[0]?.lifecycle).toBe("closed");
      expect(existsSync(worktree)).toBe(true);
      expect(git(sb.repo, ["show-ref", "--verify", "refs/heads/radiant/TC-0099.1"], sb.env).code).toBe(0);
      expect(be.effectCalls().map((call) => call.op)).toEqual(["launch", "send", "closeWorkspace"]);

      const after = await status({ ids: [], all: false }, ctx);
      expect(after.envelope.tasks).toEqual([]);
      const all = await status({ ids: [], all: true }, ctx);
      expect(all.envelope.tasks.map((x) => x.lifecycle)).toEqual(["closed"]);
    });
  }

  // Protects: resume sends the recorded request once the human freed a
  // blocked startup. Fails if resume rebuilds the text or skips the send.
  test("resume after a blocked startup", async () => {
    const be = backend(sb, { startup: "blocked" });
    const ctx = context(sb, be);
    const d = await dispatch({ task: task(), humanApproved: false }, ctx);
    expect(d.code).toBe(1);
    expect(d.envelope.tasks[0]?.request_sent).toBe(false);
    expect(d.envelope.tasks[0]?.agent).toBe("blocked");
    const name = d.envelope.tasks[0]?.agent_name ?? "";

    expect((await resume("TC-0099.1", ctx)).code).toBe(1);
    be.setAgentStatus(name, "idle");
    const r = await resume("TC-0099.1", ctx);
    expect(r.code).toBe(0);
    expect(r.envelope.tasks[0]?.request_sent).toBe(true);
    const sends = be.effectCalls().filter((call) => call.op === "send");
    expect(sends).toHaveLength(1);
    const recorded = JSON.parse(readFileSync(`${sb.stateHome}/demerzel/projects/${readdir(sb)}/tasks/TC-0099.1.json`, "utf8"));
    expect(sends[0]?.args["text"]).toBe(recorded.request_text);
  });
});

function readdir(s: Sandbox): string {
  return readdirSync(`${s.stateHome}/demerzel/projects`)[0] ?? "";
}
