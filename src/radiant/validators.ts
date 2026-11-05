import { join } from "node:path";
import type { Env } from "../core/env.ts";
import { runPython, type PythonRun } from "./python.ts";

// Spec 3, items 2 and 5: the two Radiant validators, each read through its
// own protocol. A domain error becomes the integration's refusal; anything
// else (another exit, a signal, a missing python3, text outside the promised
// format) is validator-failed. The rules themselves live only in Radiant.

export type Failure = { code: string; message: string; next: string; hold?: boolean };

export type Unit = {
  id: string;
  role: string;
  capability: string | null;
  requires: string[];
  writes: string[];
  dependsOn: string[];
};

export type Candidate = { harness: string; capability: string | null; effort: string | null };
export type Rule = { id: string; use: Candidate[]; approval: "human" | null };
export type Rules = { rules: Rule[]; default: Candidate[] };

// Spec 3, item 5: the routing error text of the pinned revision that names a
// candidate without a Radiant adapter. Errors carry no code, so every pin
// change checks this phrase against validators/dispatch_formats.py.
export const NO_ADAPTER = "harness without an adapter";

type Script = "check_project.py" | "check_dispatch.py";

function script(root: string, name: Script): string {
  return join(root, "validators", name);
}

function lines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
}

// What happened, for the message of validator-failed. `quote` adds the first
// line the validator printed; it is false whenever the output could repeat
// the contract (Spec 6).
function describe(run: PythonRun, what: string, quote: boolean): string {
  if (run.kind === "missing") return `${what}: python3 não pôde ser executado: ${run.detail}`;
  if (run.kind === "signaled") return `${what}: terminou pelo sinal ${run.signal}`;
  const said = quote ? (lines(run.stderr)[0] ?? lines(run.stdout)[0]) : undefined;
  return `${what}: saiu com ${run.code} fora do protocolo${said === undefined ? "" : `: ${said.slice(0, 300)}`}`;
}

const FIX_RADIANT = "Confira o python3 3.9 ou acima no PATH e o checkout Radiant em radiant.root, no pin do projeto.";

function failed(message: string): Failure {
  return { code: "validator-failed", message, next: FIX_RADIANT };
}

// The PASS line of the pinned revision names the pin it checked, as in
// `PASS: Radiant <commit>; pin and paths checked.` That commit is the pin the
// gate validated, so the base map is compared with it and the caller map is
// never read again after the gate (finding 1 of the independent critique).
const PASS = /^PASS: Radiant ([0-9a-f]{40}|[0-9a-f]{64});/;

// Spec 3, item 2: `0` with a `PASS:` line on stdout passes; `1` with a
// `HOLD:` line on stderr is pin-mismatch, with that line in the message.
export function checkProject(root: string, project: string, env: Env): { ok: true; pin: string } | { ok: false; failure: Failure } {
  const what = `check_project.py ${project}`;
  const run = runPython(script(root, "check_project.py"), [project], { env, cwd: project });
  if (run.kind === "exited" && run.code === 0) {
    const pin = lines(run.stdout).map((line) => PASS.exec(line)?.[1]).find((found) => found !== undefined);
    if (pin !== undefined) return { ok: true, pin };
  }
  if (run.kind === "exited" && run.code === 1) {
    const hold = lines(run.stderr).find((line) => line.startsWith("HOLD:"));
    if (hold !== undefined) {
      return { ok: false, failure: { code: "pin-mismatch", message: `o gate de pin do Radiant não passou: ${hold}`, next: "Ponha o projeto e o checkout Radiant da máquina no mesmo pin, limpo, e despache de novo." } };
    }
  }
  return { ok: false, failure: failed(describe(run, what, true)) };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function errorsOf(stdout: string): string[] | null {
  const data = parseJson(stdout);
  return isObject(data) && strings(data["errors"]) ? data["errors"] : null;
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return null;
  return typeof value === "string" ? value : undefined;
}

// The shape check_dispatch.py promises for `units -`. Only the fields the
// integration uses are read; a unit outside this shape is validator-failed.
function readUnits(data: unknown): Unit[] | null {
  if (!isObject(data) || !Array.isArray(data["units"])) return null;
  const units: Unit[] = [];
  for (const raw of data["units"]) {
    if (!isObject(raw)) return null;
    const { id, role, writes } = raw;
    const capability = optionalText(raw["capability"]);
    const requires = raw["requires"] ?? [];
    const dependsOn = raw["depends_on"] ?? [];
    if (typeof id !== "string" || typeof role !== "string" || !strings(writes) || capability === undefined || !strings(requires) || !strings(dependsOn)) return null;
    units.push({ id, role, capability, requires, writes, dependsOn });
  }
  return units;
}

// Spec 3, item 5: the contract of the base commit goes to standard input.
// The errors repeat contract values, so the message carries only how many
// there are and the command that shows them (Spec 6).
export function checkUnits(root: string, project: string, contract: { text: string; path: string; commit: string }, env: Env): { ok: true; units: Unit[] } | { ok: false; failure: Failure } {
  const what = "check_dispatch.py units -";
  const run = runPython(script(root, "check_dispatch.py"), ["units", "-"], { env, cwd: project, stdin: contract.text });
  if (run.kind === "exited" && run.code === 0) {
    const units = readUnits(parseJson(run.stdout));
    if (units !== null) return { ok: true, units };
    return { ok: false, failure: failed(`${what}: saiu com 0 e um JSON fora do formato {"units": [...]}`) };
  }
  if (run.kind === "exited" && run.code === 1) {
    const errors = errorsOf(run.stdout);
    if (errors !== null) {
      const shown = `git -C ${project} show ${contract.commit}:${contract.path} | python3 ${script(root, "check_dispatch.py")} units -`;
      return { ok: false, failure: { code: "units-invalid", message: `o bloco radiant-units de ${contract.path} no commit ${contract.commit} tem ${errors.length} erro(s)`, next: `Veja os erros com: ${shown}` } };
    }
  }
  return { ok: false, failure: failed(describe(run, what, false)) };
}

function readCandidates(value: unknown): Candidate[] | null {
  if (!Array.isArray(value)) return null;
  const out: Candidate[] = [];
  for (const raw of value) {
    if (!isObject(raw) || typeof raw["harness"] !== "string") return null;
    const capability = optionalText(raw["capability"]);
    const effort = optionalText(raw["effort"]);
    if (capability === undefined || effort === undefined) return null;
    out.push({ harness: raw["harness"], capability, effort });
  }
  return out;
}

function readRules(data: unknown): Rules | null {
  if (!isObject(data) || !Array.isArray(data["rules"])) return null;
  const fallback = readCandidates(data["default"]);
  if (fallback === null) return null;
  const rules: Rule[] = [];
  for (const raw of data["rules"]) {
    if (!isObject(raw) || typeof raw["id"] !== "string") return null;
    const use = readCandidates(raw["use"]);
    const approval = raw["approval"];
    if (use === null || (approval !== undefined && approval !== "human")) return null;
    rules.push({ id: raw["id"], use, approval: approval === "human" ? "human" : null });
  }
  return { rules, default: fallback };
}

// Spec 3, item 5: the user's routing.json, at its default path, validated by
// Radiant. Its errors are the user's, so they reach the message; an error
// about a candidate without an adapter is harness-without-adapter.
export function checkRouting(root: string, project: string, env: Env): { ok: true; rules: Rules } | { ok: false; failure: Failure } {
  const what = "check_dispatch.py routing";
  const run = runPython(script(root, "check_dispatch.py"), ["routing"], { env, cwd: project });
  if (run.kind === "exited" && run.code === 0) {
    const rules = readRules(parseJson(run.stdout));
    if (rules !== null) return { ok: true, rules };
    return { ok: false, failure: failed(`${what}: saiu com 0 e um JSON fora do formato das regras`) };
  }
  if (run.kind === "exited" && run.code === 1) {
    const errors = errorsOf(run.stdout);
    if (errors !== null) {
      const listed = errors.join("; ");
      if (errors.some((error) => error.includes(NO_ADAPTER))) {
        return { ok: false, failure: { code: "harness-without-adapter", message: `o routing.json tem candidato sem adapter Radiant: ${listed}`, next: "Use só harnesses com adapter no checkout Radiant, ou crie o adapter no Radiant." } };
      }
      return { ok: false, failure: { code: "routing-invalid", message: `o routing.json não passou no Radiant: ${listed}`, next: "Corrija $XDG_CONFIG_HOME/radiant/routing.json e despache de novo." } };
    }
  }
  return { ok: false, failure: failed(describe(run, what, true)) };
}
