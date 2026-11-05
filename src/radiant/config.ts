import { isAbsolute } from "node:path";

// Spec 2.4, the integration's part of the configuration: `radiant.root` is
// required to dispatch and has no default; `branch_prefix` is optional and
// defaults to `radiant/`. The core passes this block through unread.

export type RadiantConfig = { root: string; branchPrefix: string };

export type RadiantConfigResult =
  | { ok: true; config: RadiantConfig }
  | { ok: false; code: "radiant-root-missing" | "config-invalid"; message: string };

const KNOWN = new Set(["root", "branch_prefix"]);

export function parseRadiantConfig(block: Record<string, unknown> | null): RadiantConfigResult {
  const invalid = (message: string): RadiantConfigResult => ({ ok: false, code: "config-invalid", message });
  const unknown = block === null ? [] : Object.keys(block).filter((key) => !KNOWN.has(key));
  if (unknown.length > 0) return invalid(`o bloco radiant tem chave desconhecida: ${unknown.join(", ")}`);
  const root = block?.["root"];
  if (root === undefined) return { ok: false, code: "radiant-root-missing", message: "a configuração não tem radiant.root, o checkout Radiant da máquina" };
  // The root becomes the absolute radiant-root pointer of the request.
  if (typeof root !== "string" || !isAbsolute(root) || /[\n\r\0]/.test(root)) return invalid("radiant.root precisa ser um path absoluto");
  // Only an absent key takes the default: null is a wrong type (finding 2
  // of the independent critique).
  const prefix = block !== null && "branch_prefix" in block ? block["branch_prefix"] : "radiant/";
  if (typeof prefix !== "string") return invalid("radiant.branch_prefix precisa ser texto");
  return { ok: true, config: { root, branchPrefix: prefix } };
}
