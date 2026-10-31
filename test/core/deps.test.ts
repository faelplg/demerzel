import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { collect, close, dispatch } from "../../src/core/index.ts";
import type { FakeBackend } from "../../src/core/fake-backend.ts";
import { git } from "../../src/core/git.ts";
import { backend, context, sandbox, task, writeReport, type Sandbox } from "./helpers/sandbox.ts";

let sb: Sandbox;
let be: FakeBackend;
beforeEach(() => {
  sb = sandbox();
  be = backend(sb, { statusAfterSend: "idle" });
});
afterEach(() => sb.cleanup());

const DEP = "TC-0099.1";
const NEXT = "TC-0099.2";

async function dependency(steps: { collect: boolean; close: boolean; merge: boolean }): Promise<void> {
  const ctx = context(sb, be);
  const d = await dispatch({ task: task({ id: DEP }), humanApproved: false }, ctx);
  const worktree = d.envelope.tasks[0]?.worktree ?? "";
  git(worktree, ["commit", "-q", "--allow-empty", "-m", "trabalho da dependência"], sb.env);
  writeReport(worktree, `.radiant/reports/${DEP}.md`);
  if (steps.collect) await collect(DEP, ctx);
  if (steps.close) await close({ id: DEP, discardWorktree: false }, ctx);
  if (steps.merge) git(sb.repo, ["merge", "-q", "--ff-only", `radiant/${DEP}`], sb.env);
}

async function next() {
  return dispatch({ task: task({ id: NEXT, writes: ["other/"], dependsOn: [DEP] }), humanApproved: false }, context(sb, be));
}

describe("dependencies (Spec 5)", () => {
  // Protects: a dependency finished only when closed after collected and its
  // branch is in the new base. Fails if any of the three conditions is
  // dropped.
  test("collected but not closed: pending", async () => {
    await dependency({ collect: true, close: false, merge: true });
    expect((await next()).envelope.refusal?.code).toBe("dependency-pending");
  });
  test("closed without collect: pending", async () => {
    await dependency({ collect: false, close: true, merge: true });
    expect((await next()).envelope.refusal?.code).toBe("dependency-pending");
  });
  test("closed and collected, branch not in the base: pending", async () => {
    await dependency({ collect: true, close: true, merge: false });
    expect((await next()).envelope.refusal?.code).toBe("dependency-pending");
  });
  test("closed and collected, branch in the base: dispatched", async () => {
    await dependency({ collect: true, close: true, merge: true });
    expect((await next()).code).toBe(0);
  });
});
