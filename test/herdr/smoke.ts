// Verification 8 of the Spec, TC-0002 section 11: Claude Code and Codex
// launched by the Demerzel through a real herdr, run by the orchestrator
// with the owner present. It spends model calls and the harnesses may ask
// for permission to write the return file.
//
//   DEMERZEL_SMOKE_REPO=<disposable repo> bun run smoke:herdr
//
// The first run creates the disposable repository and stops, so the owner can
// trust it once in each CLI. Every run starts its own herdr server, with a
// minimal environment and a short XDG_CONFIG_HOME, keeps the Demerzel state in
// a temporary folder, and writes a JSON report.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  console.log(`Criei o repositório do smoke em ${repo}.`);
  console.log("Confie esta pasta uma vez no Claude Code (`claude` dentro dela) e no Codex (`codex` dentro dela), e rode o smoke de novo.");
  process.exit(3);
}

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

  // Five short launches per harness, counted by the Plan criterion: an
  // intervention is needed whenever the request did not arrive at dispatch.
  for (const harness of harnesses) {
    for (let i = 1; i <= count; i++) {
      const id = `SMK-${run}-${harness === "codex" ? "x" : "c"}${i}`;
      const started = Date.now();
      const d = await dispatch({ task: taskFor(harness, id, SHORT), humanApproved: false }, ctx);
      const t = d.envelope.tasks[0];
      ids.push(id);
      const entry = { id, harness, code: d.code, lifecycle: t?.lifecycle ?? null, request_sent: t?.request_sent ?? null, agent: t?.agent ?? null, dispatch_ms: Date.now() - started, refusal: d.envelope.refusal, intervention_before_delivery: t?.request_sent !== true };
      (report["launches"] as unknown[]).push(entry);
      say(`${id}: code=${d.code} request_sent=${String(entry.request_sent)} agent=${entry.agent} ${entry.dispatch_ms}ms`);
      save();
    }
  }

  // Concurrency: the second dispatch ends while the first agent still works,
  // and close of the first is refused in that same interval.
  for (const harness of harnesses) {
    const a = `SMK-${run}-${harness === "codex" ? "x" : "c"}long1`;
    const b = `SMK-${run}-${harness === "codex" ? "x" : "c"}long2`;
    const da = await dispatch({ task: taskFor(harness, a, LONG), humanApproved: false }, ctx);
    const db = await dispatch({ task: taskFor(harness, b, LONG), humanApproved: false }, ctx);
    ids.push(a, b);
    const s = await status({ ids: [a], all: false }, ctx);
    const refused = await close({ id: a, discardWorktree: false }, ctx);
    const launchedAt = (id: string) => record(id).history.find((h) => h.event === "launched")?.at ?? null;
    const entry = {
      harness,
      first: { id: a, code: da.code, launched_at: launchedAt(a) },
      second: { id: b, code: db.code, launched_at: launchedAt(b) },
      first_agent_after_second: s.envelope.tasks[0]?.agent ?? null,
      close_first: refused.envelope.refusal?.code ?? `code ${refused.code}`,
      observed_at: new Date().toISOString(),
    };
    (report["concurrency"] as unknown[]).push(entry);
    say(`concorrência ${harness}: segundo dispatch ${db.code}, primeiro agente ${entry.first_agent_after_second}, close do primeiro ${entry.close_first}`);
    save();
  }

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
    const x = await cli("close", id);
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
  rmSync(join(configHome, "herdr"), { recursive: true, force: true });
  report["leftovers"] = { worktrees: worktrees.filter((w) => w !== repo), branches, registry: stateHome };
  save();
  say(`Relatório em ${out}`);
}
