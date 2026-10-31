import { existsSync } from "node:fs";
import { git } from "../git.ts";
import { entry, type Registry } from "../registry.ts";
import type { TaskRecord } from "../types.ts";
import { agentState, backendErrorDetail, done, isLock, isOutcome, isProbe, isSnapshot, lock, notFound, open, planRecovery, reachBackend, readSnapshot, refuse, transition, view, viewAfterEffect, wrongLifecycle, type Context, type Outcome } from "./common.ts";

const C = "close";

export type CloseInput = { id: string; discardWorktree: boolean };

// The human decision is written before the destructive effect, so an
// interruption after `git worktree remove` still leaves it in the registry
// (Spec 6). The outcome is written after.
function discard(record: TaskRecord, registry: Registry, mainCheckout: string, ctx: Context): { removed: boolean; reason: string | null } {
  record.flags.discard_worktree = true;
  record.history.push(entry("worktree-discard-started", null));
  registry.write(record);
  ctx.trace?.("wrote:worktree-discard-started");
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
      // Repeating the discard is accepted while the worktree is there, and
      // also to finish a discard that started and never recorded its outcome.
      const unfinished = record.flags.discard_worktree && !record.worktree_removed;
      if (!input.discardWorktree || record.worktree_removed || (!existsSync(record.worktree) && !unfinished)) {
        return wrongLifecycle(C, record, "launched, collected ou launch-failed; closed só para repetir ou terminar o descarte do worktree");
      }
      const result = discard(record, registry, project.mainCheckout, ctx);
      const v = view(record, null);
      v.discard = result;
      return done(C, result.removed ? 0 : 1, [v]);
    }

    const probe = await reachBackend(C, ctx.backend);
    if (!isProbe(probe)) return probe;
    const snapshot = await readSnapshot(C, ctx.backend);
    if (!isSnapshot(snapshot)) return snapshot;
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
      try {
        await ctx.backend.closeWorkspace(workspace);
      } catch (error) {
        // The close was the first effect and failed: the task keeps its
        // lifecycle, the failure goes to the history, and the exit is 1.
        const failure = backendErrorDetail(error);
        record.history.push(entry("close-failed", { workspace, backend_error: failure }));
        registry.write(record);
        ctx.trace?.("wrote:close-failed");
        return done(C, 1, [viewAfterEffect(record, { snapshot: null, error: null }, failure)]);
      }
    }
    // The human decision goes in with `closed`, so no write ever shows the
    // task closed for discard without the flag.
    if (input.discardWorktree) record.flags.discard_worktree = true;
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
