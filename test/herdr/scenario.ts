// Verification 7 of the Spec against the real herdr, TC-0002 section 11.
// It starts its own herdr server in a session named dz-test-<random>, with a
// minimal environment so no variable of the calling session reaches a pane;
// keeps the Demerzel state and configuration in a temporary sandbox; and puts
// an interposed `herdr` first on the Demerzel's PATH that forwards everything
// to the real herdr except `agent start`, which it refuses. No harness or
// model runs. The launch goes through the delivered backend up to the
// registry and ends in launch-failed. Since TC-0004 both modes dispatch from
// a base commit with a fixture `.demerzel.json`, so the core creates and
// prepares the worktree before herdr opens the session. At the end it stops
// the server, removes the session folder and the sandbox, and prints what it
// checked.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { close, dispatch, status, type Backend } from "../../src/core/index.ts";
import type { Env } from "../../src/core/env.ts";
import { git } from "../../src/core/git.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { HerdrBackend } from "../../src/herdr/backend.ts";
import { prepareFixture } from "../core/helpers/prepare-fixture.ts";
import { sandbox, task } from "../core/helpers/sandbox.ts";

const realHerdr = Bun.which("herdr");
if (realHerdr === null) throw new Error("herdr is not on PATH");
const session = `dz-test-${Math.random().toString(16).slice(2, 10)}`;
const sb = sandbox();
// The herdr client finds a session's socket under XDG_CONFIG_HOME, so the
// server and the Demerzel share one: the socket and the session folder live
// there, and nothing lands in the owner's ~/.config/herdr. It is short and in
// /tmp because a Unix socket path must fit in about 104 bytes, and the macOS
// TMPDIR is already long.
const configHome = mkdtempSync("/tmp/dz-");
const sessionDir = join(configHome, "herdr", "sessions", session);
const checks: Array<{ check: string; ok: boolean; detail: unknown }> = [];
const check = (name: string, ok: boolean, detail: unknown = null) => {
  checks.push({ check: name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail === null ? "" : `  ${JSON.stringify(detail)}`}`);
};

// A minimal, explicit environment for the herdr server, so the panes it opens
// and the git it runs never inherit the session that runs this script, nor
// the owner's Git configuration, hooks or shell startup files: the sandbox
// HOME and isolated Git, and /bin/sh as the pane shell.
const serverEnv: Record<string, string> = {};
for (const key of ["PATH", "USER", "LOGNAME", "LANG", "TMPDIR"]) {
  const value = process.env[key];
  if (value !== undefined) serverEnv[key] = value;
}
for (const key of ["HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_TEMPLATE_DIR", "GIT_TERMINAL_PROMPT", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) {
  const value = sb.env[key];
  if (value !== undefined) serverEnv[key] = value;
}
serverEnv["SHELL"] = "/bin/sh";
serverEnv["TERM"] = "xterm-256color";
serverEnv["XDG_CONFIG_HOME"] = configHome;

const shim = join(sb.root, "shim");
mkdirSync(shim);
// Every call is logged, one argument per line and a blank line after each
// call, so the scenario can check what the backend asked herdr for.
const callLog = join(sb.root, "herdr-calls.log");
writeFileSync(
  join(shim, "herdr"),
  `#!/bin/sh
for a in "$@"; do printf '%s\\n' "$a" >> ${JSON.stringify(callLog)}; done; printf '\\n' >> ${JSON.stringify(callLog)}
for a in "$@"; do last2="$prev $a"; prev="$a"; case "$last2" in "agent start") printf '%s\\n' '{"error":{"code":"scenario_stop","message":"scenario refuses agent start"},"id":"cli:agent:start"}' >&2; exit 1;; esac; done
exec ${JSON.stringify(realHerdr)} "$@"
`,
);
chmodSync(join(shim, "herdr"), 0o755);
const env: Env = { ...sb.env, XDG_CONFIG_HOME: configHome, PATH: `${shim}:${sb.env["PATH"] ?? ""}` };
mkdirSync(join(configHome, "demerzel"), { recursive: true });
writeFileSync(join(configHome, "demerzel", "config.json"), JSON.stringify({ schema: 1, herdr: { session } }));

const herdr = (...args: string[]) => {
  const p = Bun.spawnSync([realHerdr, "--session", session, ...args], { env: serverEnv, stdout: "pipe", stderr: "pipe" });
  const out = p.stdout.toString().trim() || p.stderr.toString().trim();
  return { code: p.exitCode, json: out.startsWith("{") ? JSON.parse(out) : null };
};
const backend = new HerdrBackend(env, { session }, { postconditionWaitMs: 500 });
const ctx = (b: Backend = backend) => ({ cwd: sb.repo, env, backend: b, lockIntervalMs: 20 });
const calls = (): string[][] => (existsSync(callLog) ? readFileSync(callLog, "utf8").split("\n\n").filter(Boolean).map((c) => c.split("\n").filter((l) => l !== "")) : []);
const fx = prepareFixture(sb);
// What the preparation writes is ignored by Git, as installed dependencies
// usually are, so the discard below still removes the worktree without
// --force.
const base = fx.commit({ schema: 1, prepare: [["bun", "prep/record.ts", "scenario"]] }, { ".gitignore": "ignored-deps/\nprepared/\n" });
const failingBase = fx.commit({ schema: 1, prepare: [["bun", "prep/exit.ts", "5"]] });
const record = (id: string): TaskRecord => JSON.parse(readFileSync(join(resolveProject(sb.repo, env)?.dir ?? "", "tasks", `${id}.json`), "utf8")) as TaskRecord;

let server: ReturnType<typeof Bun.spawn> | null = null;
try {
  const down = await backend.probe();
  check("stopped session: unavailable with detail", !down.running && (down.detail ?? "").includes("parado"), down.detail);

  server = Bun.spawn([realHerdr, "--session", session, "server"], { env: serverEnv, stdout: "ignore", stderr: "ignore" });
  const deadline = Date.now() + 15_000;
  while (!(await backend.probe()).running) {
    if (Date.now() > deadline) throw new Error("isolated herdr server did not start");
    await Bun.sleep(200);
  }
  const probe = await backend.probe();
  check("real herdr probe", probe.running && probe.compatible && probe.versionOk, { version: probe.version });

  const effectCalls = () => calls().filter((c) => ["create", "close", "start", "prompt"].some((v) => c[3] === v));
  const beforeMissing = { tasks: sb.tasksSnapshot(), git: sb.gitState(), effects: effectCalls().length };
  const missing = await dispatch({ task: task({ id: "MISSING", base }), humanApproved: false }, ctx());
  check("missing workspace refuses without effects", missing.code === 2 && missing.envelope.refusal?.code === "project-workspace-missing" && JSON.stringify(sb.tasksSnapshot()) === JSON.stringify(beforeMissing.tasks) && sb.gitState() === beforeMissing.git && effectCalls().length === beforeMissing.effects);
  const project = herdr("workspace", "create", "--cwd", sb.repo, "--label", "project", "--no-focus").json?.result;
  const workspace = project?.workspace?.workspace_id;
  const humanTab = project?.tab?.tab_id;
  if (typeof workspace !== "string" || typeof humanTab !== "string") throw new Error("workspace setup did not confirm IDs");
  const prepared = (r: TaskRecord) => {
    const events = r.history.map((h) => h.event);
    const firstSession = r.history.findIndex((h) => h.event === "created" && h.detail?.["kind"] === "tab");
    return existsSync(join(r.worktree, "prepared", "scenario.json")) && r.project_preparation?.outcome === "succeeded" && events.indexOf("prepared") !== -1 && events.indexOf("prepared") < firstSession;
  };
  const records: TaskRecord[] = [];
  for (const [i, harness] of ["codex", "claude-code"].entries()) {
    const id = `TC-0099.${i + 1}`;
    const launched = await dispatch({ task: task({ id, writes: [`${i}/`], harness, base }), humanApproved: false }, ctx());
    const r = record(id);
    records.push(r);
    check(`${harness}: stopped at agent start`, launched.code === 1 && r.lifecycle === "launch-failed", r.history.at(-1)?.detail);
    check(`${harness}: confirmed resources`, JSON.stringify(r.created.map((c) => c.kind)) === JSON.stringify(["worktree", "tab", "pane"]), r.created);
    check(`${harness}: prepared before tab creation`, prepared(r));
    const create = calls().find((c) => c.includes("create") && c.includes(`${id} ${r.agent_name}`)) ?? [];
    check(`${harness}: tab argv and cwd`, create[2] === "tab" && create[create.indexOf("--workspace") + 1] === workspace && create[create.indexOf("--cwd") + 1] === (harness === "codex" ? r.worktree : sb.repo), create);
    check(`${harness}: branch and worktree at base`, existsSync(r.worktree) && git(sb.repo, ["rev-parse", r.branch], env).stdout === r.base.commit);
  }
  const [rc, rl] = records as [TaskRecord, TaskRecord];
  const snap = await backend.snapshot();
  check("two labeled tabs coexist in project workspace", records.every((r) => snap.tabs.some((t) => t.id === r.backend_ids.tab && t.workspace === workspace && t.label === `${r.id} ${r.agent_name}`)), snap.tabs);
  check("status accepts both tabs", (await status({ ids: [], all: true }, ctx())).envelope.ok);
  const failing = await dispatch({ task: task({ id: "PREP-FAIL", writes: ["failed/"], base: failingBase }), humanApproved: false }, ctx());
  const rf = record("PREP-FAIL");
  check("failed preparation has no backend session", failing.code === 1 && JSON.stringify(rf.created.map((c) => c.kind)) === JSON.stringify(["worktree"]) && !calls().some((c) => c.includes(`${rf.id} ${rf.agent_name}`)));
  const duplicate = herdr("workspace", "create", "--cwd", sb.repo, "--label", "project", "--no-focus").json?.result;
  const beforeAmbiguous = { tasks: sb.tasksSnapshot(), git: sb.gitState(), effects: effectCalls().length };
  const ambiguous = await dispatch({ task: task({ id: "AMBIGUOUS", base }), humanApproved: false }, ctx());
  check("ambiguous workspace refuses without effects", ambiguous.code === 2 && ambiguous.envelope.refusal?.code === "project-workspace-ambiguous" && JSON.stringify(sb.tasksSnapshot()) === JSON.stringify(beforeAmbiguous.tasks) && sb.gitState() === beforeAmbiguous.git && effectCalls().length === beforeAmbiguous.effects);
  herdr("tab", "close", duplicate.tab.tab_id);
  const mapped = herdr("workspace", "create", "--cwd", sb.repo, "--label", "mapped-project", "--no-focus").json?.result;
  const mappedBackend = new HerdrBackend(env, { session, workspace_labels: { [sb.repo]: "mapped-project" } });
  const mappedLaunch = await dispatch({ task: task({ id: "MAPPED", writes: ["mapped/"], base }), humanApproved: false }, ctx(mappedBackend));
  check("override selects mapped workspace after duplicate removal", mappedLaunch.code === 1 && record("MAPPED").project_workspace?.id === mapped.workspace.workspace_id && record("MAPPED").project_workspace?.source === "config");
  const x1 = await close({ id: rc.id, discardWorktree: false }, ctx());
  const after = await backend.snapshot();
  check("close removes only own tab", x1.code === 0 && !after.tabs.some((t) => t.id === rc.backend_ids.tab) && after.tabs.some((t) => t.id === humanTab) && after.tabs.some((t) => t.id === rl.backend_ids.tab) && after.workspaces.some((w) => w.id === workspace));
  check("close preserves branch and worktree", existsSync(rc.worktree) && git(sb.repo, ["rev-parse", rc.branch], env).code === 0);
  herdr("tab", "close", humanTab);
  const x2 = await close({ id: rl.id, discardWorktree: false }, ctx());
  const removedWorkspace = !(await backend.snapshot()).workspaces.some((w) => w.id === workspace);
  check("last-tab close records last_tab_in_workspace", x2.code === 0 && record(rl.id).history.at(-1)?.detail?.["last_tab_in_workspace"] === true, { removedWorkspace });
  const missingAgain = await dispatch({ task: task({ id: "MISSING-AGAIN", base }), humanApproved: false }, ctx());
  check("dispatch after last-tab removal refuses missing", missingAgain.envelope.refusal?.code === "project-workspace-missing");
  let closedAgain = true;
  try { await backend.closeTab(rc.backend_ids.tab ?? ""); } catch { closedAgain = false; }
  check("tab_not_found counts as closed", closedAgain);
  check("backend never creates or closes a workspace", !calls().some((c) => c[2] === "workspace" && ["create", "close"].includes(c[3] ?? "")) && calls().some((c) => c[2] === "tab" && c[3] === "close"));
  writeFileSync(join(rc.worktree, "untracked.txt"), "work\n");
  const refused = await close({ id: rc.id, discardWorktree: true }, ctx());
  check("dirty discard exits 1 and preserves worktree", refused.code === 1 && existsSync(rc.worktree));
  rmSync(join(rc.worktree, "untracked.txt"));
  const removed = await close({ id: rc.id, discardWorktree: true }, ctx());
  check("repeated discard removes worktree and keeps branch", removed.code === 0 && !existsSync(rc.worktree) && git(sb.repo, ["rev-parse", rc.branch], env).code === 0);

  // H13 against the real server: it stops right after a successful probe.
  const stopping = Object.create(backend) as HerdrBackend;
  stopping.probe = async () => {
    const p = await backend.probe();
    herdr("server", "stop");
    await Bun.sleep(500);
    return p;
  };
  const s = await status({ ids: [], all: true }, ctx(stopping));
  check("server drops between probe and snapshot: unavailable", s.code === 2 && (s.envelope.refusal?.message ?? "").includes("herdr api snapshot"), s.envelope.refusal?.message);
} catch (error) {
  check("scenario completes without exception", false, error instanceof Error ? error.message : String(error));
} finally {
  herdr("server", "stop");
  server?.kill();
  await Bun.sleep(300);
  if (existsSync(sessionDir)) rmSync(sessionDir, { recursive: true, force: true });
  console.log(JSON.stringify({ session, sessionDir, sessionDirRemoved: !existsSync(sessionDir), state: sb.stateHome, config: configHome, herdr: realHerdr, ownerSessionsTouched: existsSync(join(process.env["HOME"] ?? "", ".config", "herdr", "sessions", session)) }));
  sb.cleanup();
  rmSync(configHome, { recursive: true, force: true });
}
const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
process.exitCode = failed.length === 0 ? 0 : 1;
