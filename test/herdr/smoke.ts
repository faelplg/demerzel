// Verification 8 of the Spec, TC-0002 section 11: Claude Code and Codex
// launched by the Demerzel through a real herdr, run by the orchestrator
// with the owner present. It spends model calls and the harnesses may ask
// for permission to write the return file.
//
//   DEMERZEL_SMOKE_REPO=<disposable repo> bun run smoke:herdr
//
// The first run creates the disposable repository and stops, so the owner can
// trust it once in each CLI. Since TC-0004 the repository also carries a
// `.demerzel.json` whose preparation writes `prepared/marker.txt`, added in
// its own commit when missing, and each harness is asked to read that file. Every run starts its own herdr server, with a
// minimal environment and a short XDG_CONFIG_HOME, keeps the Demerzel state in
// a temporary folder, and writes a JSON report.
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { dispatch, status, close, type Backend } from "../../src/core/index.ts";
import type { Env } from "../../src/core/env.ts";
import { git } from "../../src/core/git.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { HerdrBackend } from "../../src/herdr/backend.ts";

const repo = process.env["DEMERZEL_SMOKE_REPO"];
if (repo === undefined || repo === "") throw new Error("defina DEMERZEL_SMOKE_REPO com o path do repositório descartável do smoke");
const count = Number(process.env["DEMERZEL_SMOKE_COUNT"] ?? "5");
const waitMs = Number(process.env["DEMERZEL_SMOKE_WAIT_MS"] ?? "900000");
const harnesses = (process.env["DEMERZEL_SMOKE_HARNESSES"] ?? "codex,claude-code").split(",");
const MODELS: Record<string, { model: string; effort: string }> = {
  codex: { model: "gpt-6.1-sol", effort: "low" },
  "claude-code": { model: "claude-sonnet-5-5", effort: "low" },
};

const SHORT = "docs/smoke-short.md";
const LONG = "docs/smoke-long.md";
const PREPARED = "docs/smoke-prepared.md";
const MARKER = "prepared/marker.txt";

// TC-0004: a preparation that writes a file the agent then reads. The
// script uses only shell builtins and prints the worktree path, so the
// return proves the agent read the file in its own prepared worktree. The
// output folder is ignored, as installed dependencies are, so close
// --discard-worktree still removes the worktree.
function ensurePreparation(): void {
  const root = repo as string;
  if (existsSync(join(root, ".demerzel.json")) && existsSync(join(root, PREPARED))) return;
  const run = (...args: string[]) => {
    const r = git(root, args, process.env);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "prepare.sh"), "#!/bin/sh\n[ -d prepared ] || mkdir prepared\nprintf 'prepared in %s\\n' \"$PWD\" > prepared/marker.txt\n");
  chmodSync(join(root, "scripts", "prepare.sh"), 0o755);
  writeFileSync(join(root, ".demerzel.json"), `${JSON.stringify({ schema: 1, prepare: [["./scripts/prepare.sh"]] }, null, 2)}\n`);
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, PREPARED),
    `# Prepared worktree smoke task\n\nRead the file \`${MARKER}\` in your working directory and write its content, exactly, as the only line of the return file named in the request, creating any missing folders. Do nothing else and change no other file.\n`,
  );
  const ignore = join(root, ".gitignore");
  const current = existsSync(ignore) ? readFileSync(ignore, "utf8") : "";
  if (!current.split("\n").includes("prepared/")) writeFileSync(ignore, `${current}${current === "" || current.endsWith("\n") ? "" : "\n"}prepared/\n`);
  run("add", ".demerzel.json", "scripts/prepare.sh", PREPARED, ".gitignore");
  run("commit", "-q", "-m", "smoke preparation fixture");
}

function createRepo(): void {
  mkdirSync(repo as string, { recursive: true });
  const run = (...args: string[]) => {
    const r = git(repo as string, args, process.env);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  run("init", "-q", "-b", "main");
  writeFileSync(join(repo as string, "README.md"), "Repositório descartável do smoke do Demerzel. Pode ser apagado.\n");
  writeFileSync(join(repo as string, ".gitignore"), ".radiant/\n.claude/settings.local.json\n");
  mkdirSync(join(repo as string, "docs"));
  writeFileSync(
    join(repo as string, SHORT),
    "# Tarefa curta do smoke\n\nGrave no arquivo de retorno indicado no pedido exatamente uma linha com o texto `ok`, criando as pastas que faltarem. Não faça mais nada e não altere outros arquivos.\n",
  );
  writeFileSync(
    join(repo as string, LONG),
    "# Tarefa longa do smoke\n\nResponda na própria conversa, sem usar ferramentas e sem gravar arquivos, com um texto de cerca de 900 palavras explicando, passo a passo, como funciona uma árvore B: inserção, divisão de nós, busca e remoção. Não grave nenhum arquivo de retorno.\n",
  );
  run("add", ".");
  run("commit", "-q", "-m", "smoke fixture");
}

if (!existsSync(join(repo, ".git"))) {
  createRepo();
  ensurePreparation();
  console.log(`Criei o repositório do smoke em ${repo}.`);
  console.log("Confie esta pasta uma vez no Claude Code (`claude` dentro dela) e no Codex (`codex` dentro dela), e rode o smoke de novo.");
  process.exit(3);
}

ensurePreparation();

const realHerdr = Bun.which("herdr");
if (realHerdr === null) throw new Error("herdr não está no PATH");
const run = `${new Date().toISOString().slice(2, 16).replace(/[-:T]/g, "")}`;
const session = `dz-smoke-${Math.random().toString(16).slice(2, 8)}`;
const configHome = mkdtempSync("/tmp/dz-");
const stateHome = mkdtempSync(join(tmpdir(), "dz-smoke-state-"));
const out = process.env["DEMERZEL_SMOKE_OUT"] ?? join(stateHome, "smoke-report.json");
const log = join(stateHome, "smoke.log");

const serverEnv: Record<string, string> = {};
for (const key of ["HOME", "PATH", "SHELL", "USER", "LOGNAME", "LANG", "TMPDIR"]) {
  const value = process.env[key];
  if (value !== undefined) serverEnv[key] = value;
}
serverEnv["TERM"] = "xterm-256color";
serverEnv["XDG_CONFIG_HOME"] = configHome;

const env: Env = { ...serverEnv, XDG_STATE_HOME: stateHome, XDG_CONFIG_HOME: configHome };
mkdirSync(join(configHome, "demerzel"), { recursive: true });
writeFileSync(join(configHome, "demerzel", "config.json"), JSON.stringify({ schema: 1, herdr: { session } }));
const backend: Backend = new HerdrBackend(env, { session });
const ctx = { cwd: repo, env, backend, lockIntervalMs: 50, waitIntervalMs: 2000 };
const cliPath = join(import.meta.dir, "..", "..", "src", "cli.ts");

const report: Record<string, unknown> = {
  run,
  session,
  repo,
  paths: { state: stateHome, config: configHome, sessionDir: join(configHome, "herdr", "sessions", session), report: out },
  versions: {} as Record<string, string>,
  launches: [] as unknown[],
  concurrency: [] as unknown[],
  returns: [] as unknown[],
  prepared: [] as unknown[],
  postcondition: null as unknown,
  leftovers: null as unknown,
};
const say = (line: string) => {
  console.log(line);
  appendFileSync(log, `${new Date().toISOString()} ${line}\n`);
};
const save = () => writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
const record = (id: string): TaskRecord => JSON.parse(readFileSync(join(resolveProject(repo, env)?.dir ?? "", "tasks", `${id}.json`), "utf8")) as TaskRecord;
const cli = async (...args: string[]) => {
  const p = Bun.spawn([process.execPath, cliPath, ...args, "--json"], { cwd: repo, env: env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  const [stdout, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  return { code, envelope: JSON.parse(stdout) };
};
const versionOf = (cmd: string[]) => Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();

function taskFor(harness: string, id: string, pointer: string) {
  const m = MODELS[harness] ?? { model: "", effort: "" };
  return {
    id,
    harness,
    model: m.model,
    effort: m.effort,
    branch: `smoke/${id}`,
    writes: [`smoke/${id}/`],
    dependsOn: [],
    request: { role: "radiant-dev", pointers: [{ label: "tarefa", path: pointer }] },
    returnPath: `.radiant/reports/${id}.md`,
    provenance: { smoke: run },
  };
}

let server: ReturnType<typeof Bun.spawn> | null = null;
const ids: string[] = [];
try {
  (report["versions"] as Record<string, string>)["herdr"] = versionOf([realHerdr, "--version"]);
  (report["versions"] as Record<string, string>)["claude"] = versionOf(["claude", "--version"]);
  (report["versions"] as Record<string, string>)["codex"] = versionOf(["codex", "--version"]);
  server = Bun.spawn([realHerdr, "--session", session, "server"], { env: serverEnv, stdout: "ignore", stderr: "ignore" });
  const deadline = Date.now() + 15_000;
  while (!(await backend.probe()).running) {
    if (Date.now() > deadline) throw new Error("o servidor herdr do smoke não subiu");
    await Bun.sleep(200);
  }
  say(`Servidor herdr do smoke na sessão ${session}. Para ver ou liberar as abas, num terminal:`);
  say(`  XDG_CONFIG_HOME=${configHome} herdr --session ${session}`);
  save();

  const projectRoot = resolveProject(repo, env)!.mainCheckout;
  const setup = Bun.spawnSync([realHerdr, "--session", session, "workspace", "create", "--cwd", projectRoot, "--label", basename(projectRoot), "--no-focus"], { env: serverEnv, stdout: "pipe", stderr: "pipe" });
  if (setup.exitCode !== 0) throw new Error("Could not create isolated smoke project workspace");
  const projectWorkspace = JSON.parse(setup.stdout.toString()).result.workspace.workspace_id as string;
  report["project_workspace"] = projectWorkspace;

  // Five short launches per harness, counted by the Plan criterion: an
  // intervention is needed whenever the request did not arrive at dispatch.
  for (const harness of harnesses) {
    for (let i = 1; i <= count; i++) {
      const id = `SMK-${run}-${harness === "codex" ? "x" : "c"}${i}`;
      const started = Date.now();
      const d = await dispatch({ task: taskFor(harness, id, SHORT), humanApproved: false }, ctx);
      const t = d.envelope.tasks[0];
      ids.push(id);
      // The registry tells a technical failure (launch-failed), a startup the
      // harness blocked (a dialog that needs a human before the request) and
      // a delivery apart. Human actions themselves are not observable here:
      // owner_observation is filled from the owner's own account.
      const history = record(id).history;
      const blockedStartup = history.some((h) => h.event === "launched" && h.detail?.["startup"] === "blocked");
      const outcome = t?.lifecycle === "launch-failed" ? "falha técnica" : blockedStartup ? "startup travado" : t?.request_sent === true ? "entregue" : "envio sem confirmação";
      const entry = { id, harness, code: d.code, lifecycle: t?.lifecycle ?? null, request_sent: t?.request_sent ?? null, agent: t?.agent ?? null, dispatch_ms: Date.now() - started, refusal: d.envelope.refusal, outcome, intervention_before_delivery: outcome === "startup travado", backend_error: t?.backend_error ?? null, owner_observation: null };
      (report["launches"] as unknown[]).push(entry);
      say(`${id}: ${outcome} code=${d.code} request_sent=${String(entry.request_sent)} agent=${entry.agent} ${entry.dispatch_ms}ms${entry.backend_error ? ` erro=${entry.backend_error}` : ""}`);
      save();
    }
  }

  // Concurrency: the second dispatch ends while the first agent still works,
  // and close of the first is refused in that same interval.
  const concurrentIds: string[] = [];
  for (const harness of harnesses) {
    const id = `SMK-${run}-${harness === "codex" ? "x" : "c"}long`;
    const d = await dispatch({ task: taskFor(harness, id, LONG), humanApproved: false }, ctx);
    ids.push(id); concurrentIds.push(id);
    if (d.envelope.refusal) throw new Error(`Concurrent dispatch refused: ${d.envelope.refusal.code}`);
  }
  const concurrent = await status({ ids: concurrentIds, all: false }, ctx);
  const concurrentSnapshot = await backend.snapshot();
  const shared = concurrent.envelope.tasks.every((t) => t.backend_ids.workspace === projectWorkspace && concurrentSnapshot.tabs.some((tab) => tab.id === t.backend_ids.tab && tab.workspace === projectWorkspace));
  const bothWorking = concurrent.envelope.tasks.length === 2 && concurrent.envelope.tasks.every((t) => t.agent === "working");
  const protectedClose = await close({ id: concurrentIds[0]!, discardWorktree: false }, ctx);
  (report["concurrency"] as unknown[]).push({ ids: concurrentIds, shared_workspace: shared, both_working: bothWorking, close_first: protectedClose.envelope.refusal?.code });
  if (!shared || !bothWorking || protectedClose.envelope.refusal?.code !== "task-working") throw new Error("Both harnesses must coexist as working tabs in the project workspace");
  save();

  // Returns through the CLI. The harnesses may ask to write the file; the
  // owner answers in the tabs.
  say("Esperando os retornos das tarefas curtas. Se um harness pedir permissão para gravar, responda na aba.");
  const live = (id: string) => ["launched", "collected"].includes(record(id).lifecycle);
  const short = ids.filter((id) => !id.includes("long") && live(id));
  const w = await cli("wait", ...short, "--timeout", String(waitMs));
  if (w.envelope.refusal) say(`wait recusado: ${w.envelope.refusal.code} ${w.envelope.refusal.message}`);
  for (const t of w.envelope.tasks as Array<{ id: string; agent: string; report: string }>) {
    const c = t.report === "present" ? await cli("collect", t.id) : null;
    (report["returns"] as unknown[]).push({ id: t.id, agent: t.agent, report: t.report, collect_code: c?.code ?? null, content: c?.envelope.tasks[0]?.collected?.content ?? null });
  }
  say(`retornos: ${(report["returns"] as Array<{ report: string }>).filter((r) => r.report === "present").length}/${short.length}`);
  save();

  // TC-0004: each harness reads the file its preparation wrote, before the
  // agent started, in its own worktree.
  const preparedIds: string[] = [];
  for (const harness of harnesses) {
    const id = `SMK-${run}-${harness === "codex" ? "x" : "c"}prep`;
    const d = await dispatch({ task: taskFor(harness, id, PREPARED), humanApproved: false }, ctx);
    ids.push(id);
    preparedIds.push(id);
    const r = record(id);
    say(`${id}: preparation ${r.project_preparation?.outcome ?? "none"}, code=${d.code}${d.envelope.tasks[0]?.launch_error ? ` launch_error=${d.envelope.tasks[0]?.launch_error}` : ""}`);
  }
  const pw = await cli("wait", ...preparedIds.filter(live), "--timeout", String(waitMs));
  for (const t of pw.envelope.tasks as Array<{ id: string; agent: string; report: string }>) {
    const r = record(t.id);
    const markerPath = join(r.worktree, MARKER);
    const expected = existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() : null;
    const c = t.report === "present" ? await cli("collect", t.id) : null;
    const content = (c?.envelope.tasks[0]?.collected?.content ?? null) as string | null;
    const entry = { id: t.id, harness: r.harness, preparation: r.project_preparation?.outcome ?? null, prepared_before_session: r.history.findIndex((h) => h.event === "prepared") < r.history.findIndex((h) => h.event === "created" && h.detail?.["kind"] === "tab"), expected, content, read_prepared_file: expected !== null && content?.trim() === expected };
    (report["prepared"] as unknown[]).push(entry);
    say(`${t.id}: read the prepared file ${entry.read_prepared_file}`);
  }
  save();

  // The Claude Code postcondition with a project hook that prints another
  // path. Hooks from settings files merge; the postcondition must notice.
  if (harnesses.includes("claude-code")) {
    const elsewhere = join(stateHome, "elsewhere");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    const local = join(repo, ".claude", "settings.local.json");
    writeFileSync(local, JSON.stringify({ hooks: { WorktreeCreate: [{ hooks: [{ type: "command", command: `mkdir -p '${elsewhere}' && printf '%s\\n' '${elsewhere}'` }] }] } }));
    const id = `SMK-${run}-cpost`;
    const d = await dispatch({ task: taskFor("claude-code", id, SHORT), humanApproved: false }, ctx);
    ids.push(id);
    rmSync(local, { force: true });
    report["postcondition"] = { id, code: d.code, lifecycle: d.envelope.tasks[0]?.lifecycle ?? null, reason: record(id).history.at(-1)?.detail ?? null };
    say(`pós-condição com hook do projeto: ${d.envelope.tasks[0]?.lifecycle}`);
    save();
  }

  // Close everything through the CLI once the agents stop.
  // A present return does not mean the agent stopped; close waits until no
  // agent of the run is working.
  say("Esperando os agentes pararem para fechar as tarefas.");
  const stopBy = Date.now() + waitMs;
  for (;;) {
    const s = await status({ ids: ids.filter(live), all: false }, ctx);
    if (!s.envelope.tasks.some((t) => t.agent === "working") || Date.now() > stopBy) break;
    await Bun.sleep(5000);
  }
  for (const id of ids) {
    const lifecycle = record(id).lifecycle;
    if (lifecycle === "closed") continue;
    const beforeClose = await backend.snapshot();
    const ownTab = record(id).backend_ids.tab;
    const neighbors = beforeClose.tabs.filter((t) => t.id !== ownTab).map((t) => t.id);
    const x = await cli("close", id);
    const afterClose = await backend.snapshot();
    if (x.code === 0 && (!afterClose.workspaces.some((w) => w.id === projectWorkspace) || neighbors.some((tab) => !afterClose.tabs.some((t) => t.id === tab)))) throw new Error(`Close of ${id} removed the workspace or a neighbor tab`);
    say(`close ${id}: ${x.code}${x.envelope.refusal ? ` ${x.envelope.refusal.code}` : ""}`);
  }
} catch (error) {
  say(`ERRO: ${error instanceof Error ? error.message : String(error)}`);
  report["error"] = error instanceof Error ? error.message : String(error);
} finally {
  Bun.spawnSync([realHerdr, "--session", session, "server", "stop"], { env: serverEnv });
  server?.kill();
  const worktrees = git(repo, ["worktree", "list", "--porcelain"], process.env).stdout.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
  const branches = git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads/smoke/"], process.env).stdout.split("\n").filter(Boolean);
  rmSync(configHome, { recursive: true, force: true });
  report["leftovers"] = { worktrees: worktrees.filter((w) => w !== repo), branches, registry: stateHome };
  save();
  say(`Relatório em ${out}`);
}
