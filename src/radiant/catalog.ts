import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Adapter } from "./route.ts";
import type { Failure } from "./validators.ts";

// The Radiant files the routing reads (Spec 3, item 6): the capability order
// and the role defaults in agents.json, and each candidate adapter's
// capabilities.json and provides.json. They are tracked files of the pinned,
// clean checkout the gate just checked, so a file out of shape means the
// checkout is not what the pin promises: validator-failed.

export type Catalog = { order: string[]; roles: ReadonlyMap<string, string>; adapters: ReadonlyMap<string, Adapter> };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

export function readCatalog(root: string, harnesses: readonly string[]): { ok: true; catalog: Catalog } | { ok: false; failure: Failure } {
  const broken = (path: string): { ok: false; failure: Failure } => ({
    ok: false,
    failure: { code: "validator-failed", message: `arquivo do checkout Radiant fora do formato: ${path}`, next: "Confira o checkout Radiant em radiant.root, limpo e no pin do projeto." },
  });
  const agentsPath = join(root, "skills", "radiant-delegation", "agents.json");
  const agents = readJson(agentsPath);
  if (!isObject(agents) || !Array.isArray(agents["capabilities"]) || !Array.isArray(agents["agents"])) return broken(agentsPath);
  const order = agents["capabilities"];
  if (!order.every((c): c is string => typeof c === "string")) return broken(agentsPath);
  const roles = new Map<string, string>();
  for (const agent of agents["agents"]) {
    if (!isObject(agent) || typeof agent["name"] !== "string" || typeof agent["capability"] !== "string") return broken(agentsPath);
    roles.set(agent["name"], agent["capability"]);
  }
  const adapters = new Map<string, Adapter>();
  for (const harness of new Set(harnesses)) {
    const dir = join(root, "adapters", harness);
    const models = readJson(join(dir, "capabilities.json"));
    if (!isObject(models) || !Object.values(models).every((m) => typeof m === "string")) return broken(join(dir, "capabilities.json"));
    const provides = readJson(join(dir, "provides.json"));
    if (!isObject(provides) || !Array.isArray(provides["provides"]) || !provides["provides"].every((t) => typeof t === "string")) return broken(join(dir, "provides.json"));
    adapters.set(harness, { models: models as Record<string, string>, provides: provides["provides"] as string[] });
  }
  return { ok: true, catalog: { order, roles, adapters } };
}
