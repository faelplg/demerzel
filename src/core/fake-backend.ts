import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Backend, LaunchOutcome, LaunchPlan, Preparation, Probe, SendOutcome, Snapshot, SnapshotAgentStatus } from "./backend.ts";
import type { Env } from "./env.ts";
import { git } from "./git.ts";
import type { BackendIds, Created } from "./types.ts";

// In-memory backend for the core's tests. It creates real Git worktrees so
// branches, dependencies and collect are proven against Git, and lets each
// outcome of Spec 2.5 be injected. With `stateFile`, its state survives across
// processes, for the lock and interruption tests. Reads (probe, snapshot,
// prepare) never write the state file: only effects, which the core runs under
// the project lock, and the test controls do. Every call goes to a separate
// append-only log, so a read in one process cannot erase an effect of another.

export type WorktreeMode = "worktree-first" | "worktree-on-start";
export type EffectPoint = "worktree" | "workspace" | "agent";

export type FakeScript = {
  running: boolean;
  compatible: boolean;
  versionOk: boolean;
  modes: Record<string, WorktreeMode>;
  effortAccepted: boolean;
  startup: "ready" | "blocked";
  failAfter: EffectPoint | null;
  postcondition: "ok" | "fail";
  send: SendOutcome;
  statusAfterSend: SnapshotAgentStatus;
};

export const defaultScript: FakeScript = {
  running: true,
  compatible: true,
  versionOk: true,
  modes: { codex: "worktree-first", "claude-code": "worktree-on-start" },
  effortAccepted: true,
  startup: "ready",
  failAfter: null,
  postcondition: "ok",
  send: "sent",
  statusAfterSend: "working",
};

export type FakeCall = { op: string; effect: boolean; args: Record<string, unknown> };

type State = {
  next: number;
  workspaces: Array<{ id: string; label: string; tab: string | null; pane: string | null }>;
  agents: Array<{ name: string; status: SnapshotAgentStatus; pane: string }>;
  script: FakeScript;
};

export class FakeBackend implements Backend {
  private memory: State;
  private memoryCalls: FakeCall[] = [];
  private readonly stateFile: string | null;
  private readonly callsFile: string | null;

  constructor(private env: Env, options: { script?: Partial<FakeScript>; stateFile?: string } = {}) {
    this.stateFile = options.stateFile ?? null;
    this.callsFile = this.stateFile === null ? null : `${this.stateFile}.calls.jsonl`;
    const loaded = this.stateFile !== null && existsSync(this.stateFile) ? (JSON.parse(readFileSync(this.stateFile, "utf8")) as State) : null;
    this.memory = loaded ?? { next: 1, workspaces: [], agents: [], script: { ...defaultScript } };
    if (options.script !== undefined) this.memory.script = { ...this.memory.script, ...options.script };
    if (loaded === null || options.script !== undefined) this.save();
  }

  private load(): State {
    if (this.stateFile !== null && existsSync(this.stateFile)) this.memory = JSON.parse(readFileSync(this.stateFile, "utf8")) as State;
    return this.memory;
  }

  private save(): void {
    if (this.stateFile === null) return;
    const tmp = `${this.stateFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.memory));
    renameSync(tmp, this.stateFile);
  }

  private log(op: string, effect: boolean, args: Record<string, unknown> = {}): void {
    const call = { op, effect, args };
    if (this.callsFile === null) this.memoryCalls.push(call);
    else appendFileSync(this.callsFile, `${JSON.stringify(call)}\n`);
  }

  // Test controls.
  get calls(): FakeCall[] {
    if (this.callsFile === null) return this.memoryCalls;
    if (!existsSync(this.callsFile)) return [];
    return readFileSync(this.callsFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as FakeCall);
  }
  snapshotNow(): State {
    return this.load();
  }
  effectCalls(): FakeCall[] {
    return this.calls.filter((call) => call.effect);
  }
  script(patch: Partial<FakeScript>): void {
    const state = this.load();
    state.script = { ...state.script, ...patch };
    this.save();
  }
  setAgentStatus(name: string, status: SnapshotAgentStatus): void {
    const agent = this.load().agents.find((a) => a.name === name);
    if (agent === undefined) throw new Error(`no fake agent ${name}`);
    agent.status = status;
    this.save();
  }
  addAgent(name: string, status: SnapshotAgentStatus = "idle"): void {
    this.load().agents.push({ name, status, pane: `external:${name}` });
    this.save();
  }
  // A workspace the backend created whose ID the core never recorded, as when
  // the process dies inside the backend call. It goes first in the list, so a
  // lookup by label meets it before any older workspace with the same label.
  addWorkspace(label: string): string {
    const state = this.load();
    const n = state.next++;
    state.workspaces.unshift({ id: `w${n}`, label, tab: `w${n}:t1`, pane: `w${n}:p1` });
    this.save();
    return `w${n}`;
  }
  // The workspace stays, its pane does not: an agent entry left without a
  // live pane.
  dropPane(workspaceId: string): void {
    const workspace = this.load().workspaces.find((w) => w.id === workspaceId);
    if (workspace === undefined) throw new Error(`no fake workspace ${workspaceId}`);
    workspace.pane = null;
    this.save();
  }
  dropAgent(name: string): void {
    const state = this.load();
    state.agents = state.agents.filter((a) => a.name !== name);
    this.save();
  }

  supportsHarness(harness: string): boolean {
    return harness in this.load().script.modes;
  }

  async probe(): Promise<Probe> {
    const { script } = this.load();
    this.log("probe", false);
    return { running: script.running, compatible: script.compatible, versionOk: script.versionOk, version: script.versionOk ? "0.9.0" : "0.8.0", minimum: "0.9.0", detail: null };
  }

  async snapshot(): Promise<Snapshot> {
    const state = this.load();
    this.log("snapshot", false);
    return { agents: state.agents.map((a) => ({ ...a })), workspaces: state.workspaces.map((w) => ({ ...w })) };
  }

  prepare(plan: LaunchPlan): Preparation {
    const { script } = this.load();
    this.log("prepare", false, { task: plan.taskId });
    const effort = plan.effort === null
      ? { applied: null, omittedReason: null }
      : script.effortAccepted
        ? { applied: plan.effort, omittedReason: null }
        : { applied: null, omittedReason: `o harness não aceita o esforço ${plan.effort}` };
    const mode = script.modes[plan.harness] ?? "worktree-first";
    const data: Record<string, unknown> = mode === "worktree-on-start"
      ? { worktreeCreateHook: { branch: plan.branch, path: plan.worktreePath, base: plan.baseCommit } }
      : {};
    return { effort, data };
  }

  async launch(plan: LaunchPlan, preparation: Preparation, onCreated: (resource: Created) => void): Promise<LaunchOutcome> {
    const { script } = this.load();
    this.log("launch", true, { task: plan.taskId, mode: script.modes[plan.harness], preparation });
    const ids: BackendIds = { workspace: null, tab: null, pane: null };
    const failed = (reason: string): LaunchOutcome => ({ kind: "failed", reason, ids });

    const addWorktree = (): string | null => {
      const r = git(plan.mainCheckout, ["worktree", "add", "-q", "-b", plan.branch, plan.worktreePath, plan.baseCommit], this.env);
      if (r.code !== 0) return r.stderr;
      onCreated({ kind: "worktree", path: plan.worktreePath, branch: plan.branch });
      return null;
    };
    const addWorkspace = (): void => {
      const state = this.load();
      const n = state.next++;
      ids.workspace = `w${n}`;
      ids.tab = `w${n}:t1`;
      ids.pane = `w${n}:p1`;
      state.workspaces.push({ id: ids.workspace, label: plan.label, tab: ids.tab, pane: ids.pane });
      this.save();
      onCreated({ kind: "workspace", id: ids.workspace });
      onCreated({ kind: "tab", id: ids.tab });
      onCreated({ kind: "pane", id: ids.pane });
    };
    const addAgent = (): void => {
      const state = this.load();
      state.agents.push({ name: plan.agentName, status: script.startup === "blocked" ? "blocked" : "idle", pane: ids.pane ?? "" });
      this.save();
      onCreated({ kind: "agent", name: plan.agentName });
    };

    if (script.modes[plan.harness] === "worktree-on-start") {
      addWorkspace();
      if (script.failAfter === "workspace") return failed("falha injetada depois do workspace");
      const error = addWorktree();
      if (error !== null) return failed(error);
      if (script.failAfter === "worktree") return failed("falha injetada depois do worktree");
      addAgent();
      if (script.failAfter === "agent") return failed("falha injetada depois do agente");
      if (script.postcondition === "fail") return failed("pós-condição do lançamento não confere: cwd do agente fora do worktree");
    } else {
      const error = addWorktree();
      if (error !== null) return failed(error);
      if (script.failAfter === "worktree") return failed("falha injetada depois do worktree");
      addWorkspace();
      if (script.failAfter === "workspace") return failed("falha injetada depois do workspace");
      addAgent();
      if (script.failAfter === "agent") return failed("falha injetada depois do agente");
    }
    return { kind: script.startup === "blocked" ? "blocked" : "ready", ids };
  }

  async send(agentName: string, text: string): Promise<SendOutcome> {
    const state = this.load();
    this.log("send", true, { agent: agentName, text });
    const agent = state.agents.find((a) => a.name === agentName);
    if (agent === undefined) return "not-ready";
    if (state.script.send === "sent") {
      agent.status = state.script.statusAfterSend;
      this.save();
    }
    return state.script.send;
  }

  async closeWorkspace(workspaceId: string): Promise<void> {
    const state = this.load();
    this.log("closeWorkspace", true, { workspace: workspaceId });
    const pane = `${workspaceId}:p1`;
    state.workspaces = state.workspaces.filter((w) => w.id !== workspaceId);
    state.agents = state.agents.filter((a) => a.pane !== pane);
    this.save();
  }
}
