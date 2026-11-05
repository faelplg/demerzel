import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dispatch, type Outcome } from "../../../src/core/index.ts";
import { refuse } from "../../../src/core/commands/common.ts";
import { loadConfig } from "../../../src/core/config.ts";
import type { Env } from "../../../src/core/env.ts";
import type { FakeBackend } from "../../../src/core/fake-backend.ts";
import { git } from "../../../src/core/git.ts";
import { prepareDispatch, type DispatchRequest } from "../../../src/radiant/index.ts";
import { context, type Sandbox } from "../../core/helpers/sandbox.ts";

// TC-0003, output 4: fixture consumers in temporary repositories, against
// the real Radiant checkout at the pin, never a fake Radiant. The checkout
// comes from DEMERZEL_RADIANT_ROOT and is only read.

export const PIN: string = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", ".radiant.json"), "utf8")).radiant_revision;

// Fails, never skips, when the checkout is missing or off the pin, with
// what to do (contract, section 9).
export function radiantRoot(): string {
  const how = `aponte DEMERZEL_RADIANT_ROOT para um checkout limpo de faelplg/radiant no pin ${PIN}, por exemplo: DEMERZEL_RADIANT_ROOT=<checkout> bun run check`;
  const root = process.env["DEMERZEL_RADIANT_ROOT"];
  if (root === undefined || root === "") throw new Error(`DEMERZEL_RADIANT_ROOT não está definido: ${how}`);
  if (!existsSync(root)) throw new Error(`DEMERZEL_RADIANT_ROOT=${root} não existe: ${how}`);
  const head = git(root, ["rev-parse", "HEAD"], { PATH: process.env["PATH"], GIT_CONFIG_NOSYSTEM: "1" });
  if (head.code !== 0 || head.stdout !== PIN) throw new Error(`o checkout em DEMERZEL_RADIANT_ROOT está em ${head.stdout || "nenhum commit"}, não no pin: ${how}`);
  return realpathSync(root);
}

// Every file of the checkout, ignored ones included, so a suite that leaves
// bytecode or anything else behind is caught (contract, section 11).
export function radiantFiles(root: string): string {
  return git(root, ["status", "--porcelain", "--ignored", "--untracked-files=all"], { PATH: process.env["PATH"], GIT_CONFIG_NOSYSTEM: "1" }).stdout;
}

export const MAP_FIELDS = ["frame", "spec", "plan", "workflow", "active_contract", "engineering_profile", "adrs", "verification", "learning"] as const;

export function map(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { radiant_revision: PIN, ...Object.fromEntries(MAP_FIELDS.map((f) => [f, null])), contracts: "docs/contracts", ...overrides };
}

export type UnitSpec = { id: string; role?: string; capability?: string; capability_reason?: string; requires?: string[]; writes?: string[]; depends_on?: string[]; objective?: string; done_when?: string };

function yamlList(key: string, items: string[]): string[] {
  return items.length === 0 ? [`    ${key}: []`] : [`    ${key}:`, ...items.map((i) => `      - ${i}`)];
}

export function unitsBlock(units: UnitSpec[]): string {
  const out = ["```yaml radiant-units", "units:"];
  for (const u of units) {
    out.push(`  - id: ${u.id}`, `    role: ${u.role ?? "radiant-dev"}`);
    if (u.capability !== undefined) out.push(`    capability: ${u.capability}`, `    capability_reason: ${u.capability_reason ?? "fixture"}`);
    if (u.requires !== undefined) out.push(...yamlList("requires", u.requires));
    out.push(`    objective: ${u.objective ?? "Implementar a parte da fixture"}`);
    out.push(...yamlList("writes", u.writes ?? [`src/${u.id}/`]));
    if (u.depends_on !== undefined) out.push(...yamlList("depends_on", u.depends_on));
    out.push(`    done_when: ${u.done_when ?? "Os testes da fixture passam"}`);
  }
  out.push("```");
  return out.join("\n");
}

export function contractText(units: UnitSpec[], body = "Contrato de fixture do TC-0003."): string {
  return `# Radiant Task Contract - fixture\n\n${body}\n\n${unitsBlock(units)}\n`;
}

export const CONTRACT = "docs/contracts/TC-0042-fixture.md";

export const DEFAULT_UNITS: UnitSpec[] = [
  { id: "TC-0042.1" },
  { id: "TC-0042.2", role: "radiant-verifier", depends_on: ["TC-0042.1"], writes: ["docs/verification/"] },
];

// Writes a consumer into the sandbox repository and commits it: the map at
// the pin, .radiant/ ignored, and one contract.
export function consumer(sb: Sandbox, options: { map?: Record<string, unknown>; units?: UnitSpec[]; body?: string; gitignore?: string } = {}): string {
  const write = (path: string, content: string) => {
    mkdirSync(join(sb.repo, path, ".."), { recursive: true });
    writeFileSync(join(sb.repo, path), content);
  };
  write(".radiant.json", `${JSON.stringify(options.map ?? map(), null, 2)}\n`);
  write(".gitignore", options.gitignore ?? ".radiant/\n");
  write(CONTRACT, contractText(options.units ?? DEFAULT_UNITS, options.body));
  return commitAll(sb, "consumer fixture");
}

export function commitAll(sb: Sandbox, message: string): string {
  const run = (args: string[]) => {
    const r = git(sb.repo, args, sb.env);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  run(["add", "-A"]);
  run(["commit", "-q", "--allow-empty", "-m", message]);
  return run(["rev-parse", "HEAD"]);
}

export function writeConfig(sb: Sandbox, config: unknown): void {
  mkdirSync(join(sb.configHome, "demerzel"), { recursive: true });
  writeFileSync(join(sb.configHome, "demerzel", "config.json"), typeof config === "string" ? config : JSON.stringify(config));
}

export function writeRouting(sb: Sandbox, routing: unknown): void {
  mkdirSync(join(sb.configHome, "radiant"), { recursive: true });
  writeFileSync(join(sb.configHome, "radiant", "routing.json"), typeof routing === "string" ? routing : JSON.stringify(routing));
}

export const ROUTING = {
  schema: 1,
  rules: [
    { id: "codex-build", when: "Build units sent to Codex", use: [{ harness: "codex" }] },
    { id: "critique", when: "Critique by another vendor", use: [{ harness: "codex", capability: "deep" }], approval: "human" },
  ],
  default: [{ harness: "claude-code" }, { harness: "codex" }],
};

// The fixture with a valid configuration and routing.
export function ready(sb: Sandbox, root: string, options: Parameters<typeof consumer>[1] = {}): string {
  writeConfig(sb, { schema: 1, radiant: { root } });
  writeRouting(sb, ROUTING);
  return consumer(sb, options);
}

export const request = (overrides: Partial<DispatchRequest> = {}): DispatchRequest => ({ unitId: "TC-0042.1", rule: null, base: null, humanApproved: false, ...overrides });

// What the CLI does for dispatch, in process: the configuration, the
// integration and then the core, over the fake backend.
export async function attempt(sb: Sandbox, be: FakeBackend, overrides: Partial<DispatchRequest> = {}, options: { env?: Env; cwd?: string } = {}): Promise<Outcome> {
  const env = options.env ?? sb.env;
  const cwd = options.cwd ?? sb.repo;
  const config = loadConfig(env);
  if (!config.ok) return refuse("dispatch", "config-invalid", config.message, "");
  const req = request(overrides);
  const prepared = prepareDispatch(req, { cwd, env, backend: be, config: config.config });
  if (!prepared.ok) return prepared.outcome;
  return dispatch({ task: prepared.task, humanApproved: req.humanApproved }, context(sb, be, { env, cwd }));
}

// A python3 first on PATH that records each validator run and passes it to
// the real python3, or, for one validator, answers outside its protocol.
// "swap-after" runs the real validator and then copies `swap.from` over
// `swap.to`, as when a file changes right after the gate read it.
export type PythonMode = "pass" | "exit2" | "signal" | "garbage" | "exit1-no-hold" | "exit1-garbage" | "pass-no-revision" | "swap-after";

export type Interposer = { env: Env; runs: () => string[]; bytecode: () => string[] };

// `target` is a validator, or a validator and its subcommand, such as
// "check_dispatch.py routing".
export function interposePython(sb: Sandbox, mode: PythonMode = "pass", target = "check_project.py", swap?: { from: string; to: string }): Interposer {
  const real = Bun.which("python3");
  if (real === null) throw new Error("python3 não está no PATH");
  const bin = join(sb.root, "py-bin");
  mkdirSync(bin, { recursive: true });
  const log = join(sb.root, "py-runs.log");
  const bytecode = join(sb.root, "py-bytecode.log");
  writeFileSync(log, "");
  writeFileSync(bytecode, "");
  writeFileSync(
    join(bin, "python3"),
    [
      "#!/bin/sh",
      'script=$(basename "$1")',
      `printf '%s %s\\n' "$script" "$2" >> ${JSON.stringify(log)}`,
      `printf '%s\\n' "\${PYTHONDONTWRITEBYTECODE-unset}" >> ${JSON.stringify(bytecode)}`,
      `if [ "$script" = ${JSON.stringify(target)} ] || [ "$script $2" = ${JSON.stringify(target)} ]; then`,
      `  case ${JSON.stringify(mode)} in`,
      '    exit2) echo "falha injetada" >&2; exit 2 ;;',
      "    signal) kill -TERM $$ ;;",
      '    garbage) echo "isto não é JSON"; exit 0 ;;',
      '    exit1-no-hold) echo "sem a linha esperada" >&2; exit 1 ;;',
      '    exit1-garbage) echo "isto não é JSON"; exit 1 ;;',
      '    pass-no-revision) echo "PASS: tudo certo"; exit 0 ;;',
      `    swap-after) ${JSON.stringify(real)} "$@"; result=$?; cp ${JSON.stringify(swap?.from ?? "")} ${JSON.stringify(swap?.to ?? "")}; exit "$result" ;;`,
      "  esac",
      "fi",
      `exec ${JSON.stringify(real)} "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "python3"), 0o755);
  return {
    env: { ...sb.env, PATH: `${bin}:${sb.env["PATH"] ?? ""}` },
    runs: () => readFileSync(log, "utf8").split("\n").filter(Boolean),
    bytecode: () => readFileSync(bytecode, "utf8").split("\n").filter(Boolean),
  };
}

// A PATH with git and nothing else: no python3.
export function withoutPython(sb: Sandbox): Env {
  const bin = join(sb.root, "git-only");
  mkdirSync(bin, { recursive: true });
  const found = Bun.which("git");
  if (found === null) throw new Error("git não está no PATH");
  if (!existsSync(join(bin, "git"))) symlinkSync(found, join(bin, "git"));
  return { ...sb.env, PATH: bin };
}

// No effect: no backend effect call, no task file, no branch or worktree.
export function effects(sb: Sandbox, be: FakeBackend): { calls: string[]; tasks: Record<string, string>; git: string } {
  return { calls: be.effectCalls().map((c) => c.op), tasks: sb.tasksSnapshot(), git: sb.gitState() };
}
