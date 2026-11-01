import { existsSync, realpathSync } from "node:fs";
import { BackendError, type Backend, type LaunchOutcome, type LaunchPlan, type Preparation, type Probe, type SendOutcome, type Snapshot, type SnapshotAgentStatus } from "../core/backend.ts";
import type { Env } from "../core/env.ts";
import { git } from "../core/git.ts";
import type { BackendIds, Created } from "../core/types.ts";
import type { HerdrConfig } from "./config.ts";
import { field, Herdr, ident, text } from "./run.ts";

// The herdr implementation of the core backend (Spec 2.5, revision 0.9).

const MINIMUM = "0.9.0";

// Spec 2.5: only effort levels already checked on the installed CLI.
const KIND: Record<string, string> = { "claude-code": "claude", codex: "codex" };
const EFFORT: Record<string, readonly string[]> = {
  "claude-code": ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh"],
};
const AGENT_STATUS = new Set<SnapshotAgentStatus>(["working", "blocked", "idle", "done", "unknown"]);

export type HerdrOptions = {
  startTimeoutMs?: number;
  // How long agent start is retried while the new pane's shell is not ready.
  paneReadyWaitMs?: number;
  promptTimeoutMs?: number;
  // How long the Claude Code postcondition waits for the agent's cwd.
  postconditionWaitMs?: number;
};

export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function versionAtLeast(version: string, minimum: string): boolean {
  const parse = (v: string) => v.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10));
  const a = parse(version);
  const b = parse(minimum);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (Number.isNaN(x)) return false;
    if (x !== y) return x > y;
  }
  return true;
}

// Spec 2.5: the WorktreeCreate hook runs git worktree add with Git's output
// on stderr and prints only the path on stdout.
export function hookSettings(plan: LaunchPlan): string {
  const command = [
    "git", "-C", shQuote(plan.mainCheckout), "worktree", "add", "-b", shQuote(plan.branch), shQuote(plan.worktreePath), shQuote(plan.baseCommit),
  ].join(" ");
  const hook = `${command} >&2 && printf '%s\\n' ${shQuote(plan.worktreePath)}`;
  return JSON.stringify({ hooks: { WorktreeCreate: [{ hooks: [{ type: "command", command: hook }] }] } });
}

// Spec 2.3 and 6: a diagnosis never carries the request. The whole text and
// each of its longer lines are taken out of a message before it is kept.
export function redact(message: string, request: string): string {
  // Short pieces are left alone: removing a one-letter request would
  // garble every word of the diagnosis.
  let out = request.trim().length >= 8 ? message.split(request).join("[pedido]") : message;
  for (const line of request.split("\n")) {
    const piece = line.trim();
    if (piece.length >= 8) out = out.split(piece).join("[pedido]");
  }
  return out;
}

function sameDir(a: string | null, b: string): boolean {
  if (a === null || !existsSync(a) || !existsSync(b)) return false;
  return realpathSync(a) === realpathSync(b);
}

export class HerdrBackend implements Backend {
  private herdr: Herdr;

  constructor(
    private env: Env,
    config: HerdrConfig,
    private options: HerdrOptions = {},
  ) {
    this.herdr = new Herdr(env, config.session);
  }

  // Own keys only: a name such as constructor or __proto__ exists on every
  // object and is not a harness.
  supportsHarness(harness: string): boolean {
    return Object.hasOwn(KIND, harness);
  }

  async probe(): Promise<Probe> {
    const down = (detail: string): Probe => ({ running: false, compatible: false, versionOk: false, version: null, minimum: MINIMUM, detail });
    let proc;
    try {
      proc = this.herdr.exec(["status", "--json"]);
    } catch (error) {
      return down(`herdr não encontrado no PATH: ${error instanceof Error ? error.message : String(error)}`);
    }
    // A status run that fails is not a usable backend, whatever it printed.
    if (proc.exitCode !== 0) {
      const said = proc.stderr;
      return down(`herdr status --json saiu com ${proc.exitCode ?? "?"}${said === "" ? "" : `: ${said.slice(0, 300)}`}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(proc.stdout);
    } catch {
      const said = proc.stderr || proc.stdout;
      return down(`herdr status --json não devolveu JSON (saída ${proc.exitCode ?? "?"})${said === "" ? "" : `: ${said.slice(0, 300)}`}`);
    }
    const running = field(data, "server", "running") === true;
    const compatible = field(data, "server", "compatible") === true;
    const version = text(data, "server", "version");
    if (!running) return { ...down(`servidor do herdr parado${text(data, "server", "session") ? ` na sessão ${text(data, "server", "session")}` : ""}`), version };
    return { running, compatible, versionOk: version !== null && versionAtLeast(version, MINIMUM), version, minimum: MINIMUM, detail: compatible ? null : "cliente e servidor do herdr incompatíveis" };
  }

  async snapshot(): Promise<Snapshot> {
    const reply = this.herdr.run(["api", "snapshot"]);
    if (!reply.ok) throw new BackendError("herdr api snapshot", `${reply.code}: ${reply.message}`);
    const snap = field(reply.result, "snapshot");
    const list = (key: string): Record<string, unknown>[] => {
      const value = field(snap, key);
      if (!Array.isArray(value)) throw new BackendError("herdr api snapshot", `snapshot sem a lista ${key}`);
      return value as Record<string, unknown>[];
    };
    const broken = (detail: string): never => {
      throw new BackendError("herdr api snapshot", detail);
    };
    // Agents without a name are not the Demerzel's and are left out. A named
    // agent without its pane or state is a broken answer, never an absent
    // agent: dropping it would let close end a working agent.
    const agents = list("agents").flatMap((a) => {
      const name = ident(a, "name");
      if (name === null) return [];
      const pane = ident(a, "pane_id");
      if (pane === null) return broken(`agente ${name} sem pane_id`);
      const raw = text(a, "agent_status") ?? broken(`agente ${name} sem agent_status`);
      const status = AGENT_STATUS.has(raw as SnapshotAgentStatus) ? (raw as SnapshotAgentStatus) : "unknown";
      return [{ name, status, pane }];
    });
    const tabs = list("tabs");
    const panes = list("panes");
    // The herdr does not mark a root pane, and the core sees one pane per
    // workspace. A pane that holds a named agent must never be the one left
    // out, or a working agent would look lost. So the pane of a workspace is
    // the pane of the agent its label names (Spec 2.5: task ID, a space and
    // the agent name); if the label no longer names an agent in it, as after
    // a human renamed it, the pane of the first named agent in it, by tab
    // number; and only without agents, the first pane of the lowest tab.
    const byNumber = (x: Record<string, unknown>, y: Record<string, unknown>): number => Number(field(x, "number") ?? 0) - Number(field(y, "number") ?? 0);
    const workspaces = list("workspaces").map((w) => {
      const id = ident(w, "workspace_id") ?? broken("workspace sem workspace_id");
      const label = text(w, "label") ?? "";
      const own = tabs.filter((t) => text(t, "workspace_id") === id).sort(byNumber);
      const ownPanes = panes.filter((p) => text(p, "workspace_id") === id);
      const tabOrder = (p: Record<string, unknown>): number => {
        const i = own.findIndex((t) => ident(t, "tab_id") === text(p, "tab_id"));
        return i === -1 ? own.length : i;
      };
      const withAgent = ownPanes.filter((p) => agents.some((a) => a.pane === ident(p, "pane_id"))).sort((x, y) => tabOrder(x) - tabOrder(y));
      const named = label.split(" ").at(-1) ?? "";
      const chosen = withAgent.find((p) => agents.some((a) => a.name === named && a.pane === ident(p, "pane_id"))) ?? withAgent[0];
      if (chosen !== undefined) return { id, label, tab: ident(chosen, "tab_id"), pane: ident(chosen, "pane_id") };
      const tab = own.length > 0 ? ident(own[0], "tab_id") : null;
      const pane = tab === null ? null : (ownPanes.map((p) => (text(p, "tab_id") === tab ? ident(p, "pane_id") : null)).find((p) => p !== null) ?? null);
      return { id, label, tab, pane };
    });
    return { agents, workspaces };
  }

  prepare(plan: LaunchPlan): Preparation {
    const allowed = Object.hasOwn(EFFORT, plan.harness) ? (EFFORT[plan.harness] ?? []) : [];
    const effort =
      plan.effort === null
        ? { applied: null, omittedReason: null }
        : allowed.includes(plan.effort)
          ? { applied: plan.effort, omittedReason: null }
          : { applied: null, omittedReason: `nível ${plan.effort} não conferido para ${plan.harness}; conferidos: ${allowed.join(", ")}` };
    const data: Record<string, unknown> = plan.harness === "claude-code" ? { worktreeName: plan.agentName, settings: hookSettings(plan) } : {};
    return { effort, data };
  }

  private modelArgs(plan: LaunchPlan, preparation: Preparation): string[] {
    const effort = preparation.effort.applied;
    if (plan.harness === "codex") return ["--model", plan.model, ...(effort === null ? [] : ["-c", `model_reasoning_effort=${effort}`])];
    return ["--model", plan.model, ...(effort === null ? [] : ["--effort", effort])];
  }

  // Starts the agent and reads the answer as ready, blocked or failed. A pane
  // just opened may not have its shell ready yet; herdr then answers
  // agent_pane_busy and starts nothing, so trying again is safe. Ready needs
  // a confirmation that names this agent; any other success, a broken answer
  // or a transport error is failed, never thrown, so the caller can still
  // list what the launch created.
  private async startAgent(name: string, args: string[]): Promise<{ kind: "ready" | "blocked" } | { kind: "failed"; reason: string }> {
    const deadline = Date.now() + (this.options.paneReadyWaitMs ?? 10_000);
    for (;;) {
      let reply;
      try {
        reply = this.herdr.run(args);
      } catch (error) {
        return { kind: "failed", reason: error instanceof BackendError ? `${error.command}: ${error.detail}` : String(error) };
      }
      if (reply.ok) {
        const confirmed = text(reply.result, "agent", "name");
        if (confirmed === name) return { kind: "ready" };
        return { kind: "failed", reason: `herdr agent start: confirmação sem o agente ${name} (${confirmed ?? "nenhum nome"})` };
      }
      if (reply.code === "agent_not_ready") return { kind: "blocked" };
      if (reply.code !== "agent_pane_busy" || Date.now() >= deadline) return { kind: "failed", reason: `herdr agent start: ${reply.code}: ${reply.message}` };
      await Bun.sleep(250);
    }
  }

  // Runs one herdr command whose answer confirms a resource; a broken answer
  // is a failure reason, never an exception, so the launch can reconcile.
  private create(args: string[]): { ok: true; result: Record<string, unknown> } | { ok: false; reason: string } {
    const command = `herdr ${args.slice(0, 2).join(" ")}`;
    try {
      const reply = this.herdr.run(args);
      return reply.ok ? { ok: true, result: reply.result } : { ok: false, reason: `${command}: ${reply.code}: ${reply.message}` };
    } catch (error) {
      return { ok: false, reason: error instanceof BackendError ? `${error.command}: ${error.detail}` : String(error) };
    }
  }

  async launch(plan: LaunchPlan, preparation: Preparation, onCreated: (resource: Created) => void): Promise<LaunchOutcome> {
    const ids: BackendIds = { workspace: null, tab: null, pane: null };
    const kind = Object.hasOwn(KIND, plan.harness) ? KIND[plan.harness] : undefined;
    if (kind === undefined) return { kind: "failed", reason: `harness sem lançamento no backend herdr: ${plan.harness}`, ids };

    // A resource enters the registry once, and only when it is confirmed.
    const reported = new Set<string>();
    const report = (resource: Created): void => {
      if (reported.has(resource.kind)) return;
      reported.add(resource.kind);
      if (resource.kind === "workspace") ids.workspace = resource.id;
      if (resource.kind === "tab") ids.tab = resource.id;
      if (resource.kind === "pane") ids.pane = resource.id;
      onCreated(resource);
    };
    const branchCommit = (): string | null => {
      const r = git(plan.mainCheckout, ["rev-parse", "--verify", "--quiet", `refs/heads/${plan.branch}`], this.env);
      return r.code === 0 ? r.stdout : null;
    };
    const worktreeConfirmed = (): boolean => existsSync(plan.worktreePath) && branchCommit() !== null;
    const reportWorktree = (): void => {
      if (worktreeConfirmed()) report({ kind: "worktree", path: plan.worktreePath, branch: plan.branch });
    };
    const reportSession = (result: Record<string, unknown>): string | null => {
      const workspace = ident(result, "workspace", "workspace_id");
      const tab = ident(result, "tab", "tab_id") ?? ident(result, "root_pane", "tab_id");
      const pane = ident(result, "root_pane", "pane_id");
      if (workspace === null || pane === null) return null;
      report({ kind: "workspace", id: workspace });
      if (tab !== null) report({ kind: "tab", id: tab });
      report({ kind: "pane", id: pane });
      return pane;
    };
    // When a confirmation is lost or broken, the real state decides what the
    // launch created: the workspace by its label, unique across projects; the
    // agent by its name; the worktree by Git. Nothing is created here.
    const failed = async (reason: string): Promise<LaunchOutcome> => {
      const order = plan.harness === "codex" ? ["worktree", "session", "agent"] : ["session", "worktree", "agent"];
      let snap: Snapshot | null = null;
      try {
        snap = await this.snapshot();
      } catch {
        snap = null;
      }
      for (const step of order) {
        if (step === "worktree") reportWorktree();
        if (step === "session" && snap !== null) {
          const w = snap.workspaces.find((x) => x.label === plan.label);
          if (w !== undefined) {
            report({ kind: "workspace", id: w.id });
            if (w.tab !== null) report({ kind: "tab", id: w.tab });
            if (w.pane !== null) report({ kind: "pane", id: w.pane });
          }
        }
        if (step === "agent" && snap !== null && snap.agents.some((a) => a.name === plan.agentName)) report({ kind: "agent", name: plan.agentName });
      }
      return { kind: "failed", reason, ids };
    };
    const startTimeout = String(this.options.startTimeoutMs ?? 90_000);

    if (plan.harness === "codex") {
      const created = this.create([
        "worktree", "create", "--cwd", plan.mainCheckout, "--branch", plan.branch, "--base", plan.baseCommit, "--path", plan.worktreePath, "--label", plan.label, "--no-focus",
      ]);
      if (!created.ok) return failed(created.reason);
      reportWorktree();
      if (!reported.has("worktree")) return failed("herdr worktree create: confirmação sem worktree no Git");
      const pane = reportSession(created.result);
      if (pane === null) return failed("herdr worktree create: confirmação sem workspace ou root_pane");
      const started = await this.startAgent(plan.agentName, ["agent", "start", plan.agentName, "--kind", kind, "--pane", pane, "--timeout", startTimeout, "--", ...this.modelArgs(plan, preparation)]);
      if (started.kind === "failed") return failed(started.reason);
      report({ kind: "agent", name: plan.agentName });
      return { kind: started.kind, ids };
    }

    // Claude Code: the session opens at the project root and Claude Code
    // creates the worktree through the WorktreeCreate hook.
    const settings = preparation.data["settings"];
    const worktreeName = preparation.data["worktreeName"];
    if (typeof settings !== "string" || typeof worktreeName !== "string") return { kind: "failed", reason: "preparo do Claude Code sem settings ou nome de worktree", ids };
    if (/[\n\r]/.test(plan.worktreePath) || /[\n\r]/.test(plan.mainCheckout)) return { kind: "failed", reason: "path com quebra de linha não cabe no protocolo do hook WorktreeCreate", ids };
    const created = this.create(["workspace", "create", "--cwd", plan.mainCheckout, "--label", plan.label, "--no-focus"]);
    if (!created.ok) return failed(created.reason);
    const pane = reportSession(created.result);
    if (pane === null) return failed("herdr workspace create: confirmação sem workspace ou root_pane");
    const started = await this.startAgent(plan.agentName, [
      "agent", "start", plan.agentName, "--kind", kind, "--pane", pane, "--timeout", startTimeout, "--", "--worktree", worktreeName, "--settings", settings, ...this.modelArgs(plan, preparation),
    ]);
    // The hook may have created the worktree even when agent start fails or
    // answers badly: it is listed on every path, and a failure reconciles.
    reportWorktree();
    if (started.kind === "failed") return failed(started.reason);

    // Spec 2.5, revision 0.9: the postcondition holds also on a blocked
    // startup, so resume never sends to a worktree nobody checked.
    report({ kind: "agent", name: plan.agentName });
    const { cwd, error } = await this.agentCwd(plan.agentName, plan.worktreePath);
    const commit = branchCommit();
    const problems: string[] = [];
    if (!sameDir(cwd, plan.worktreePath)) problems.push(`cwd do agente ${cwd ?? "desconhecido"} não é o worktree ${plan.worktreePath}${error === null ? "" : ` (${error})`}`);
    if (commit === null) problems.push(`branch ${plan.branch} não existe`);
    else if (commit !== plan.baseCommit) problems.push(`branch ${plan.branch} aponta para ${commit}, não para o commit base ${plan.baseCommit}`);
    if (problems.length > 0) return failed(`pós-condição do lançamento no Claude Code: ${problems.join("; ")}`);
    return { kind: started.kind, ids };
  }

  // The agent's foreground cwd, read a few times while Claude Code moves into
  // the worktree, with the herdr error of the last read, if it failed, so
  // the failure names the command and the error (Spec 2.3, H13).
  private async agentCwd(name: string, expected: string): Promise<{ cwd: string | null; error: string | null }> {
    const deadline = Date.now() + (this.options.postconditionWaitMs ?? 3_000);
    for (;;) {
      let cwd: string | null = null;
      let error: string | null = null;
      try {
        const got = this.herdr.run(["agent", "get", name]);
        if (got.ok) cwd = text(got.result, "agent", "foreground_cwd");
        else error = `herdr agent get: ${got.code}: ${got.message}`;
      } catch (e) {
        if (!(e instanceof BackendError)) throw e;
        error = `${e.command}: ${e.detail}`;
      }
      if (sameDir(cwd, expected) || Date.now() >= deadline) return { cwd, error };
      await Bun.sleep(200);
    }
  }

  // Spec 2.5: confirmed is sent; an agent blocked before receiving is
  // not-ready. Anything else, including a stall, a timeout or a success
  // without the agent's state, may or may not have delivered: it is a
  // BackendError, which the core records as request_sent unknown with the
  // detail.
  async send(agentName: string, requestText: string): Promise<SendOutcome> {
    const timeout = String(this.options.promptTimeoutMs ?? 30_000);
    // Every diagnosis below is built from herdr's answer and passes through
    // redact as a whole, whatever field the request could have come back in.
    const fail = (detail: string): never => {
      throw new BackendError("herdr agent prompt", redact(detail, requestText));
    };
    let reply;
    try {
      reply = this.herdr.run(["agent", "prompt", agentName, requestText, "--wait", "--until", "working", "--until", "blocked", "--timeout", timeout]);
    } catch (error) {
      return fail(error instanceof BackendError ? error.detail : String(error));
    }
    if (reply.ok) {
      const state = text(reply.result, "agent", "agent_status");
      const name = text(reply.result, "agent", "name");
      if (name !== agentName) return fail(`confirmação de outro agente (${name ?? "nenhum nome"})`);
      if (state !== null && AGENT_STATUS.has(state as SnapshotAgentStatus) && state !== "unknown") return "sent";
      return fail(`confirmação sem o estado do agente (${state ?? "ausente"})`);
    }
    if (reply.code === "agent_not_ready" || reply.code === "agent_blocked") return "not-ready";
    return fail(`${reply.code}: ${reply.message}`);
  }

  // herdr 0.9.0 confirms a close with result.type "ok". Any other success is
  // not a close; a workspace that is already gone is.
  async closeWorkspace(workspaceId: string): Promise<void> {
    const reply = this.herdr.run(["workspace", "close", workspaceId]);
    if (reply.ok) {
      if (text(reply.result, "type") === "ok") return;
      throw new BackendError("herdr workspace close", `confirmação sem type ok (${text(reply.result, "type") ?? "ausente"})`);
    }
    if (reply.code !== "workspace_not_found") throw new BackendError("herdr workspace close", `${reply.code}: ${reply.message}`);
  }
}
