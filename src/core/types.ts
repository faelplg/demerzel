// Shapes shared by the core. The Spec (docs/project/SPEC.md, section 2) is
// the source; these types only mirror it.

export type PathPointer = { label: string; path: string };
export type RefPointer = { label: string; ref: string };
export type Pointer = PathPointer | RefPointer;

export type Request = { role: string; pointers: Pointer[] };

export type Task = {
  id: string;
  harness: string;
  model: string;
  effort?: string;
  branch: string;
  base?: string;
  writes: string[];
  dependsOn: string[];
  request: Request;
  returnPath: string;
  approval?: "human";
  provenance: Record<string, string>;
};

export type Lifecycle =
  | "recorded"
  | "launching"
  | "launch-failed"
  | "launched"
  | "collected"
  | "closed";

export type AgentState = "working" | "blocked" | "idle" | "unknown" | "lost";
export type ReportState = "present" | "absent";
export type RequestSent = true | false | "unknown";

export type Created =
  | { kind: "worktree"; path: string; branch: string }
  | { kind: "workspace"; id: string }
  | { kind: "tab"; id: string }
  | { kind: "pane"; id: string }
  | { kind: "agent"; name: string };

export type BackendIds = {
  workspace: string | null;
  tab: string | null;
  pane: string | null;
};

export type HistoryEntry = {
  at: string;
  event: string;
  detail: Record<string, unknown> | null;
};

export type TaskRecord = {
  schema: 1;
  id: string;
  task: Task;
  request_text: string;
  harness: string;
  model: string;
  effort: { requested: string | null; applied: string | null; omitted_reason: string | null };
  base: { ref: string; commit: string };
  branch: string;
  worktree: string;
  agent_name: string;
  backend_ids: BackendIds;
  preparation: Record<string, unknown>;
  provenance: Record<string, string>;
  flags: { human_approved: boolean; discard_worktree: boolean };
  lifecycle: Lifecycle;
  request_sent: RequestSent;
  send_started_at: string | null;
  created: Created[];
  collected: { digest: string; at: string } | null;
  worktree_removed: boolean;
  history: HistoryEntry[];
};
