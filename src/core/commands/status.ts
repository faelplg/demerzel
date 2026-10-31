import { ProjectLock } from "../lock.ts";
import type { TaskRecord } from "../types.ts";
import { done, isOutcome, isProbe, notFound, open, reachBackend, view, type Context, type Outcome, type TaskView } from "./common.ts";

const C = "status";

export type StatusInput = { ids: string[]; all: boolean };

function attention(task: TaskView): boolean {
  if (task.interrupted || task.lifecycle === "launch-failed") return true;
  if (task.agent === "blocked" || task.agent === "unknown" || task.agent === "lost") return true;
  return task.agent === "idle" && task.report === "absent";
}

// Spec 4: reads only. It tries the lock without waiting to tell an
// interrupted dispatch from one in progress, and releases it at once.
export async function status(input: StatusInput, ctx: Context): Promise<Outcome> {
  const session = open(C, ctx);
  if (isOutcome(session)) return session;
  const { registry } = session;
  const all = registry.list();
  let records: TaskRecord[];
  if (input.ids.length > 0) {
    records = [];
    for (const id of input.ids) {
      const record = all.find((r) => r.id === id);
      if (record === undefined) return notFound(C, id);
      records.push(record);
    }
  } else {
    records = input.all ? all : all.filter((r) => r.lifecycle !== "closed");
  }
  const probe = await reachBackend(C, ctx.backend);
  if (!isProbe(probe)) return probe;
  const snapshot = await ctx.backend.snapshot();

  let lockFree = false;
  if (records.some((r) => r.lifecycle === "recorded" || r.lifecycle === "launching")) {
    registry.ensure();
    const probeLock = ProjectLock.tryAcquire(registry.lockPath);
    if (probeLock !== null) {
      lockFree = true;
      probeLock.release();
    }
  }
  const tasks = records.map((r) => view(r, snapshot, { interrupted: lockFree && (r.lifecycle === "recorded" || r.lifecycle === "launching") }));
  return done(C, tasks.some(attention) ? 1 : 0, tasks);
}
