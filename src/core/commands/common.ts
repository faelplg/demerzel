import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Backend, Probe, Snapshot } from "../backend.ts";
import { loadConfig, type Config } from "../config.ts";
import type { Env } from "../env.ts";
import { gitOk } from "../git.ts";
import { ProjectLock } from "../lock.ts";
import { resolveProject, type Project } from "../project.ts";
import { entry, Registry } from "../registry.ts";
import type { AgentState, Created, ReportState, TaskRecord } from "../types.ts";

export type Context = {
  cwd: string;
  env: Env;
  backend: Backend;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  lockTimeoutMs?: number;
  lockIntervalMs?: number;
  waitIntervalMs?: number;
  // Called after each registry write and lock event; tests use it to stop
  // or pause a process at a precise point. It never changes behavior.
  trace?: (event: string) => void;
};

export type Refusal = { code: string; message: string; next: string; hold: boolean };

export type TaskView = {
  id: string;
  lifecycle: TaskRecord["lifecycle"];
  agent: AgentState | null;
  report: ReportState | null;
  interrupted: boolean;
  harness: string;
  model: string;
  effort: TaskRecord["effort"];
  branch: string;
  base: TaskRecord["base"];
  worktree: string;
  backend_ids: TaskRecord["backend_ids"];
  agent_name: string;
  request_sent: TaskRecord["request_sent"];
  created: Created[];
  provenance: Record<string, string>;
  created_at: string | null;
  updated_at: string | null;
  collected?: { content: string; path: string; digest: string; digest_changed: boolean };
  discard?: { removed: boolean; reason: string | null };
};

export type Envelope = { ok: boolean; command: string; tasks: TaskView[]; refusal: Refusal | null };
export type Outcome = { code: 0 | 1 | 2; envelope: Envelope };

export function refuse(command: string, code: string, message: string, next: string, hold = false): Outcome {
  return { code: 2, envelope: { ok: false, command, tasks: [], refusal: { code, message, next, hold } } };
}

export function done(command: string, code: 0 | 1, tasks: TaskView[]): Outcome {
  return { code, envelope: { ok: true, command, tasks, refusal: null } };
}

export type Session = { project: Project; registry: Registry; config: Config };

// not-a-project and config-invalid come first: without a project there is no
// registry, and without a valid configuration nothing else is trusted.
export function open(command: string, ctx: Context): Session | Outcome {
  const project = resolveProject(ctx.cwd, ctx.env);
  if (project === null) {
    return refuse(command, "not-a-project", `${ctx.cwd} não está num repositório Git`, "Rode o comando dentro do checkout do projeto.");
  }
  const config = loadConfig(ctx.env);
  if (!config.ok) return refuse(command, "config-invalid", config.message, "Corrija a configuração do Demerzel e rode de novo.");
  return { project, registry: new Registry(project.dir), config: config.config };
}

export function isOutcome(value: Session | Outcome): value is Outcome {
  return "envelope" in value;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function clock(ctx: Context): { now: () => number; sleep: (ms: number) => Promise<void> } {
  return { now: ctx.now ?? (() => Date.now()), sleep: ctx.sleep ?? realSleep };
}

export async function lock(command: string, ctx: Context, registry: Registry): Promise<ProjectLock | Outcome> {
  registry.ensure();
  const { now, sleep } = clock(ctx);
  const timeoutMs = ctx.lockTimeoutMs ?? 30_000;
  const options = { now, sleep, timeoutMs, intervalMs: ctx.lockIntervalMs ?? 50, ...(ctx.trace ? { trace: ctx.trace } : {}) };
  const held = await ProjectLock.acquire(registry.lockPath, options);
  if (held === null) {
    return refuse(command, "project-locked", `o lock do projeto ficou ocupado por mais de ${timeoutMs / 1000} s`, "Espere o outro comando do Demerzel terminar e rode de novo.");
  }
  return held;
}

export function isLock(value: ProjectLock | Outcome): value is ProjectLock {
  return value instanceof ProjectLock;
}

export async function reachBackend(command: string, backend: Backend): Promise<Probe | Outcome> {
  const probe = await backend.probe();
  if (!probe.running || !probe.compatible) {
    return refuse(command, "backend-unavailable", "o backend não está rodando ou não é compatível", "Suba o servidor do herdr na sessão configurada e rode de novo.");
  }
  if (!probe.versionOk) {
    return refuse(command, "backend-version", `versão do backend ${probe.version ?? "desconhecida"} abaixo da mínima ${probe.minimum}`, `Atualize o herdr para ${probe.minimum} ou acima.`);
  }
  return probe;
}

export function isProbe(value: Probe | Outcome): value is Probe {
  return !("envelope" in value);
}

export function agentState(record: TaskRecord, snapshot: Snapshot): AgentState {
  const agent = snapshot.agents.find((a) => a.name === record.agent_name);
  if (agent === undefined) return "lost";
  if (agent.status === "done") return "idle";
  return agent.status;
}

export function reportState(record: TaskRecord): ReportState {
  return existsSync(join(record.worktree, record.task.returnPath)) ? "present" : "absent";
}

const OBSERVED = new Set<TaskRecord["lifecycle"]>(["launched", "collected"]);

export function view(record: TaskRecord, snapshot: Snapshot | null, options: { interrupted?: boolean; observeAgent?: boolean } = {}): TaskView {
  const observed = OBSERVED.has(record.lifecycle);
  const first = record.history[0];
  const last = record.history[record.history.length - 1];
  return {
    id: record.id,
    lifecycle: record.lifecycle,
    agent: observed && snapshot !== null && options.observeAgent !== false ? agentState(record, snapshot) : null,
    report: observed ? reportState(record) : null,
    interrupted: options.interrupted ?? false,
    harness: record.harness,
    model: record.model,
    effort: record.effort,
    branch: record.branch,
    base: record.base,
    worktree: record.worktree,
    backend_ids: record.backend_ids,
    agent_name: record.agent_name,
    request_sent: record.request_sent,
    created: record.created,
    provenance: record.provenance,
    created_at: first?.at ?? null,
    updated_at: last?.at ?? null,
  };
}

export function transition(registry: Registry, record: TaskRecord, lifecycle: TaskRecord["lifecycle"], detail: Record<string, unknown> | null, trace?: (event: string) => void): void {
  record.lifecycle = lifecycle;
  record.history.push(entry(lifecycle, detail));
  registry.write(record);
  trace?.(`wrote:${lifecycle}`);
}

// Spec 2.5, revision 0.8: the task ID, a space and the agent name. The ID is
// what the human reads; the agent name makes the label unique across
// projects that share the backend. A recovery looks a workspace up by it
// only when its ID was never recorded.
export function workspaceLabel(record: Pick<TaskRecord, "id" | "agent_name">): string {
  return `${record.id} ${record.agent_name}`;
}

// Spec 2.3: a command that holds the lock and talks to the backend finds a
// task in `recorded` or `launching` only if its dispatch was interrupted.
// The recovery is computed here in memory and written by `publish` only
// when the command goes on to act; a refusal leaves every task file as it
// was (Spec 5). Nothing is relaunched or resent.
export type Recovery = { records: TaskRecord[]; recovered: TaskRecord[]; publish: () => void };

export function planRecovery(registry: Registry, snapshot: Snapshot, project: Project, env: Env, trace?: (event: string) => void): Recovery {
  const records = registry.list();
  const recovered: TaskRecord[] = [];
  for (const record of records) {
    if (record.lifecycle !== "recorded" && record.lifecycle !== "launching") continue;
    const from = record.lifecycle;
    recovered.push(record);
    if (from === "recorded") {
      record.created = [];
      record.lifecycle = "launch-failed";
      record.history.push(entry("launch-failed", { reason: "interrupted", from }));
      continue;
    }
    const found: Created[] = [];
    if (gitOk(project.mainCheckout, ["show-ref", "--verify", "--quiet", `refs/heads/${record.branch}`], env) && existsSync(record.worktree)) {
      found.push({ kind: "worktree", path: record.worktree, branch: record.branch });
    }
    const known = record.backend_ids.workspace;
    const workspace = known !== null
      ? snapshot.workspaces.find((w) => w.id === known)
      : snapshot.workspaces.find((w) => w.label === workspaceLabel(record));
    if (workspace !== undefined) {
      record.backend_ids.workspace = workspace.id;
      found.push({ kind: "workspace", id: workspace.id });
      if (workspace.tab !== null) {
        record.backend_ids.tab = workspace.tab;
        found.push({ kind: "tab", id: workspace.tab });
      }
      if (workspace.pane !== null) {
        record.backend_ids.pane = workspace.pane;
        found.push({ kind: "pane", id: workspace.pane });
      }
    }
    const agent = snapshot.agents.find((a) => a.name === record.agent_name);
    if (agent !== undefined) found.push({ kind: "agent", name: agent.name });
    record.created = found;
    if (agent !== undefined) {
      record.request_sent = record.send_started_at !== null ? "unknown" : false;
      record.lifecycle = "launched";
      record.history.push(entry("launched", { reason: "interrupted", from, request_sent: record.request_sent }));
    } else {
      record.lifecycle = "launch-failed";
      record.history.push(entry("launch-failed", { reason: "interrupted", from }));
    }
  }
  return {
    records,
    recovered,
    publish: () => {
      for (const record of recovered) {
        registry.write(record);
        trace?.(`wrote:recovered:${record.id}`);
      }
    },
  };
}

export function notFound(command: string, id: string): Outcome {
  return refuse(command, "task-not-found", `nenhuma tarefa ${id} no registro deste projeto`, "Confira o ID com `demerzel status --all`.");
}

export function wrongLifecycle(command: string, record: TaskRecord, accepted: string): Outcome {
  return refuse(command, "wrong-lifecycle", `${command} não aceita a tarefa ${record.id} em ${record.lifecycle}; aceita ${accepted}`, "Confira o estado com `demerzel status`.");
}
