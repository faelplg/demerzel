import type { TaskRecord } from "../types.ts";
import { clock, done, isOutcome, isProbe, notFound, open, reachBackend, view, wrongLifecycle, type Context, type Outcome, type TaskView } from "./common.ts";

const C = "wait";

export type WaitInput = { ids: string[]; timeoutMs: number | null };

const STOP = new Set(["blocked", "idle", "lost", "unknown"]);

// Spec 4: its own loop over the snapshot and the return file. Every task is
// observed again on every cycle, so the result is never an old observation;
// it returns when all of them, in the same cycle, have a return present or
// an agent in a stop state. A return that is present counts even while the
// agent is still working. A repeated ID counts once.
export async function wait(input: WaitInput, ctx: Context): Promise<Outcome> {
  const session = open(C, ctx);
  if (isOutcome(session)) return session;
  const { registry } = session;
  const records: TaskRecord[] = [];
  for (const id of new Set(input.ids)) {
    const record = registry.read(id);
    if (record === null) return notFound(C, id);
    if (record.lifecycle !== "launched" && record.lifecycle !== "collected") return wrongLifecycle(C, record, "launched ou collected");
    records.push(record);
  }

  const { now, sleep } = clock(ctx);
  const deadline = input.timeoutMs === null ? Number.POSITIVE_INFINITY : now() + input.timeoutMs;
  for (;;) {
    // The backend can stop during a long wait; that is backend-unavailable,
    // never an agent in `unknown`.
    const probe = await reachBackend(C, ctx.backend);
    if (!isProbe(probe)) return probe;
    const snapshot = await ctx.backend.snapshot();
    const tasks: TaskView[] = records.map((record) => view(record, snapshot));
    const settled = tasks.every((t) => t.report === "present" || STOP.has(t.agent ?? ""));
    if (settled || now() >= deadline) {
      const allReported = tasks.every((t) => t.report === "present");
      return done(C, settled && allReported ? 0 : 1, tasks);
    }
    await sleep(ctx.waitIntervalMs ?? 1000);
  }
}
