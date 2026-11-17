import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { LaunchPlan } from "../backend.ts";
import { git, gitOk } from "../git.ts";
import type { ProjectLock } from "../lock.ts";
import { checkIdentity, PREPARE_GRACE_MS, PREPARE_LIMIT_MS, PREPARE_SETTLE_MS, runPreparation } from "../prepare.ts";
import { agentName } from "../project.ts";
import { PROJECT_FILE, readProjectConfig } from "../project-config.ts";
import { entry } from "../registry.ts";
import { buildRequest, checkBranchName, checkPointers, overlaps, parseTask, resolveBase } from "../task.ts";
import type { TaskRecord } from "../types.ts";
import { backendErrorDetail, done, isLock, isOutcome, isProbe, isSnapshot, lock, open, planRecovery, reachBackend, readSnapshot, refuse, snapshotAfterEffect, taskLock, transition, view, viewAfterEffect, workspaceLabel, type Context, type Outcome, type Recovery } from "./common.ts";

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

  const first = await lock(C, ctx, registry);
  if (!isLock(first)) return first;
  // Spec 2.3, revision 0.15: the project lock is released while the
  // preparation runs and taken back after it; the task lock is held from
  // before `recorded` to the last record.
  let held: ProjectLock | null = first;
  let own: ProjectLock | null = null;
  let recovery: Recovery | null = null;
  try {
    const probe = await reachBackend(C, ctx.backend);
    if (!isProbe(probe)) return probe;
    const snapshot = await readSnapshot(C, ctx.backend);
    if (!isSnapshot(snapshot)) return snapshot;
    recovery = planRecovery(registry, snapshot, project, ctx.env, ctx.trace);

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
    // Spec 2.6: the preparation comes from the base commit, never from the
    // working tree, and a file that cannot be read is never taken as absent.
    const projectConfig = readProjectConfig(project.mainCheckout, base.commit, ctx.env);
    if (!projectConfig.ok) return refuse(C, "project-config-invalid", projectConfig.message, `Fix ${PROJECT_FILE} in a commit and dispatch from it.`);
    if (gitOk(project.mainCheckout, ["show-ref", "--verify", "--quiet", `refs/heads/${task.branch}`], ctx.env)) {
      return refuse(C, "branch-exists", `o branch ${task.branch} já existe`, "Use outro ID ou remova o branch à mão, se ele não guarda trabalho.");
    }
    const worktree = registry.worktreePath(task.id);
    if (existsSync(worktree)) return refuse(C, "worktree-exists", `o path ${worktree} já existe`, "Remova o path à mão, se ele não guarda trabalho.");
    const name = agentName(project.key, task.id);
    if (snapshot.agents.some((a) => a.name === name)) {
      return refuse(C, "agent-name-taken", `o agente ${name} já está vivo no backend`, "Feche a sessão desse agente antes de despachar.");
    }

    // The ID is new, so its task lock is free; held, it is refused like any
    // busy task, before any effect.
    const mine = taskLock(C, registry, task.id);
    if (isOutcome(mine)) return mine;
    own = mine;

    // No refusal is left: the recovery of interrupted tasks is written now,
    // and from here on the decision is recorded and never re-read.
    recovery.publish();
    recovery.release();
    const plan: LaunchPlan = {
      taskId: task.id,
      agentName: name,
      label: workspaceLabel({ id: task.id, agent_name: name }),
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
      project_preparation: {
        file: PROJECT_FILE,
        commit: base.commit,
        present: projectConfig.config.present,
        commands: projectConfig.config.commands,
        prepare_started_at: null,
        process_group: null,
        log: null,
        results: [],
        outcome: null,
        reason: null,
      },
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
    // A failure in the backend is a backend error; one in the core itself,
    // before any session, is a launch error.
    const failLaunch = (reason: string, source: "core" | "backend"): Outcome => {
      transition(registry, record, "launch-failed", { reason }, ctx.trace);
      const v = view(record, null);
      if (source === "backend") v.backend_error = reason;
      else v.launch_error = reason;
      return done(C, 1, [v]);
    };

    // Spec 2.6, step 1: the core creates the branch and the worktree for
    // every harness, with no Git hook: core.hooksPath is a folder created
    // new and private for this creation, so nothing can be in it, and
    // removed right after.
    const noHooks = mkdtempSync(join(registry.dir, "no-hooks-"));
    let added;
    try {
      added = git(project.mainCheckout, ["-c", `core.hooksPath=${noHooks}`, "worktree", "add", "-q", "-b", task.branch, worktree, base.commit], ctx.env);
    } finally {
      rmSync(noHooks, { recursive: true, force: true });
    }
    if (existsSync(worktree) && gitOk(project.mainCheckout, ["show-ref", "--verify", "--quiet", `refs/heads/${task.branch}`], ctx.env)) {
      const resource = { kind: "worktree" as const, path: worktree, branch: task.branch };
      record.created.push(resource);
      record.history.push(entry("created", { ...resource }));
      registry.write(record);
      ctx.trace?.("wrote:created:worktree");
    }
    if (added.code !== 0) return failLaunch(`git worktree add failed: ${added.stderr}`, "core");

    // Spec 2.6, steps 2 to 7: the preparation runs without the project lock,
    // under the task lock, and its outcome is recorded after the project
    // lock is taken back. A failure stops the task before any session.
    const prep = record.project_preparation;
    if (prep !== undefined && prep.commands.length > 0) {
      const log = registry.prepareLogPath(task.id);
      prep.prepare_started_at = new Date().toISOString();
      prep.log = log;
      record.history.push(entry("prepare-started", { commands: prep.commands.length, log }));
      registry.write(record);
      ctx.trace?.("wrote:prepare-started");
      held.release();
      held = null;
      ctx.trace?.("lock-released");
      const outcome = await runPreparation({
        commands: prep.commands,
        worktree,
        env: ctx.env,
        log,
        limits: {
          limitMs: ctx.prepareLimitMs ?? PREPARE_LIMIT_MS,
          graceMs: ctx.prepareGraceMs ?? PREPARE_GRACE_MS,
          settleMs: ctx.prepareSettleMs ?? PREPARE_SETTLE_MS,
        },
        onStart: (index, pgid) => {
          prep.process_group = pgid;
          record.history.push(entry("prepare-command", { index, process_group: pgid }));
          registry.write(record);
          ctx.trace?.(`wrote:prepare-command:${index}`);
        },
      });
      ctx.trace?.("prepare-ran");
      const identity = outcome.ok ? checkIdentity({ mainCheckout: project.mainCheckout, worktree, branch: task.branch, baseCommit: base.commit, env: ctx.env }) : null;
      const failure = !outcome.ok ? outcome.reason : identity !== null ? `the preparation broke the task's identity: ${identity}; log: ${log}` : null;
      prep.results = outcome.results;
      prep.outcome = failure === null ? "succeeded" : "failed";
      prep.reason = failure;
      const back = await lock(C, ctx, registry);
      if (!isLock(back)) {
        // Spec 2.3: recorded under the task lock alone, which is enough for a
        // write to this task's own file.
        const timeoutMs = ctx.lockTimeoutMs ?? 30_000;
        return failLaunch(`${failure === null ? "" : `${failure}; `}could not take the project lock back within ${timeoutMs / 1000} s after the preparation`, "core");
      }
      held = back;
      if (failure !== null) return failLaunch(failure, "core");
      record.history.push(entry("prepared", { results: prep.results.length }));
      registry.write(record);
      ctx.trace?.("wrote:prepared");
    }

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
      launch = { kind: "failed" as const, reason: backendErrorDetail(error), ids: record.backend_ids };
    }
    if (launch.kind === "failed") return failLaunch(launch.reason, "backend");
    if (launch.kind === "blocked") {
      record.request_sent = false;
      transition(registry, record, "launched", { startup: "blocked", request_sent: false }, ctx.trace);
      return done(C, 1, [viewAfterEffect(record, await snapshotAfterEffect(ctx.backend))]);
    }

    record.send_started_at = new Date().toISOString();
    record.history.push(entry("send-started", null));
    registry.write(record);
    ctx.trace?.("wrote:send-started");
    let sent;
    let failure: string | null = null;
    try {
      sent = await ctx.backend.send(name, record.request_text);
    } catch (error) {
      sent = "unknown" as const;
      failure = backendErrorDetail(error);
    }
    record.request_sent = sent === "sent" ? true : sent === "not-ready" ? false : "unknown";
    transition(registry, record, "launched", { request_sent: record.request_sent, ...(failure === null ? {} : { backend_error: failure }) }, ctx.trace);
    const after = await snapshotAfterEffect(ctx.backend);
    return done(C, record.request_sent === true && after.error === null ? 0 : 1, [viewAfterEffect(record, after, failure)]);
  } finally {
    recovery?.release();
    own?.release();
    held?.release();
  }
}
