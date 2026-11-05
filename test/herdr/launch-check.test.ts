import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dispatch, resume } from "../../src/core/index.ts";
import { git } from "../../src/core/git.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { HerdrBackend } from "../../src/herdr/backend.ts";
import { sandbox, task, type Sandbox } from "../core/helpers/sandbox.ts";
import { installFakeHerdr, type FakeHerdr } from "./helpers/fake.ts";

// TC-0003, output 1: the launch check of Spec 2.5, revisions 0.10 and 0.12,
// in the herdr backend, through the core resume. A Claude Code task freed
// from a blocked startup is checked right before the request goes: the
// agent's own cwd, the branch at the base commit, and the worktree HEAD on
// that branch. Codex has no postcondition and is checked without a call.

let sb: Sandbox;
let fake: FakeHerdr;
beforeEach(() => {
  sb = sandbox();
  fake = installFakeHerdr(sb.root, sb.env);
});
afterEach(() => sb.cleanup());

const ID = "TC-0099.1";
const backend = () => new HerdrBackend(fake.env, { session: null }, { postconditionWaitMs: 200 });
const ctx = () => ({ cwd: sb.repo, env: fake.env, backend: backend(), lockIntervalMs: 10, waitIntervalMs: 5 });
const claude = () => task({ harness: "claude-code", model: "claude-sonnet-5-5", effort: "low" });
const inWorktree = (r: TaskRecord, ...args: string[]) => {
  const out = git(sb.repo, ["-C", r.worktree, ...args], sb.env);
  if (out.code !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr}`);
};

function record(): TaskRecord {
  return JSON.parse(readFileSync(join(resolveProject(sb.repo, fake.env)?.dir ?? "", "tasks", `${ID}.json`), "utf8")) as TaskRecord;
}

// Dispatches with a blocked startup, so the launch postcondition holds and
// the task waits for resume, then frees the agent as the human would.
async function blockedThenFreed(t = claude()): Promise<TaskRecord> {
  fake.script({ start: { claude: "not_ready", codex: "not_ready" } });
  const d = await dispatch({ task: t, humanApproved: false }, ctx());
  expect(d.code).toBe(1);
  expect(d.envelope.tasks[0]?.lifecycle).toBe("launched");
  expect(d.envelope.tasks[0]?.request_sent).toBe(false);
  const r = record();
  fake.setAgentStatus(r.agent_name, "idle");
  return r;
}

const prompts = (from: number) => fake.calls().slice(from).filter((c) => c[0] === "agent" && c[1] === "prompt");

describe("the launch check at resume, Claude Code (P1, P3)", () => {
  // Protects: an unchanged launch passes the check and the request goes
  // once. Fails if the check refuses a worktree that is as launched.
  test("an unchanged launch is sent", async () => {
    await blockedThenFreed();
    const from = fake.calls().length;
    const r = await resume(ID, ctx());
    expect(r.code).toBe(0);
    expect(prompts(from)).toHaveLength(1);
    const reads = fake.calls().slice(from).map((c) => c.slice(0, 2).join(" "));
    expect(reads.indexOf("agent get")).toBeLessThan(reads.indexOf("agent prompt"));
  });

  // Each change happens after the launch was checked and before resume:
  // the worktree may move while the human frees the startup.
  const cases: Array<[string, (r: TaskRecord) => void, string[]]> = [
    ["the agent's cwd outside the worktree", (r) => fake.setAgentCwd(r.agent_name, sb.repo), ["cwd do agente", "não é o worktree"]],
    [
      "the branch missing",
      (r) => {
        inWorktree(r, "checkout", "-q", "--detach");
        git(sb.repo, ["branch", "-q", "-D", r.branch], sb.env);
      },
      ["não existe"],
    ],
    ["the branch off the base commit", (r) => inWorktree(r, "commit", "-q", "--allow-empty", "-m", "fora da base"), ["não para o commit base"]],
    ["the worktree HEAD on another branch, the branch intact", (r) => inWorktree(r, "switch", "-q", "-c", "outro"), ["HEAD do worktree", "refs/heads/outro"]],
    ["the worktree HEAD detached, the branch intact", (r) => inWorktree(r, "checkout", "-q", "--detach"), ["HEAD do worktree", "destacado"]],
  ];
  for (const [name, change, said] of cases) {
    // Protects: P1 and P3, resume refuses to send to a worktree that no
    // longer matches the launch: the task goes to launch-failed with the
    // reason and nothing is sent. Fails if this change passes the check.
    test(name, async () => {
      const launched = await blockedThenFreed();
      change(launched);
      const intact = name.includes("branch intact");
      if (intact) expect(git(sb.repo, ["rev-parse", launched.branch], sb.env).stdout).toBe(launched.base.commit);
      const from = fake.calls().length;
      const r = await resume(ID, ctx());
      expect(r.code).toBe(1);
      expect(prompts(from)).toEqual([]);
      const after = record();
      expect(after.lifecycle).toBe("launch-failed");
      expect(after.created).toEqual(launched.created);
      const reason = String(after.history.at(-1)?.detail?.["reason"]);
      for (const piece of said) expect(reason).toContain(piece);
      expect(r.envelope.tasks[0]?.backend_error).toBe(reason);
    });
  }

  // Protects: P4, a herdr error while reading the agent during the check
  // is backend-unavailable and writes nothing. Fails if it becomes a
  // mismatch and the task goes to launch-failed.
  test("an agent get error is backend-unavailable", async () => {
    await blockedThenFreed();
    const before = sb.tasksSnapshot();
    fake.script({ agentGet: "error" });
    const from = fake.calls().length;
    const r = await resume(ID, ctx());
    expect(r.code).toBe(2);
    expect(r.envelope.refusal?.code).toBe("backend-unavailable");
    expect(r.envelope.refusal?.message).toContain("herdr agent get: agent_not_found");
    expect(sb.tasksSnapshot()).toEqual(before);
    expect(prompts(from)).toEqual([]);
  });
});

describe("the launch check at resume, Codex (P1)", () => {
  // Protects: Spec 2.5, Codex has no postcondition: the check passes
  // without a herdr call and the request goes. Fails if the check reads the
  // agent or refuses a Codex task.
  test("passes without a call", async () => {
    await blockedThenFreed(task());
    const be = backend();
    const from = fake.calls().length;
    const r = await be.verifyLaunch({ agentName: record().agent_name, harness: "codex", branch: record().branch, baseCommit: record().base.commit, worktreePath: record().worktree, mainCheckout: sb.repo });
    expect(r).toEqual({ ok: true });
    expect(fake.calls().length).toBe(from);
    const sent = await resume(ID, ctx());
    expect(sent.code).toBe(0);
    expect(fake.calls().slice(from).some((c) => c[0] === "agent" && c[1] === "get")).toBe(false);
  });
});
