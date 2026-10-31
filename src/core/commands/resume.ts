import { entry } from "../registry.ts";
import { agentState, done, isLock, isOutcome, isProbe, lock, notFound, open, planRecovery, reachBackend, refuse, transition, view, wrongLifecycle, type Context, type Outcome } from "./common.ts";

const C = "resume";

// Spec 4: sends the recorded initial request of a `launched` task whose
// startup was blocked. The text is not built again.
export async function resume(id: string, ctx: Context): Promise<Outcome> {
  const session = open(C, ctx);
  if (isOutcome(session)) return session;
  const { project, registry } = session;
  const held = await lock(C, ctx, registry);
  if (!isLock(held)) return held;
  try {
    if (registry.read(id) === null) return notFound(C, id);
    const probe = await reachBackend(C, ctx.backend);
    if (!isProbe(probe)) return probe;
    const snapshot = await ctx.backend.snapshot();
    const recovery = planRecovery(registry, snapshot, project, ctx.env, ctx.trace);
    const record = recovery.records.find((r) => r.id === id);
    if (record === undefined) return notFound(C, id);
    if (record.lifecycle !== "launched") return wrongLifecycle(C, record, "launched");
    if (record.request_sent !== false) {
      return refuse(C, "request-already-sent", `o pedido da tarefa ${id} já saiu ou pode ter saído (request_sent: ${String(record.request_sent)})`, "Confira a aba do agente; o Demerzel não reenvia.");
    }
    const agent = agentState(record, snapshot);
    if (agent === "lost") return refuse(C, "task-lost", `o agente da tarefa ${id} não está no backend`, "Feche a tarefa; o Demerzel nunca relança sozinho.");
    recovery.publish();
    if (agent === "blocked") return done(C, 1, [view(record, snapshot)]);

    // Until the outcome is known the request may have arrived: an
    // interruption here must never let a later resume send it again.
    record.send_started_at = new Date().toISOString();
    record.request_sent = "unknown";
    record.history.push(entry("send-started", { by: C }));
    registry.write(record);
    ctx.trace?.("wrote:send-started");
    let sent;
    try {
      sent = await ctx.backend.send(record.agent_name, record.request_text);
    } catch {
      sent = "unknown" as const;
    }
    record.request_sent = sent === "sent" ? true : sent === "not-ready" ? false : "unknown";
    transition(registry, record, "launched", { by: C, request_sent: record.request_sent }, ctx.trace);
    return done(C, record.request_sent === true ? 0 : 1, [view(record, await ctx.backend.snapshot())]);
  } finally {
    held.release();
  }
}
