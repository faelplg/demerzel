import { ProjectLock } from "../lock.ts";
import type { TaskRecord } from "../types.ts";
import { done, isOutcome, isProbe, isSnapshot, notFound, open, reachBackend, readSnapshot, view, type Context, type Outcome, type TaskView } from "./common.ts";

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
  let records: TaskRecord[];
  if (input.ids.length > 0) {
    records = [];
    for (const id of input.ids) {
      const record = registry.read(id);
      if (record === null) return notFound(C, id);
      records.push(record);
    }
  } else {
    const all = registry.list();
    records = input.all ? all : all.filter((r) => r.lifecycle !== "closed");
  }
  const probe = await reachBackend(C, ctx.backend);
  if (!isProbe(probe)) return probe;
  const first = await readSnapshot(C, ctx.backend);
  if (!isSnapshot(first)) return first;
  let snapshot = first;

  // A dispatch may have finished while this command read the backend. With
  // the lock free, the half-done tasks are read again before being called
  // interrupted, and when one of them moved on, the snapshot is taken again
  // so the record and the agent come from the same moment. With the lock
  // busy they are shown as they are.
  const halfDone = (r: TaskRecord) => r.lifecycle === "recorded" || r.lifecycle === "launching";
  const interrupted = new Set<string>();
  if (records.some(halfDone)) {
    registry.ensure();
    const probeLock = ProjectLock.tryAcquire(registry.lockPath);
    if (probeLock !== null) {
      try {
        const reread = records.map((r) => (halfDone(r) ? (registry.read(r.id) ?? r) : r));
        if (reread.some((r, i) => r.lifecycle !== records[i]?.lifecycle)) {
          const again = await readSnapshot(C, ctx.backend);
          if (!isSnapshot(again)) return again;
          snapshot = again;
        }
        records = reread;
        for (const r of records) if (halfDone(r)) interrupted.add(r.id);
      } finally {
        probeLock.release();
      }
    }
  }
  const tasks = records.map((r) => view(r, snapshot, { interrupted: interrupted.has(r.id) }));
  return done(C, tasks.some(attention) ? 1 : 0, tasks);
}
