// A fake `herdr` executable for the backend tests. It records each call in
// FAKE_HERDR_LOG and answers like herdr 0.9.0: JSON on stdout on success,
// JSON on stderr with exit 1 on error (shapes captured from the real herdr).
// State and behavior live in FAKE_HERDR_STATE. `worktree create` and the
// Claude Code WorktreeCreate hook run for real, the hook through /bin/sh, so
// branches and the shell quoting are proven against Git and a shell.
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

type Agent = { name: string; kind: string; status: string; pane: string; workspace: string; tab: string; cwd: string };
type Workspace = { id: string; label: string; tab: string; pane: string; cwd: string };
type Script = {
  running: boolean;
  version: string;
  snapshot: "ok" | "garbage" | "no-lists";
  start: Record<string, "ready" | "not_ready" | "error" | "ok-empty" | "garbage" | "started-garbage">;
  hook: "run" | "skip" | "wrong-path";
  cwd: "worktree" | "root";
  prompt: "ok" | "agent_blocked" | "agent_not_ready" | "agent_prompt_stalled" | "ok-no-status" | "result-exit-1" | "echo-garbage" | "other-agent" | "error-echo" | "echo-code" | "echo-name" | "echo-status";
  statusAfterPrompt: string;
  extraAgents: Array<{ name?: string; agent_status: string; pane_id: string }>;
  paneBusy: number;
  closeFails: boolean;
  closeAnswer: "ok" | "empty";
  createAnswer: "ok" | "garbage-after" | "empty-noop";
  extraWorkspaces: Array<{ workspace_id: string; label: string }>;
};
type State = { next: number; workspaces: Workspace[]; agents: Agent[]; script: Script };

const statePath = process.env["FAKE_HERDR_STATE"] ?? "";
const logPath = process.env["FAKE_HERDR_LOG"] ?? "";
const argv = process.argv.slice(2);
appendFileSync(logPath, `${JSON.stringify(argv)}\n`);

const state: State = JSON.parse(readFileSync(statePath, "utf8")) as State;
function save(): void {
  const tmp = `${statePath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, statePath);
}
function ok(result: Record<string, unknown>, id: string): never {
  process.stdout.write(`${JSON.stringify({ id, result })}\n`);
  process.exit(0);
}
function fail(code: string, message: string, id: string): never {
  process.stderr.write(`${JSON.stringify({ error: { code, message }, id })}\n`);
  process.exit(1);
}
function opt(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
}

let args = argv;
if (args[0] === "--session") args = args.slice(2);
const [group, verb, ...rest] = args;
const s = state.script;

function createWorkspace(label: string, cwd: string): Workspace {
  const n = state.next++;
  const w: Workspace = { id: `w${n}`, label, tab: `w${n}:t1`, pane: `w${n}:p1`, cwd };
  state.workspaces.push(w);
  return w;
}
function sessionResult(w: Workspace, type: string): Record<string, unknown> {
  return {
    type,
    workspace: { workspace_id: w.id, label: w.label, active_tab_id: w.tab, number: 1, pane_count: 1, tab_count: 1, focused: false, agent_status: "unknown" },
    tab: { tab_id: w.tab, workspace_id: w.id, label: "1", number: 1, pane_count: 1, focused: false, agent_status: "unknown" },
    root_pane: { pane_id: w.pane, tab_id: w.tab, workspace_id: w.id, cwd: w.cwd, foreground_cwd: w.cwd, agent_status: "unknown" },
  };
}

if (group === "status") {
  process.stdout.write(`${JSON.stringify({ client: { version: "0.9.0" }, server: { running: s.running, compatible: s.running, version: s.running ? s.version : null, session: "fake" } })}\n`);
  process.exit(0);
}
if (!s.running) fail("server_not_running", "server not running", `cli:${group}:${verb}`);

if (group === "api" && verb === "snapshot") {
  if (s.snapshot === "garbage") {
    process.stdout.write("isto não é JSON\n");
    process.exit(0);
  }
  if (s.snapshot === "no-lists") ok({ type: "snapshot", snapshot: { agents: [] } }, "cli:api:snapshot");
  ok(
    {
      type: "snapshot",
      snapshot: {
        agents: [
          ...state.agents.map((a) => ({ name: a.name, agent: a.kind, agent_status: a.status, pane_id: a.pane, tab_id: a.tab, workspace_id: a.workspace, foreground_cwd: a.cwd })),
          ...s.extraAgents,
        ],
        workspaces: [...state.workspaces.map((w, i) => ({ workspace_id: w.id, label: w.label, number: i + 1 })), ...s.extraWorkspaces],
        tabs: state.workspaces.map((w) => ({ tab_id: w.tab, workspace_id: w.id, number: 1, label: "1" })),
        panes: state.workspaces.map((w) => ({ pane_id: w.pane, tab_id: w.tab, workspace_id: w.id })),
      },
    },
    "cli:api:snapshot",
  );
}

// A creation whose answer is lost after the effect, or a success that
// created nothing: the real state and the answer disagree on purpose.
function answerCreate(result: Record<string, unknown>, id: string): never {
  if (s.createAnswer === "garbage-after") {
    process.stdout.write("isto não é JSON\n");
    process.exit(0);
  }
  ok(result, id);
}

if (group === "worktree" && verb === "create") {
  if (s.createAnswer === "empty-noop") ok({}, "cli:worktree:create");
  const cwd = opt(rest, "--cwd") ?? "";
  const branch = opt(rest, "--branch") ?? "";
  const base = opt(rest, "--base") ?? "";
  const path = opt(rest, "--path") ?? "";
  const r = Bun.spawnSync(["git", "-C", cwd, "worktree", "add", "-q", "-b", branch, path, base], { env: process.env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) fail("worktree_create_failed", r.stderr.toString().trim(), "cli:worktree:create");
  const w = createWorkspace(opt(rest, "--label") ?? "", path);
  save();
  answerCreate(sessionResult(w, "worktree_created"), "cli:worktree:create");
}

if (group === "workspace" && verb === "create") {
  if (s.createAnswer === "empty-noop") ok({}, "cli:workspace:create");
  const w = createWorkspace(opt(rest, "--label") ?? "", opt(rest, "--cwd") ?? "");
  save();
  answerCreate(sessionResult(w, "workspace_created"), "cli:workspace:create");
}

if (group === "workspace" && verb === "close") {
  const id = rest[0] ?? "";
  const w = state.workspaces.find((x) => x.id === id);
  if (w === undefined) fail("workspace_not_found", `workspace ${id} not found`, "cli:workspace:close");
  if (s.closeFails) fail("close_failed", `workspace ${id} could not be closed`, "cli:workspace:close");
  if (s.closeAnswer === "empty") ok({}, "cli:workspace:close");
  state.workspaces = state.workspaces.filter((x) => x.id !== id);
  state.agents = state.agents.filter((a) => a.workspace !== id);
  save();
  ok({ type: "ok" }, "cli:workspace:close");
}

if (group === "agent" && verb === "start") {
  const name = rest[0] ?? "";
  const kind = opt(rest, "--kind") ?? "";
  const pane = opt(rest, "--pane") ?? "";
  const w = state.workspaces.find((x) => x.pane === pane);
  if (w === undefined) fail("pane_not_found", `pane ${pane} not found`, "cli:agent:start");
  if (s.paneBusy > 0) {
    s.paneBusy--;
    save();
    fail("agent_pane_busy", `agent target pane ${pane} is not an available shell`, "cli:agent:start");
  }
  const agentArgs = rest.slice(rest.indexOf("--") + 1);
  let cwd = w.cwd;
  const settings = opt(agentArgs, "--settings");
  if (kind === "claude" && settings !== null && s.hook !== "skip") {
    // Claude Code runs the WorktreeCreate hook command through a shell and
    // takes the printed path as the session directory.
    const command = (JSON.parse(settings) as { hooks: { WorktreeCreate: Array<{ hooks: Array<{ command: string }> }> } }).hooks.WorktreeCreate[0]?.hooks[0]?.command ?? "";
    const r = Bun.spawnSync(["/bin/sh", "-c", command], { cwd: w.cwd, env: process.env, stdout: "pipe", stderr: "pipe" });
    const printed = r.stdout.toString().trim();
    if (r.exitCode === 0) cwd = s.hook === "wrong-path" ? w.cwd : printed;
  }
  if (s.cwd === "root") cwd = w.cwd;
  const outcome = s.start[kind] ?? "ready";
  if (outcome === "error") fail("agent_start_failed", "agent exited during startup", "cli:agent:start");
  // Controlled bad answers, with nothing started.
  if (outcome === "ok-empty") ok({}, "cli:agent:start");
  if (outcome === "garbage") {
    process.stdout.write("isto não é JSON\n");
    process.exit(0);
  }
  state.agents.push({ name, kind, status: outcome === "not_ready" ? "blocked" : "idle", pane, workspace: w.id, tab: w.tab, cwd });
  save();
  if (outcome === "started-garbage") {
    process.stdout.write("isto não é JSON\n");
    process.exit(0);
  }
  if (outcome === "not_ready") fail("agent_not_ready", `agent ${name} is blocked during startup and is not ready for prompts`, "cli:agent:start");
  ok({ agent: { name, agent: kind, agent_status: "idle", pane_id: pane, cwd: w.cwd, foreground_cwd: cwd, interactive_ready: true } }, "cli:agent:start");
}

if (group === "agent" && verb === "get") {
  const a = state.agents.find((x) => x.name === rest[0]);
  if (a === undefined) fail("agent_not_found", `agent target ${rest[0]} not found`, "cli:agent:get");
  ok({ agent: { name: a.name, agent: a.kind, agent_status: a.status, pane_id: a.pane, foreground_cwd: a.cwd } }, "cli:agent:get");
}

if (group === "agent" && verb === "prompt") {
  const a = state.agents.find((x) => x.name === rest[0]);
  if (a === undefined) fail("agent_not_found", `agent target ${rest[0]} not found`, "cli:agent:prompt");
  if (a.status === "blocked") fail("agent_blocked", `agent ${a.name} is blocked and requires interactive input`, "cli:agent:prompt");
  if (s.prompt === "ok-no-status") ok({ agent: { name: a.name } }, "cli:agent:prompt");
  if (s.prompt === "other-agent") ok({ agent: { name: "dz-other-agent", agent_status: "working" } }, "cli:agent:prompt");
  if (s.prompt === "error-echo") fail("prompt_failed", `could not send: ${rest[1] ?? ""}`, "cli:agent:prompt");
  if (s.prompt === "echo-code") fail(rest[1] ?? "", "failed", "cli:agent:prompt");
  if (s.prompt === "echo-name") ok({ agent: { name: rest[1] ?? "", agent_status: "working" } }, "cli:agent:prompt");
  if (s.prompt === "echo-status") ok({ agent: { name: a.name, agent_status: rest[1] ?? "" } }, "cli:agent:prompt");
  if (s.prompt === "result-exit-1") {
    process.stdout.write(`${JSON.stringify({ id: "cli:agent:prompt", result: { agent: { name: a.name, agent_status: "working" } } })}\n`);
    process.exit(1);
  }
  if (s.prompt === "echo-garbage") {
    // An interposed process that echoes its arguments, request included.
    process.stdout.write(`${rest.join(" ")}\n`);
    process.exit(1);
  }
  if (s.prompt !== "ok") fail(s.prompt, `fake ${s.prompt}`, "cli:agent:prompt");
  a.status = s.statusAfterPrompt;
  save();
  ok({ agent: { name: a.name, agent_status: a.status, pane_id: a.pane } }, "cli:agent:prompt");
}

fail("unknown_command", `fake herdr has no ${group} ${verb}`, "cli:unknown");
