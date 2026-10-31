import { existsSync } from "node:fs";
import type { LaunchPlan } from "../backend.ts";
import { git, gitOk } from "../git.ts";
import { agentName } from "../project.ts";
import { entry } from "../registry.ts";
import { buildRequest, checkBranchName, checkPointers, overlaps, parseTask, resolveBase } from "../task.ts";
import type { TaskRecord } from "../types.ts";
import { done, isLock, isOutcome, isProbe, lock, open, planRecovery, reachBackend, refuse, transition, view, type Context, type Outcome } from "./common.ts";

const C = "dispatch";

export type DispatchInput = { task: unknown; humanApproved: boolean };

export async function dispatch(input: DispatchInput, ctx: Context): Promise<Outcome> {
  const session = open(C, ctx);
  if (isOutcome(session)) return session;
  const { project, registry } = session;
  const parsed = parseTask(input.task);
  if (!parsed.ok) return refuse(C, "task-invalid", parsed.message, "Corrija a tarefa e despache de novo.");
  const task = parsed.task;
  if (!ctx.backend.supportsHarness(task.harness)) {
    return refuse(C, "task-invalid", `o backend não lança o harness ${task.harness}`, "Use um harness que o backend lança.");
  }

  const held = await lock(C, ctx, registry);
  if (!isLock(held)) return held;
  try {
    const probe = await reachBackend(C, ctx.backend);
    if (!isProbe(probe)) return probe;
    const snapshot = await ctx.backend.snapshot();
    const recovery = planRecovery(registry, snapshot, project, ctx.env, ctx.trace);

    if (registry.taken(task.id)) {
      return refuse(C, "task-exists", `o ID ${task.id} já está no registro deste projeto e nunca é reutilizado`, "Despache a unidade com um ID novo.");
    }
    const base = resolveBase(task, project.callerRoot, ctx.env);
    if (!base.ok) return refuse(C, "task-invalid", base.message, "Passe uma base que resolva para um commit.");

    const tasks = recovery.records;
    for (const dep of task.dependsOn) {
      const other = tasks.find((t) => t.id === dep);
      const pending = (why: string) => refuse(C, "dependency-pending", `a dependência ${dep} não terminou: ${why}`, "Espere a dependência ser coletada, fechada e entrar na base.");
      if (other === undefined) return pending("não há tarefa com esse ID no registro");
      const events = other.history.map((h) => h.event);
      const collectedAt = events.indexOf("collected");
      if (other.lifecycle !== "closed" || collectedAt === -1 || events.lastIndexOf("closed") < collectedAt) {
        return pending("ela precisa estar fechada depois de coletada");
      }
      const tip = git(project.mainCheckout, ["rev-parse", "--verify", "--quiet", `refs/heads/${other.branch}`], ctx.env);
      if (tip.code !== 0 || !gitOk(project.mainCheckout, ["merge-base", "--is-ancestor", tip.stdout, base.commit], ctx.env)) {
        return pending(`o branch ${other.branch} não está na base ${base.commit}`);
      }
    }
    for (const other of tasks) {
      if (other.lifecycle === "closed") continue;
      for (const mine of task.writes) {
        const hit = other.task.writes.find((theirs) => overlaps(mine, theirs));
        if (hit !== undefined) {
          return refuse(C, "writes-overlap", `${mine} se sobrepõe a ${hit} da tarefa ${other.id}, que não está fechada`, `Feche ${other.id} antes ou separe os paths.`);
        }
      }
    }
    const branchName = checkBranchName(task.branch, project.mainCheckout, ctx.env);
    if (!branchName.ok) return refuse(C, "task-invalid", branchName.message, "Use um nome de branch válido.");
    const pointers = checkPointers(task, project.mainCheckout, base.commit, ctx.env);
    if (!pointers.ok) return refuse(C, "task-invalid", pointers.message, "Aponte para paths que existem no commit base.");
    if (gitOk(project.mainCheckout, ["show-ref", "--verify", "--quiet", `refs/heads/${task.branch}`], ctx.env)) {
      return refuse(C, "branch-exists", `o branch ${task.branch} já existe`, "Use outro ID ou remova o branch à mão, se ele não guarda trabalho.");
    }
    const worktree = registry.worktreePath(task.id);
    if (existsSync(worktree)) return refuse(C, "worktree-exists", `o path ${worktree} já existe`, "Remova o path à mão, se ele não guarda trabalho.");
    const name = agentName(project.key, task.id);
    if (snapshot.agents.some((a) => a.name === name)) {
      return refuse(C, "agent-name-taken", `o agente ${name} já está vivo no backend`, "Feche a sessão desse agente antes de despachar.");
    }

    // No refusal is left: the recovery of interrupted tasks is written now,
    // and from here on the decision is recorded and never re-read.
    recovery.publish();
    const plan: LaunchPlan = {
      taskId: task.id,
      agentName: name,
      label: task.id,
      harness: task.harness,
      model: task.model,
      effort: task.effort ?? null,
      branch: task.branch,
      baseCommit: base.commit,
      worktreePath: worktree,
      mainCheckout: project.mainCheckout,
    };
    const preparation = ctx.backend.prepare(plan);
    const record: TaskRecord = {
      schema: 1,
      id: task.id,
      task,
      request_text: buildRequest(task),
      harness: task.harness,
      model: task.model,
      effort: { requested: task.effort ?? null, applied: preparation.effort.applied, omitted_reason: preparation.effort.omittedReason },
      base: { ref: base.ref, commit: base.commit },
      branch: task.branch,
      worktree,
      agent_name: name,
      backend_ids: { workspace: null, tab: null, pane: null },
      preparation: preparation.data,
      provenance: task.provenance,
      flags: { human_approved: input.humanApproved, discard_worktree: false },
      lifecycle: "recorded",
      request_sent: false,
      send_started_at: null,
      created: [],
      collected: null,
      worktree_removed: false,
      history: [entry("recorded", { human_approved: input.humanApproved })],
    };
    registry.write(record);
    ctx.trace?.("wrote:recorded");
    transition(registry, record, "launching", null, ctx.trace);

    let launch;
    try {
      launch = await ctx.backend.launch(plan, preparation, (resource) => {
        record.created.push(resource);
        if (resource.kind === "workspace") record.backend_ids.workspace = resource.id;
        if (resource.kind === "tab") record.backend_ids.tab = resource.id;
        if (resource.kind === "pane") record.backend_ids.pane = resource.id;
        record.history.push(entry("created", { ...resource }));
        registry.write(record);
        ctx.trace?.(`wrote:created:${resource.kind}`);
      });
    } catch (error) {
      launch = { kind: "failed" as const, reason: error instanceof Error ? error.message : String(error), ids: record.backend_ids };
    }
    if (launch.kind === "failed") {
      transition(registry, record, "launch-failed", { reason: launch.reason }, ctx.trace);
      return done(C, 1, [view(record, null)]);
    }
    if (launch.kind === "blocked") {
      record.request_sent = false;
      transition(registry, record, "launched", { startup: "blocked", request_sent: false }, ctx.trace);
      return done(C, 1, [view(record, await ctx.backend.snapshot())]);
    }

    record.send_started_at = new Date().toISOString();
    record.history.push(entry("send-started", null));
    registry.write(record);
    ctx.trace?.("wrote:send-started");
    let sent;
    try {
      sent = await ctx.backend.send(name, record.request_text);
    } catch {
      sent = "unknown" as const;
    }
    record.request_sent = sent === "sent" ? true : sent === "not-ready" ? false : "unknown";
    transition(registry, record, "launched", { request_sent: record.request_sent }, ctx.trace);
    return done(C, record.request_sent === true ? 0 : 1, [view(record, await ctx.backend.snapshot())]);
  } finally {
    held.release();
  }
}
