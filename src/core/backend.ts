import type { BackendIds, Created } from "./types.ts";

// The Demerzel's own backend surface (Spec 1 and 2.5). The herdr backend
// implements it in increment 4; the core only sees these shapes.

export type Probe = {
  running: boolean;
  compatible: boolean;
  versionOk: boolean;
  version: string | null;
  minimum: string;
};

export type SnapshotAgentStatus = "working" | "blocked" | "idle" | "done" | "unknown";

export type Snapshot = {
  agents: Array<{ name: string; status: SnapshotAgentStatus; pane: string }>;
  workspaces: Array<{ id: string; label: string }>;
};

export type LaunchPlan = {
  taskId: string;
  agentName: string;
  label: string;
  harness: string;
  model: string;
  effort: string | null;
  branch: string;
  baseCommit: string;
  worktreePath: string;
  mainCheckout: string;
};

// What the backend decides before any effect, so the core can record it in
// `recorded`: the effort it will apply or omit, and launch data such as the
// Claude Code WorktreeCreate hook.
export type Preparation = {
  effort: { applied: string | null; omittedReason: string | null };
  data: Record<string, unknown>;
};

export type LaunchOutcome =
  | { kind: "ready"; ids: BackendIds }
  | { kind: "blocked"; ids: BackendIds }
  | { kind: "failed"; reason: string; ids: BackendIds };

export type SendOutcome = "sent" | "not-ready" | "unknown";

export interface Backend {
  supportsHarness(harness: string): boolean;
  probe(): Promise<Probe>;
  snapshot(): Promise<Snapshot>;
  prepare(plan: LaunchPlan): Preparation;
  // Each resource is reported through onCreated as soon as it exists; the
  // core records it before the backend moves on. The order of resources is
  // the backend's: worktree before session, or worktree when the agent starts.
  launch(plan: LaunchPlan, preparation: Preparation, onCreated: (resource: Created) => void): Promise<LaunchOutcome>;
  send(agentName: string, text: string): Promise<SendOutcome>;
  closeWorkspace(workspaceId: string): Promise<void>;
}
