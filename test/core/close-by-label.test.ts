import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BackendError, close, dispatch } from "../../src/core/index.ts";
import { workspaceLabel } from "../../src/core/commands/common.ts";
import { FakeBackend } from "../../src/core/fake-backend.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { context, sandbox, task, type Sandbox } from "./helpers/sandbox.ts";

// TC-0002, Emenda 1 (finding Q1 of the fourth verification): when the
// creation's answer and the reconciliation snapshot both fail, the record
// has no workspace ID. `close` then looks the workspace up by its unique
// label, as the recovery of Spec 2.3 does, closes it and records the ID.

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

function record(id = "TC-0099.1"): TaskRecord {
  return JSON.parse(readFileSync(join(resolveProject(sb.repo, sb.env)?.dir ?? "", "tasks", `${id}.json`), "utf8")) as TaskRecord;
}

// A launch that fails right after the worktree, so the record never gets a
// workspace; the test then puts in the backend the workspace that the lost
// answer would have created.
async function launchWithoutWorkspaceId(be: FakeBackend): Promise<void> {
  const d = await dispatch({ task: task(), humanApproved: false }, context(sb, be));
  expect(d.envelope.tasks[0]?.lifecycle).toBe("launch-failed");
  expect(record().backend_ids.workspace).toBeNull();
}

class CloseFails extends FakeBackend {
  failures = 1;
  override async closeWorkspace(workspaceId: string): Promise<void> {
    if (this.failures-- > 0) throw new BackendError("herdr workspace close", "falha injetada");
    return super.closeWorkspace(workspaceId);
  }
}

describe("close finds a workspace whose ID was never recorded", () => {
  // Protects: Q1. Fails if close trusts only the recorded ID, exits 0 and
  // leaves the workspace of the task open in the backend, or if the
  // `workspace-found` entry that Emenda 1 asks for is left out of the
  // history (finding V3 of the fifth verification).
  test("the workspace is found by label, closed and its ID recorded", async () => {
    const be = new FakeBackend(sb.env, { script: { failAfter: "worktree" } });
    await launchWithoutWorkspaceId(be);
    const lost = be.addWorkspace(workspaceLabel(record()));

    const c = await close({ id: "TC-0099.1", discardWorktree: false }, context(sb, be));
    expect(c.code).toBe(0);
    expect(be.effectCalls().filter((x) => x.op === "closeWorkspace").map((x) => x.args["workspace"])).toEqual([lost]);
    expect(be.snapshotNow().workspaces).toEqual([]);
    const r = record();
    expect(r.lifecycle).toBe("closed");
    expect(r.backend_ids.workspace).toBe(lost);
    expect(r.history.slice(-2).map((h) => [h.event, h.detail])).toEqual([
      ["workspace-found", { workspace: lost, by: "label" }],
      ["closed", { workspace_closed: lost }],
    ]);
  });

  // Protects: the lookup takes only this task's label. Fails if close
  // matches by the task ID alone and closes another agent's workspace.
  test("a workspace with another label is left open", async () => {
    const be = new FakeBackend(sb.env, { script: { failAfter: "worktree" } });
    await launchWithoutWorkspaceId(be);
    const other = be.addWorkspace("TC-0099.1 dz-ffffffffffffffff");

    const c = await close({ id: "TC-0099.1", discardWorktree: false }, context(sb, be));
    expect(c.code).toBe(0);
    expect(be.effectCalls().filter((x) => x.op === "closeWorkspace")).toEqual([]);
    expect(be.snapshotNow().workspaces.map((w) => w.id)).toEqual([other]);
    expect(record().backend_ids.workspace).toBeNull();
  });

  // Protects: the ID found is kept even when the close fails, so a second
  // close reaches the same workspace. Fails if a failed close loses the
  // found ID or moves the task.
  test("a failed close keeps the found ID and the next close finishes", async () => {
    const be = new CloseFails(sb.env, { script: { failAfter: "worktree" } });
    await launchWithoutWorkspaceId(be);
    const lost = be.addWorkspace(workspaceLabel(record()));

    const first = await close({ id: "TC-0099.1", discardWorktree: false }, context(sb, be));
    expect(first.code).toBe(1);
    expect(record().lifecycle).toBe("launch-failed");
    expect(record().backend_ids.workspace).toBe(lost);
    expect(record().history.slice(-2).map((h) => h.event)).toEqual(["workspace-found", "close-failed"]);
    expect(first.envelope.tasks[0]?.backend_error).toBe("herdr workspace close: falha injetada");

    const second = await close({ id: "TC-0099.1", discardWorktree: false }, context(sb, be));
    expect(second.code).toBe(0);
    expect(record().lifecycle).toBe("closed");
    expect(be.snapshotNow().workspaces).toEqual([]);
  });
});
