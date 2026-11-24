import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { BackendError, type Backend, type CheckOutcome, type LaunchCheck, type LaunchOutcome, type LaunchPlan, type Preparation, type Probe, type SendOutcome, type Snapshot, type SnapshotAgentStatus, type WorkspaceLookup } from "./backend.ts";
import { resolveWorkspace } from "./workspace.ts";
import type { Env } from "./env.ts";
import type { BackendIds, Created } from "./types.ts";

// In-memory backend for the core's tests. Since Spec 0.15 the core creates
// the branch and the worktree, so this backend only opens sessions and
// starts agents, and lets each outcome of Spec 2.5 be injected. With `stateFile`, its state survives across
// processes, for the lock and interruption tests. Reads (probe, snapshot,
// prepare) never write the state file: only effects, which the core runs under
// the project lock, and the test controls do. Every call goes to a separate
// append-only log, so a read in one process cannot erase an effect of another.

// Where the agent starts, as in the herdr backend: "worktree-first" opens the
// session in the worktree the core created (Codex); "worktree-on-start"
// opens it at the project root and the agent enters the worktree when it
// starts (Claude Code), which is the mode with a launch postcondition.
export type WorktreeMode = "worktree-first" | "worktree-on-start";
export type EffectPoint = "worktree" | "tab" | "agent";

export type FakeScript = {
  running: boolean;
  compatible: boolean;
  versionOk: boolean;
  modes: Record<string, WorktreeMode>;
  effortAccepted: boolean;
  startup: "ready" | "blocked";
  failAfter: EffectPoint | null;
  postcondition: "ok" | "fail";
  // The launch check of Spec 2.5, revision 0.10, for harnesses whose
  // worktree is created when the agent starts: it holds, does not hold, or
  // the backend fails while reading. Harnesses whose worktree comes first
  // have no postcondition and always hold, as in the herdr backend.
  verify: "ok" | "fail" | "error";
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
  verify: "ok",
  send: "sent",
  statusAfterSend: "working",
};

export type FakeCall = { op: string; effect: boolean; args: Record<string, unknown> };

type State = {
  next: number;
  workspaces: Snapshot["workspaces"];
  tabs: Snapshot["tabs"];
  agents: Snapshot["agents"];
  script: FakeScript;
};

export class FakeBackend implements Backend {
  private memory: State;
  private memoryCalls: FakeCall[] = [];
  private readonly stateFile: string | null;
  private readonly callsFile: string | null;

  constructor(_env: Env, options: { script?: Partial<FakeScript>; stateFile?: string } = {}) {
    this.stateFile = options.stateFile ?? null;
    this.callsFile = this.stateFile === null ? null : `${this.stateFile}.calls.jsonl`;
    const loaded = this.stateFile !== null && existsSync(this.stateFile) ? (JSON.parse(readFileSync(this.stateFile, "utf8")) as State) : null;
    this.memory = loaded ?? { next: 1, workspaces: [{ id: "w1", label: "project" }], tabs: [{ id: "w1:t0", workspace: "w1", label: "1", pane: "w1:p0" }], agents: [], script: { ...defaultScript } };
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
    this.load().agents.push({ name, status, pane: `external:${name}`, tab: null });
    this.save();
  }
  addWorkspace(label: string): string {
    const state = this.load();
    const id = `external-w${state.next++}`;
    state.workspaces.push({ id, label });
    this.save();
    return id;
  }
  addTab(label: string, workspace = "w1"): string {
    const state = this.load();
    const n = state.next++;
    const id = `w1:t${n}`;
    state.tabs.push({ id, workspace, label, pane: `w1:p${n}` });
    this.save();
    return id;
  }
  dropPane(tabId: string): void {
    const tab = this.load().tabs.find((t) => t.id === tabId);
    if (tab === undefined) throw new Error(`no fake tab ${tabId}`);
    tab.pane = null;
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
    const seen = new Set<string>();
    for (const tab of state.tabs) {
      if (!/^\S+ dz-[0-9a-f]{16}$/.test(tab.label)) continue;
      const key = JSON.stringify([tab.workspace, tab.label]);
      if (seen.has(key)) throw new BackendError("fake snapshot", "duplicate task tab label");
      seen.add(key);
    }
    const tabs = state.tabs.map((tab) => {
      if (tab.pane === null) return tab;
      const agents = state.agents.filter((a) => a.tab === tab.id);
      const ours = agents.filter((a) => /^dz-[0-9a-f]{16}$/.test(a.name));
      if (new Set(ours.map((a) => a.pane)).size > 1) throw new BackendError("fake snapshot", "multiple Demerzel panes in one tab");
      return { ...tab, pane: (ours[0] ?? agents[0])?.pane ?? tab.pane };
    });
    return structuredClone({ agents: state.agents, workspaces: state.workspaces, tabs });
  }

  resolveWorkspace(mainCheckout: string, snapshot: Snapshot): WorkspaceLookup {
    return resolveWorkspace(mainCheckout, snapshot);
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
    const data: Record<string, unknown> = mode === "worktree-on-start" ? { worktreeCreateHook: { path: plan.worktreePath } } : {};
    return { effort, data };
  }

  async launch(plan: LaunchPlan, preparation: Preparation, onCreated: (resource: Created) => void): Promise<LaunchOutcome> {
    const { script } = this.load();
    this.log("launch", true, { task: plan.taskId, mode: script.modes[plan.harness], preparation });
    const ids: BackendIds = { workspace: plan.projectWorkspace.id, tab: null, pane: null };
    const failed = (reason: string): LaunchOutcome => ({ kind: "failed", reason, ids });

    const addTab = (): void => {
      ids.tab = this.addTab(plan.label, plan.projectWorkspace.id);
      ids.pane = this.load().tabs.find((t) => t.id === ids.tab)?.pane ?? null;
      onCreated({ kind: "tab", id: ids.tab });
      if (ids.pane !== null) onCreated({ kind: "pane", id: ids.pane });
    };
    const addAgent = (): void => {
      const state = this.load();
      state.agents.push({ name: plan.agentName, status: script.startup === "blocked" ? "blocked" : "idle", pane: ids.pane ?? "", tab: ids.tab });
      this.save();
      onCreated({ kind: "agent", name: plan.agentName });
    };

    // The worktree already exists: "worktree" injects a failure before the
    // backend's first effect.
    if (script.failAfter === "worktree") return failed("falha injetada depois do worktree");
    if (!this.load().workspaces.some((w) => w.id === plan.projectWorkspace.id)) return failed("Recorded project workspace no longer exists");
    addTab();
    if (script.failAfter === "tab") return failed("Injected failure after tab creation");
    addAgent();
    if (script.failAfter === "agent") return failed("falha injetada depois do agente");
    if (script.modes[plan.harness] === "worktree-on-start" && script.postcondition === "fail") return failed("pós-condição do lançamento não confere: cwd do agente fora do worktree");
    return { kind: script.startup === "blocked" ? "blocked" : "ready", ids };
  }

  async verifyLaunch(check: LaunchCheck): Promise<CheckOutcome> {
    const { script } = this.load();
    this.log("verifyLaunch", false, { ...check });
    if (script.modes[check.harness] !== "worktree-on-start") return { ok: true };
    if (script.verify === "error") throw new BackendError("fake verifyLaunch", "falha injetada na conferência");
    if (script.verify === "fail") return { ok: false, reason: "pós-condição do lançamento não confere: cwd do agente fora do worktree" };
    return { ok: true };
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

  async closeTab(tabId: string): Promise<void> {
    const state = this.load();
    this.log("closeTab", true, { tab: tabId });
    const tab = state.tabs.find((t) => t.id === tabId);
    state.tabs = state.tabs.filter((t) => t.id !== tabId);
    state.agents = state.agents.filter((a) => a.tab !== tabId);
    if (tab !== undefined && !state.tabs.some((t) => t.workspace === tab.workspace)) state.workspaces = state.workspaces.filter((w) => w.id !== tab.workspace);
    this.save();
  }
}
