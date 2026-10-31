// Verification 7 of the Spec against the real herdr, TC-0002 section 11.
// It starts its own herdr server in a session named dz-test-<random>, with a
// minimal environment so no variable of the calling session reaches a pane;
// keeps the Demerzel state and configuration in a temporary sandbox; and puts
// an interposed `herdr` first on the Demerzel's PATH that forwards everything
// to the real herdr except `agent start`, which it refuses. No harness or
// model runs. The launch goes through the delivered backend up to the
// registry and ends in launch-failed. At the end it stops the server, removes
// the session folder and the sandbox, and prints what it checked.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { close, dispatch, status, type Backend } from "../../src/core/index.ts";
import type { Env } from "../../src/core/env.ts";
import { git } from "../../src/core/git.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { HerdrBackend } from "../../src/herdr/backend.ts";
import { sandbox, task } from "../core/helpers/sandbox.ts";

const realHerdr = Bun.which("herdr");
if (realHerdr === null) throw new Error("herdr não está no PATH");
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
writeFileSync(
  join(shim, "herdr"),
  `#!/bin/sh
for a in "$@"; do last2="$prev $a"; prev="$a"; case "$last2" in "agent start") printf '%s\\n' '{"error":{"code":"scenario_stop","message":"o cenário recusa agent start"},"id":"cli:agent:start"}' >&2; exit 1;; esac; done
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
const record = (id: string): TaskRecord => JSON.parse(readFileSync(join(resolveProject(sb.repo, env)?.dir ?? "", "tasks", `${id}.json`), "utf8")) as TaskRecord;

let server: ReturnType<typeof Bun.spawn> | null = null;
try {
  const down = await backend.probe();
  check("sessão parada: backend-unavailable com detalhe", !down.running && (down.detail ?? "").includes("parado"), down.detail);

  server = Bun.spawn([realHerdr, "--session", session, "server"], { env: serverEnv, stdout: "ignore", stderr: "ignore" });
  const deadline = Date.now() + 15_000;
  while (!(await backend.probe()).running) {
    if (Date.now() > deadline) throw new Error("o servidor herdr isolado não subiu");
    await Bun.sleep(200);
  }
  const probe = await backend.probe();
  check("sondagem do herdr real", probe.running && probe.compatible && probe.versionOk, { version: probe.version });

  // Codex mode: worktree, workspace, tab and pane through the backend; the
  // interposed herdr refuses agent start.
  const cx = await dispatch({ task: task({ id: "TC-0099.1", writes: ["a/"], harness: "codex" }), humanApproved: false }, ctx());
  const rc = record("TC-0099.1");
  check("codex: launch-failed pelo agent start recusado", cx.code === 1 && rc.lifecycle === "launch-failed", rc.history.at(-1)?.detail);
  check("codex: recursos em created", JSON.stringify(rc.created.map((c) => c.kind)) === JSON.stringify(["worktree", "workspace", "tab", "pane"]), rc.created.map((c) => c.kind));
  check("codex: worktree e branch no commit base", existsSync(rc.worktree) && git(sb.repo, ["rev-parse", rc.branch], env).stdout === rc.base.commit);

  const cl = await dispatch({ task: task({ id: "TC-0099.2", writes: ["b/"], harness: "claude-code", model: "claude-sonnet-5-5", effort: "low" }), humanApproved: false }, ctx());
  const rl = record("TC-0099.2");
  check("claude-code: launch-failed sem worktree", cl.code === 1 && rl.lifecycle === "launch-failed" && !existsSync(rl.worktree), rl.history.at(-1)?.detail);
  check("claude-code: recursos em created", JSON.stringify(rl.created.map((c) => c.kind)) === JSON.stringify(["workspace", "tab", "pane"]), rl.created.map((c) => c.kind));

  const raw = herdr("api", "snapshot").json;
  const labels = (raw?.result?.snapshot?.workspaces ?? []).map((w: { label: string }) => w.label);
  check("label com espaço lido de volta no snapshot real", labels.includes(`TC-0099.1 ${rc.agent_name}`) && labels.includes(`TC-0099.2 ${rl.agent_name}`), labels);
  const snap = await backend.snapshot();
  const mapped = snap.workspaces.find((w) => w.id === rc.backend_ids.workspace);
  check("snapshot do backend com aba e pane raiz", mapped?.tab === rc.backend_ids.tab && mapped?.pane === rc.backend_ids.pane, mapped);

  // close without discard keeps worktree and branch.
  const x1 = await close({ id: "TC-0099.1", discardWorktree: false }, ctx());
  const stillThere = (herdr("api", "snapshot").json?.result?.snapshot?.workspaces ?? []).some((w: { workspace_id: string }) => w.workspace_id === rc.backend_ids.workspace);
  check("close sem descarte fecha o workspace real", x1.code === 0 && !stillThere);
  check("close sem descarte preserva worktree e branch", existsSync(rc.worktree) && git(sb.repo, ["rev-parse", "--verify", "--quiet", rc.branch], env).code === 0);
  check("close do segundo modo", (await close({ id: "TC-0099.2", discardWorktree: false }, ctx())).code === 0);

  let closedAgain = true;
  try {
    await backend.closeWorkspace(rc.backend_ids.workspace ?? "");
  } catch {
    closedAgain = false;
  }
  check("closeWorkspace sobre workspace que já não existe", closedAgain);

  writeFileSync(join(rc.worktree, "solto.txt"), "trabalho\n");
  const refused = await close({ id: "TC-0099.1", discardWorktree: true }, ctx());
  check("descarte com alterações sai com 1 e mantém o worktree", refused.code === 1 && existsSync(rc.worktree), refused.envelope.tasks[0]?.discard);
  rmSync(join(rc.worktree, "solto.txt"));
  const removed = await close({ id: "TC-0099.1", discardWorktree: true }, ctx());
  check("descarte repetido remove o worktree e mantém o branch", removed.code === 0 && !existsSync(rc.worktree) && git(sb.repo, ["rev-parse", "--verify", "--quiet", rc.branch], env).code === 0);

  // H13 against the real server: it stops right after a successful probe.
  const stopping = Object.create(backend) as HerdrBackend;
  stopping.probe = async () => {
    const p = await backend.probe();
    herdr("server", "stop");
    await Bun.sleep(500);
    return p;
  };
  const s = await status({ ids: [], all: true }, ctx(stopping));
  check("servidor caindo entre sondagem e snapshot: backend-unavailable", s.code === 2 && (s.envelope.refusal?.message ?? "").includes("herdr api snapshot"), s.envelope.refusal?.message);
} catch (error) {
  check("cenário sem exceção", false, error instanceof Error ? error.message : String(error));
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
console.log(`${checks.length - failed.length}/${checks.length} conferências passaram`);
process.exitCode = failed.length === 0 ? 0 : 1;
