import { ProjectLock } from "../lock.ts";
import type { Registry } from "../registry.ts";
import type { TaskRecord } from "../types.ts";
import { done, isOutcome, isProbe, isSnapshot, notFound, open, reachBackend, readSnapshot, view, type Context, type Outcome, type TaskView } from "./common.ts";

const C = "status";

export type StatusInput = { ids: string[]; all: boolean };

export function attention(task: TaskView): boolean {
  if (task.interrupted || task.lifecycle === "launch-failed") return true;
  if (task.agent === "blocked" || task.agent === "unknown" || task.agent === "lost") return true;
  return task.agent === "idle" && task.report === "absent";
}

// Spec 4: reads only. It probes each half-done task's lock without waiting
// to tell an interrupted dispatch from one in progress.
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
  const observed = await observe(C, records, registry, ctx);
  if (isOutcome(observed)) return observed;
  return done(C, observed.tasks.some(attention) ? 1 : 0, observed.tasks);
}

// Shared read-only observation for views over an explicitly selected set of
// records. The caller decides whether an empty set needs a backend read.
export async function observe(command: string, records: TaskRecord[], registry: Registry, ctx: Context): Promise<{ records: TaskRecord[]; tasks: TaskView[] } | Outcome> {
  const probe = await reachBackend(command, ctx.backend);
  if (!isProbe(probe)) return probe;
  const first = await readSnapshot(command, ctx.backend);
  if (!isSnapshot(first)) return first;
  let snapshot = first;

  // Spec 2.3, revision 0.15: each half-done task's own lock tells a live
  // dispatch, possibly in its preparation, from an interrupted one. The lock
  // file is opened read-only and never created. With the lock free, the
  // task is read again and is interrupted only if it is still half done;
  // when one moved on, the snapshot is taken again so the record and the
  // agent come from the same moment. With the lock held, it shows as it is.
  ctx.trace?.(`${command}:read`);
  const halfDone = (r: TaskRecord) => r.lifecycle === "recorded" || r.lifecycle === "launching";
  const interrupted = new Set<string>();
  let moved = false;
  records = records.map((r) => {
    if (!halfDone(r)) return r;
    const reread = ProjectLock.probe(registry.taskLockPath(r.id), () => registry.read(r.id) ?? r);
    if (reread === "held") return r;
    if (reread.lifecycle !== r.lifecycle) moved = true;
    if (halfDone(reread)) interrupted.add(reread.id);
    return reread;
  });
  if (moved) {
    const again = await readSnapshot(command, ctx.backend);
    if (!isSnapshot(again)) return again;
    snapshot = again;
  }
  const tasks = records.map((r) => view(r, snapshot, { interrupted: interrupted.has(r.id) }));
  return { records, tasks };
}
