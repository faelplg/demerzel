import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Backend } from "../core/backend.ts";
import { refuse, type Outcome } from "../core/commands/common.ts";
import type { Config } from "../core/config.ts";
import type { Env } from "../core/env.ts";
import { git } from "../core/git.ts";
import type { Task } from "../core/types.ts";
import { readCatalog } from "./catalog.ts";
import { parseRadiantConfig } from "./config.ts";
import { route } from "./route.ts";
import { checkProject, checkRouting, checkUnits, type Failure } from "./validators.ts";

// Spec 3: turns a unit of a Radiant Task Contract into a core task. Every
// check here only reads Git objects of the base commit, the Radiant checkout
// and the user's files, so it runs before the core's dispatch and without the
// project lock (Spec 4). Each refusal exits 2 with no effect, and the run
// stops at the first one: the gate, `units` and `routing` run at most once.

export type DispatchRequest = { unitId: string; rule: string | null; base: string | null; humanApproved: boolean };
export type Prepared = { ok: true; task: Task } | { ok: false; outcome: Outcome };

const C = "dispatch";
const UNIT_ID = /^(TC-\d{4})\.[1-9]\d*$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function stop(failure: Failure): Prepared {
  return { ok: false, outcome: refuse(C, failure.code, failure.message, failure.next, failure.hold ?? false) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// A relative path inside the repository, as check_project.py accepts it:
// not absolute and without `..`. Returns the directory with no trailing
// slash, "" for the root, or null.
function contractsDir(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "" || value.startsWith("/") || /[\n\r\0\\]/.test(value)) return null;
  const parts = value.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.includes("..")) return null;
  return parts.join("/");
}

export function prepareDispatch(request: DispatchRequest, ctx: { cwd: string; env: Env; backend: Backend; config: Config }): Prepared {
  const { env } = ctx;

  // Spec 3, item 1: the root of the caller checkout.
  const top = git(ctx.cwd, ["rev-parse", "--show-toplevel"], env);
  if (top.code !== 0) return stop({ code: "not-a-project", message: `${ctx.cwd} não está num repositório Git`, next: "Rode o comando dentro do checkout do projeto." });
  const project = top.stdout;

  // Spec 2.4, the radiant block.
  const radiant = parseRadiantConfig(ctx.config.radiant);
  if (!radiant.ok) {
    const next = radiant.code === "radiant-root-missing" ? "Ponha radiant.root, o checkout Radiant da máquina, na configuração do Demerzel." : "Corrija o bloco radiant da configuração do Demerzel e rode de novo.";
    return stop({ code: radiant.code, message: radiant.message, next });
  }
  const { root, branchPrefix } = radiant.config;

  // The unit ID carries the contract prefix (Spec 3, item 4).
  const id = UNIT_ID.exec(request.unitId);
  if (id === null) return stop({ code: "unit-not-found", message: `${request.unitId} não é um ID de unidade no formato TC-NNNN.N`, next: "Passe o ID de uma unidade do bloco radiant-units." });
  const prefix = id[1] ?? "";

  // Spec 3, item 2: the pin gate, on the caller checkout.
  const gate = checkProject(root, project, env);
  if (!gate.ok) return stop(gate.failure);
  let map: unknown;
  try {
    map = parseJson(readFileSync(join(project, ".radiant.json"), "utf8"));
  } catch {
    map = undefined;
  }
  const pin = isObject(map) ? map["radiant_revision"] : undefined;
  if (typeof pin !== "string" || !COMMIT.test(pin)) return stop({ code: "pin-mismatch", message: "o .radiant.json do checkout chamador não tem um radiant_revision completo", next: "Confira o pin do projeto." });

  // Spec 3, item 3: the base, resolved to a commit once.
  let baseRef = request.base;
  if (baseRef === null) {
    const branch = git(project, ["symbolic-ref", "--quiet", "--short", "HEAD"], env);
    baseRef = branch.code === 0 ? branch.stdout : null;
  }
  const resolved = git(project, ["rev-parse", "--verify", "--quiet", `${baseRef ?? "HEAD"}^{commit}`], env);
  if (resolved.code !== 0) return stop({ code: "task-invalid", message: `base não resolve para um commit: ${baseRef ?? "HEAD"}`, next: "Passe uma base que resolva para um commit." });
  const commit = resolved.stdout;
  baseRef ??= commit;

  // The map of the base commit must carry the pin the gate validated.
  const shown = git(project, ["show", `${commit}:.radiant.json`], env);
  const mismatch = (why: string): Prepared => stop({ code: "pin-mismatch", message: `o .radiant.json do commit base ${commit} ${why}`, next: "Despache de uma base que já tem o pin validado." });
  if (shown.code !== 0) return mismatch("não existe");
  const baseMap = parseJson(shown.stdout);
  if (!isObject(baseMap)) return mismatch("não é um objeto JSON");
  if (!("radiant_revision" in baseMap)) return mismatch("não tem radiant_revision");
  if (baseMap["radiant_revision"] !== pin) return mismatch(`tem outro radiant_revision (${String(baseMap["radiant_revision"])}), não o pin ${pin} validado`);

  // Spec 3, item 4: exactly one TC-NNNN-*.md in `contracts` of the base map,
  // read from the base commit, never from the working tree.
  const notFound = (why: string): Prepared => stop({ code: "contract-not-found", message: why, next: "Confira o diretório contracts e o contrato no commit base." });
  const dir = contractsDir(baseMap["contracts"]);
  if (dir === null) return notFound(`o .radiant.json do commit base ${commit} não tem contracts como path relativo dentro do repositório`);
  const listed = git(project, ["ls-tree", "-z", "--full-tree", commit, "--", dir === "" ? "." : `${dir}/`], env);
  const pattern = new RegExp(`^${prefix}-.+\\.md$`);
  const matches = listed.code !== 0 ? [] : listed.stdout.split("\0").filter(Boolean).flatMap((row) => {
    const [meta, path] = row.split("\t");
    const name = path?.split("/").at(-1) ?? "";
    return meta?.split(" ")[1] === "blob" && path !== undefined && pattern.test(name) ? [path] : [];
  });
  if (matches.length !== 1) return notFound(`${matches.length === 0 ? "nenhum" : `${matches.length}`} ${prefix}-*.md em ${dir === "" ? "." : dir} no commit base ${commit}; precisa haver exatamente um`);
  const contract = matches[0] ?? "";
  const text = git(project, ["show", `${commit}:${contract}`], env);
  if (text.code !== 0) return notFound(`${contract} não pôde ser lido do commit base ${commit}`);

  // Spec 3, item 5: units and rules, from the Radiant checkout.
  const units = checkUnits(root, project, { text: `${text.stdout}\n`, path: contract, commit }, env);
  if (!units.ok) return stop(units.failure);
  const unit = units.units.find((u) => u.id === request.unitId);
  if (unit === undefined) return stop({ code: "unit-not-found", message: `${request.unitId} não está no bloco radiant-units de ${contract} no commit base ${commit}`, next: "Confira o ID da unidade no contrato do commit base." });
  const rules = checkRouting(root, project, env);
  if (!rules.ok) return stop(rules.failure);
  const ruleId = request.rule ?? "default";
  const rule = request.rule === null ? { id: "default", use: rules.rules.default, approval: null } : rules.rules.rules.find((r) => r.id === request.rule);
  if (rule === undefined) return stop({ code: "routing-invalid", message: `o routing.json não tem a regra ${ruleId}`, next: "Escolha uma regra que existe no routing.json, ou despache sem --rule para usar default." });

  // Spec 3, item 6.
  const catalog = readCatalog(root, rule.use.map((c) => c.harness));
  if (!catalog.ok) return stop(catalog.failure);
  const chosen = route({
    candidates: rule.use,
    unit,
    roleDefault: catalog.catalog.roles.get(unit.role) ?? null,
    order: catalog.catalog.order,
    adapters: catalog.catalog.adapters,
    supports: (harness) => ctx.backend.supportsHarness(harness),
  });
  if (!chosen.ok) {
    return stop({
      code: "no-viable-candidate",
      message: `nenhum candidato viável na regra ${ruleId} para ${unit.id}: ${chosen.reasons.join("; ")}`,
      next: chosen.hold ? "HOLD: só faltou capacidade; o Demerzel não rebaixa. Decida a capacidade ou a regra." : "Escolha outra regra ou ajuste os candidatos do routing.json.",
      hold: chosen.hold,
    });
  }

  if (rule.approval === "human" && !request.humanApproved) {
    return stop({ code: "approval-required", message: `a regra ${ruleId} pede aprovação humana`, next: "Com a decisão do humano, despache de novo com --human-approved." });
  }

  // Spec 3, item 7: the return must be ignored by Git in the caller checkout.
  const returnPath = `.radiant/reports/${unit.id}.md`;
  const ignored = git(project, ["check-ignore", "--quiet", "--", returnPath], env);
  if (ignored.code !== 0) {
    return stop({ code: "reports-not-ignored", message: `${returnPath} não é ignorado pelo Git em ${project}${ignored.code === 1 ? "" : `: ${ignored.stderr}`}`, next: "Ignore .radiant/ no .gitignore do projeto." });
  }

  // Spec 3, items 8 and 9, and 2.1.
  const task: Task = {
    id: unit.id,
    harness: chosen.harness,
    model: chosen.model,
    branch: `${branchPrefix}${unit.id}`,
    base: commit,
    writes: unit.writes,
    dependsOn: unit.dependsOn,
    request: {
      role: unit.role,
      pointers: [
        { label: "radiant-root", path: root },
        { label: "radiant-revision", ref: pin },
        { label: "contract", path: contract },
      ],
    },
    returnPath,
    provenance: { radiant_revision: pin, radiant_root: root, contract, rule: ruleId, base_ref: baseRef },
  };
  if (chosen.effort !== null) task.effort = chosen.effort;
  if (rule.approval === "human") task.approval = "human";
  return { ok: true, task };
}
