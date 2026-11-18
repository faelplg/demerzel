import type { Envelope, TaskView } from "../core/index.ts";
import type { UnitsEnvelope } from "../radiant/index.ts";

// Spec 4: without --json, the same content in short text. Every task shows
// ID, lifecycle, agent and report; each command adds what matters for it.

function line(task: TaskView, command: string): string {
  const parts = [task.id, `lifecycle=${task.lifecycle}`, `agent=${task.agent ?? "-"}`, `report=${task.report ?? "-"}`];
  if (command === "status" && task.interrupted) parts.push("interrupted=true");
  if (command === "resume" || command === "dispatch") parts.push(`request_sent=${String(task.request_sent)}`);
  if (command === "dispatch") parts.push(`harness=${task.harness}`, `model=${task.model}`, `rule=${task.provenance["rule"] ?? "-"}`);
  return parts.join("  ");
}

export function formatText(envelope: Envelope | UnitsEnvelope): { stdout: string; stderr: string } {
  if (envelope.refusal !== null) {
    const r = envelope.refusal;
    return { stdout: "", stderr: `recusa ${r.code}${r.hold ? " (hold)" : ""}: ${r.message}\npróximo passo: ${r.next}\n` };
  }
  if ("units" in envelope) {
    const out = [`contract=${envelope.contract}  commit=${envelope.base?.commit}`];
    for (const unit of envelope.units) {
      const parts = [unit.id, `state=${unit.state}`, `dependsOn=${JSON.stringify(unit.dependsOn)}`, `writes=${JSON.stringify(unit.writes)}`, `rule=${unit.rule}`, `waitingOn=${JSON.stringify(unit.waitingOn)}`];
      if (unit.task !== null) parts.push(`task=${line(unit.task, "status")}`);
      out.push(parts.join("  "));
    }
    return { stdout: `${out.join("\n")}\n`, stderr: "" };
  }
  const out: string[] = [];
  if (envelope.tasks.length === 0) out.push("nenhuma tarefa");
  for (const task of envelope.tasks) {
    out.push(line(task, envelope.command));
    if (task.backend_error !== null) out.push(`erro do backend: ${task.backend_error}`);
    if (task.launch_error !== null) out.push(`launch failed: ${task.launch_error}`);
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
