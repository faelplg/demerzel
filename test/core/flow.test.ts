import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
      // A finished task, agent idle with the return present, needs no
      // attention.
      expect((await status({ ids: ["TC-0099.1"], all: false }, ctx)).code).toBe(0);

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

  // Protects: Spec 3.3, the core part: without a base, the dispatch starts
  // from the caller's current branch, also from a linked worktree whose HEAD
  // differs from the main checkout. Fails if the base comes from the main
  // checkout.
  test("default base from a linked worktree", async () => {
    const linked = join(sb.root, "caller");
    git(sb.repo, ["worktree", "add", "-q", "-b", "caller", linked], sb.env);
    git(linked, ["commit", "-q", "--allow-empty", "-m", "só no worktree chamador"], sb.env);
    const callerCommit = git(linked, ["rev-parse", "HEAD"], sb.env).stdout;
    expect(callerCommit).not.toBe(git(sb.repo, ["rev-parse", "HEAD"], sb.env).stdout);
    const d = await dispatch({ task: task(), humanApproved: false }, context(sb, backend(sb), { cwd: linked }));
    expect(d.code).toBe(0);
    expect(d.envelope.tasks[0]?.base).toEqual({ ref: "caller", commit: callerCommit });
    expect(git(d.envelope.tasks[0]?.worktree ?? "", ["rev-parse", "HEAD"], sb.env).stdout).toBe(callerCommit);
  });

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
    // The stored text differs from what the task would build now, so a
    // resume that rebuilt the request would send something else.
    const file = `${sb.stateHome}/demerzel/projects/${readdir(sb)}/tasks/TC-0099.1.json`;
    const stored = JSON.parse(readFileSync(file, "utf8"));
    stored.request_text = "texto gravado no registro\n";
    writeFileSync(file, JSON.stringify(stored));
    be.setAgentStatus(name, "idle");
    const r = await resume("TC-0099.1", ctx);
    expect(r.code).toBe(0);
    expect(r.envelope.tasks[0]?.request_sent).toBe(true);
    const sends = be.effectCalls().filter((call) => call.op === "send");
    expect(sends).toHaveLength(1);
    expect(sends[0]?.args["text"]).toBe("texto gravado no registro\n");
  });
});

function readdir(s: Sandbox): string {
  return readdirSync(`${s.stateHome}/demerzel/projects`)[0] ?? "";
}
