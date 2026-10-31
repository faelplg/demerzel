import { existsSync, readFileSync } from "node:fs";
import { configPath, type Env } from "./env.ts";

// Spec 2.4, the core's part: schema, known keys and defaults. The `herdr`
// and `radiant` blocks pass through; their owners validate their content.
export type Config = {
  schema: 1;
  herdr: Record<string, unknown> | null;
  radiant: Record<string, unknown> | null;
};

const KNOWN = new Set(["schema", "herdr", "radiant"]);

export type ConfigResult = { ok: true; config: Config } | { ok: false; message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadConfig(env: Env): ConfigResult {
  const path = configPath(env);
  if (!existsSync(path)) return { ok: true, config: { schema: 1, herdr: null, radiant: null } };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { ok: false, message: `${path} não é JSON válido` };
  }
  if (!isObject(data)) return { ok: false, message: `${path} precisa ser um objeto JSON` };
  const unknown = Object.keys(data).filter((key) => !KNOWN.has(key));
  if (unknown.length > 0) return { ok: false, message: `${path} tem chave desconhecida: ${unknown.join(", ")}` };
  if (data["schema"] !== 1) return { ok: false, message: `${path} precisa de "schema": 1` };
  const herdr = data["herdr"];
  const radiant = data["radiant"];
  if (herdr !== undefined && !isObject(herdr)) return { ok: false, message: `${path}: "herdr" precisa ser um objeto` };
  if (radiant !== undefined && !isObject(radiant)) return { ok: false, message: `${path}: "radiant" precisa ser um objeto` };
  return { ok: true, config: { schema: 1, herdr: herdr ?? null, radiant: radiant ?? null } };
}
