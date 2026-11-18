import { posix } from "node:path";
import { isOutcome, open, refuse, type Context, type Envelope, type Outcome, type TaskView } from "../core/commands/common.ts";
import { attention, observe } from "../core/commands/status.ts";
import { dependencyPending } from "../core/dependency.ts";
import { git, readCommitFile } from "../core/git.ts";
import { parseRadiantConfig } from "./config.ts";
import { projectPath, readBaseMap } from "./project.ts";
import { checkProject, checkRouting, checkUnits, type Failure } from "./validators.ts";

export type UnitView = {
  id: string;
  dependsOn: string[];
  writes: string[];
  rule: "default";
  state: "pending" | "waiting" | TaskView["lifecycle"];
  waitingOn: string[];
  task: TaskView | null;
};
export type UnitsEnvelope = Envelope & {
  contract: string | null;
  base: { commit: string } | null;
  units: UnitView[];
};
export type UnitsOutcome = { code: 0 | 1 | 2; envelope: UnitsEnvelope };

// Also used for refusals before entering the integration (usage/config).
export function unitsRefusal(envelope: Envelope): UnitsEnvelope {
  return { ...envelope, tasks: [], contract: null, base: null, units: [] };
}

// Ignore code and images: they do not declare an active contract. Resolve
// inline and reference-style Markdown links without interpreting prose as
// activation, dates or filenames. Only contract-shaped local targets count.
function activeTargets(text: string, pointer: string): string[] | null {
  let fence: string | null = null;
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence !== null) {
      if (marker && marker[1]?.[0] === fence[0] && (marker[1]?.length ?? 0) >= fence.length && marker[2]?.trim() === "") fence = null;
      continue;
    }
    if (marker) { fence = marker[1] ?? null; continue; }
    lines.push(line);
  }
  const prose = lines.join("\n").replace(/`+[^`]*`+/g, "");
  if (/^\s*none\s*$/mi.test(prose)) return null;
  const references = new Map<string, string>();
  const key = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();
  for (const match of prose.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm)) {
    references.set(key(match[1] ?? ""), match[2] ?? match[3] ?? "");
  }
  const targets: string[] = [];
  const content = prose.replace(/^ {0,3}\[[^\]]+\]:.*$/gm, "");
  for (const match of content.matchAll(/(?<!!)\[([^\]]+)\](?:\(\s*(?:<([^>]+)>|([^\s()]+))(?:\s+["'][^\n]*?["'])?\s*\)|\[([^\]]*)\])?/g)) {
    const target = match[2] ?? match[3] ?? references.get(key(match[4] || match[1] || ""));
    if (target === undefined || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("/") || /[?#\n\r\0\\]/.test(target)) continue;
    const resolved = posix.normalize(posix.join(posix.dirname(pointer), target));
    if (/^TC-\d{4}-.*\.md$/.test(posix.basename(resolved))) targets.push(resolved);
  }
  return [...new Set(targets)];
}

// Spec 4: an observation, not a dispatch preflight. It never selects a
// candidate, takes the project lock, recovers a task or creates state.
export async function units(contractPath: string | null, ctx: Context): Promise<UnitsOutcome> {
  const stop = (failure: Failure): UnitsOutcome => ({ code: 2, envelope: unitsRefusal(refuse("units", failure.code, failure.message, failure.next, failure.hold).envelope) });
  const stopped = (outcome: Outcome): UnitsOutcome => ({ code: outcome.code, envelope: unitsRefusal(outcome.envelope) });
  const session = open("units", ctx);
  if (isOutcome(session)) return stopped(session);
  const { project, registry, config } = session;
  const radiant = parseRadiantConfig(config.radiant);
  if (!radiant.ok) return stop({ code: radiant.code, message: radiant.message, next: "Configure an absolute radiant.root at the project's Radiant pin." });
  const root = radiant.config.root;
  const gate = checkProject(root, project.callerRoot, ctx.env);
  if (!gate.ok) return stop(gate.failure);
  const base = git(project.callerRoot, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], ctx.env);
  if (base.code !== 0) return stop({ code: "task-invalid", message: "HEAD does not resolve to a commit", next: "Run units from a checkout with a committed HEAD." });
  const commit = base.stdout;
  const mapped = readBaseMap(project.callerRoot, commit, gate.pin, ctx.env);
  if (!mapped.ok) return stop(mapped.failure);
  const notFound = (message: string) => stop({ code: "contract-not-found", message: `${message} at commit ${commit}`, next: "Pass --contract <path> relative to the checkout root, inside its committed contracts directory." });
  const dir = projectPath(mapped.map["contracts"]);
  if (dir === null) return notFound("The committed map has no usable contracts directory");
  let contract: string | null;
  if (contractPath !== null) {
    contract = projectPath(contractPath);
  } else {
    const pointer = projectPath(mapped.map["active_contract"]);
    if (pointer === null || pointer === "") return notFound("The committed map has no active_contract pointer");
    const file = readCommitFile(project.callerRoot, commit, pointer, ctx.env);
    if (!file.ok || file.text === null) return notFound(`Cannot read active contract pointer ${pointer}`);
    const targets = activeTargets(file.text, pointer);
    if (targets === null || targets.length !== 1) return notFound(`Active contract pointer ${pointer} has no unique local contract link`);
    contract = projectPath(targets[0]);
  }
  if (contract === null || contract === "" || (dir !== "" && !contract.startsWith(`${dir}/`))) return notFound("The contract path must stay inside contracts");
  const file = readCommitFile(project.callerRoot, commit, contract, ctx.env);
  if (!file.ok || file.text === null) return notFound(`Cannot read regular contract file ${contract}`);
  const checked = checkUnits(root, project.callerRoot, { text: `${file.text}\n`, path: contract, commit }, ctx.env);
  if (!checked.ok) return stop(checked.failure);
  const routing = checkRouting(root, project.callerRoot, ctx.env);
  if (!routing.ok) return stop(routing.failure);

  const records = registry.list();
  const matches = new Map<string, typeof records[number]>();
  for (const unit of checked.units) {
    const found = records.filter((record) => record.id === unit.id && record.provenance["contract"] === contract);
    if (found.length > 1) return stop({ code: "task-invalid", message: `Multiple registry tasks match ${contract}, unit ${unit.id}: ${found.map((r) => r.id).join(", ")}`, next: "Inspect the inconsistent registry; units never chooses an attempt by timestamp." });
    if (found[0] !== undefined) matches.set(unit.id, found[0]);
  }
  let tasks: TaskView[] = [];
  if (matches.size > 0) {
    const observed = await observe("units", [...matches.values()], registry, ctx);
    if (isOutcome(observed)) return stopped(observed);
    tasks = observed.tasks;
    for (const record of observed.records) matches.set(record.id, record);
  }
  const views = new Map(tasks.map((task) => [task.id, task]));
  const list: UnitView[] = checked.units.map((unit) => {
    const task = views.get(unit.id) ?? null;
    const waitingOn = task !== null ? [] : unit.dependsOn.filter((id) => dependencyPending(matches.get(id), project.mainCheckout, commit, ctx.env) !== null);
    return { id: unit.id, dependsOn: unit.dependsOn, writes: unit.writes, rule: "default", state: task?.lifecycle ?? (waitingOn.length === 0 ? "pending" : "waiting"), waitingOn, task };
  });
  const pending = list.some((unit) => unit.state === "pending" || unit.state === "waiting") || tasks.some(attention);
  return { code: pending ? 1 : 0, envelope: { ok: true, command: "units", tasks, contract, base: { commit }, units: list, refusal: null } };
}
