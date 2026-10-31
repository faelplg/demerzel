import type { TaskRecord } from "../types.ts";
import { agentState, clock, done, isOutcome, isProbe, notFound, open, reachBackend, reportState, view, wrongLifecycle, type Context, type Outcome, type TaskView } from "./common.ts";

const C = "wait";

export type WaitInput = { ids: string[]; timeoutMs: number | null };

const STOP = new Set(["blocked", "idle", "lost", "unknown"]);

// Spec 4: its own loop over the snapshot and the return file. A return that
// is present counts even while the agent is still working.
export async function wait(input: WaitInput, ctx: Context): Promise<Outcome> {
  const session = open(C, ctx);
  if (isOutcome(session)) return session;
  const { registry } = session;
  const records: TaskRecord[] = [];
  for (const id of input.ids) {
    const record = registry.read(id);
    if (record === null) return notFound(C, id);
    if (record.lifecycle !== "launched" && record.lifecycle !== "collected") return wrongLifecycle(C, record, "launched ou collected");
    records.push(record);
  }
  const first = await reachBackend(C, ctx.backend);
  if (!isProbe(first)) return first;

  const { now, sleep } = clock(ctx);
  const deadline = input.timeoutMs === null ? Number.POSITIVE_INFINITY : now() + input.timeoutMs;
  const stopped = new Map<string, TaskView>();
  for (;;) {
    const probe = await ctx.backend.probe();
    const reachable = probe.running && probe.compatible;
    const snapshot = reachable ? await ctx.backend.snapshot() : null;
    for (const record of records) {
      if (stopped.has(record.id)) continue;
      const report = reportState(record);
      const agent = snapshot === null ? "unknown" : agentState(record, snapshot);
      if (report === "present" || STOP.has(agent)) {
        const v = view(record, snapshot);
        v.agent = agent;
        stopped.set(record.id, v);
      }
    }
    const timedOut = now() >= deadline;
    if (stopped.size === records.length || timedOut) {
      const tasks = records.map((r) => stopped.get(r.id) ?? view(r, snapshot));
      const allReported = tasks.every((t) => t.report === "present");
      return done(C, allReported && stopped.size === records.length ? 0 : 1, tasks);
    }
    await sleep(ctx.waitIntervalMs ?? 1000);
  }
}
