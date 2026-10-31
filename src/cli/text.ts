import type { Envelope, TaskView } from "../core/index.ts";

// Spec 4: without --json, the same content in short text. Every task shows
// ID, lifecycle, agent and report; each command adds what matters for it.

function line(task: TaskView, command: string): string {
  const parts = [task.id, `lifecycle=${task.lifecycle}`, `agent=${task.agent ?? "-"}`, `report=${task.report ?? "-"}`];
  if (command === "status" && task.interrupted) parts.push("interrupted=true");
  if (command === "resume" || command === "dispatch") parts.push(`request_sent=${String(task.request_sent)}`);
  return parts.join("  ");
}

export function formatText(envelope: Envelope): { stdout: string; stderr: string } {
  if (envelope.refusal !== null) {
    const r = envelope.refusal;
    return { stdout: "", stderr: `recusa ${r.code}: ${r.message}\npróximo passo: ${r.next}\n` };
  }
  const out: string[] = [];
  if (envelope.tasks.length === 0) out.push("nenhuma tarefa");
  for (const task of envelope.tasks) {
    out.push(line(task, envelope.command));
    if (task.backend_error !== null) out.push(`erro do backend: ${task.backend_error}`);
    if (envelope.command === "collect" && task.collected !== undefined) {
      const c = task.collected;
      out.push(`path=${c.path}  digest=${c.digest}  digest_changed=${String(c.digest_changed)}`);
      out.push("");
      out.push(c.content.replace(/\n$/, ""));
    }
    if (envelope.command === "close" && task.discard !== undefined) {
      out.push(task.discard.removed ? "descarte: worktree removido" : `descarte recusado pelo Git: ${task.discard.reason ?? "sem motivo"}`);
    }
  }
  return { stdout: `${out.join("\n")}\n`, stderr: "" };
}
