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

// Spec 2.6, revision 0.15: the project's preparation, recorded in
// `recorded` with the commit it came from and never read again, then its
// start, each command's process group and result, and its outcome. Absent
// on tasks recorded before revision 0.15.
export type PrepareResult = {
  index: number;
  program: string;
  exit_code: number | null;
  signal: string | null;
  duration_ms: number;
  failure: string | null;
};

export type ProjectPreparation = {
  file: string;
  commit: string;
  present: boolean;
  commands: string[][];
  prepare_started_at: string | null;
  // The process group of the command running now, or of the last one run.
  process_group: number | null;
  log: string | null;
  results: PrepareResult[];
  outcome: "succeeded" | "failed" | null;
  reason: string | null;
};

export type ProjectWorkspace = { id: string; label: string; source: "directory" | "config" };

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
  project_preparation?: ProjectPreparation;
  project_workspace?: ProjectWorkspace;
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
