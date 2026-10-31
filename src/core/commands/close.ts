import { existsSync } from "node:fs";
import { git } from "../git.ts";
import { entry, type Registry } from "../registry.ts";
import type { TaskRecord } from "../types.ts";
import { agentState, done, isLock, isOutcome, isProbe, lock, notFound, open, planRecovery, reachBackend, refuse, transition, view, wrongLifecycle, type Context, type Outcome } from "./common.ts";

const C = "close";

export type CloseInput = { id: string; discardWorktree: boolean };

function discard(record: TaskRecord, registry: Registry, mainCheckout: string, ctx: Context): { removed: boolean; reason: string | null } {
  record.flags.discard_worktree = true;
  if (!existsSync(record.worktree)) {
    record.worktree_removed = true;
    record.history.push(entry("worktree-discard", { removed: true, note: "o path já não existia" }));
    registry.write(record);
    return { removed: true, reason: null };
  }
  const r = git(mainCheckout, ["worktree", "remove", record.worktree], ctx.env);
  const removed = r.code === 0;
  record.worktree_removed = removed;
  record.history.push(entry("worktree-discard", { removed, reason: removed ? null : r.stderr }));
  registry.write(record);
  ctx.trace?.("wrote:worktree-discard");
  return { removed, reason: removed ? null : r.stderr };
}

// Spec 4: closes the workspace when it is still in the snapshot, records
// `closed`, never deletes the branch. --discard-worktree runs
// `git worktree remove` without --force; on a task already closed it only
// repeats the discard and does not talk to the backend.
export async function close(input: CloseInput, ctx: Context): Promise<Outcome> {
  const session = open(C, ctx);
  if (isOutcome(session)) return session;
  const { project, registry } = session;
  const held = await lock(C, ctx, registry);
  if (!isLock(held)) return held;
  try {
    const stored = registry.read(input.id);
    if (stored === null) return notFound(C, input.id);

    if (stored.lifecycle === "closed") {
      const record = stored;
      if (!input.discardWorktree || record.worktree_removed || !existsSync(record.worktree)) {
        return wrongLifecycle(C, record, "launched, collected ou launch-failed; closed só para repetir o descarte de um worktree que ainda existe");
      }
      const result = discard(record, registry, project.mainCheckout, ctx);
      const v = view(record, null);
      v.discard = result;
      return done(C, result.removed ? 0 : 1, [v]);
    }

    const probe = await reachBackend(C, ctx.backend);
    if (!isProbe(probe)) return probe;
    const snapshot = await ctx.backend.snapshot();
    const recovery = planRecovery(registry, snapshot, project, ctx.env, ctx.trace);
    const record = recovery.records.find((r) => r.id === input.id);
    if (record === undefined) return notFound(C, input.id);
    if (record.lifecycle !== "launched" && record.lifecycle !== "collected" && record.lifecycle !== "launch-failed") {
      return wrongLifecycle(C, record, "launched, collected ou launch-failed");
    }
    // A live agent that is working is protected in every lifecycle, also
    // after a failed launch postcondition.
    if (agentState(record, snapshot) === "working") {
      return refuse(C, "task-working", `o agente da tarefa ${input.id} está trabalhando, mesmo que o retorno já exista`, "Espere o agente parar; fechar mataria trabalho em curso.");
    }
    recovery.publish();
    const workspace = record.backend_ids.workspace;
    if (workspace !== null && snapshot.workspaces.some((w) => w.id === workspace)) {
      await ctx.backend.closeWorkspace(workspace);
    }
    transition(registry, record, "closed", { workspace_closed: workspace }, ctx.trace);
    if (!input.discardWorktree) return done(C, 0, [view(record, null)]);
    const result = discard(record, registry, project.mainCheckout, ctx);
    const v = view(record, null);
    v.discard = result;
    return done(C, result.removed ? 0 : 1, [v]);
  } finally {
    held.release();
  }
}
