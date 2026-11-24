// The herdr configuration is adapter-owned. Validation never reads mapped paths.
const SESSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CONTROL = /[\x00-\x1f\x7f]/;
const KNOWN = new Set(["session", "workspace_labels"]);

export type HerdrConfig = { session: string | null; workspace_labels?: Record<string, string> };

export function parseHerdrConfig(block: Record<string, unknown> | null): { ok: true; config: HerdrConfig } | { ok: false; message: string } {
  if (block === null) return { ok: true, config: { session: null } };
  const unknown = Object.keys(block).filter((key) => !KNOWN.has(key));
  if (unknown.length > 0) return { ok: false, message: `Unknown herdr keys: ${unknown.map((key) => JSON.stringify(key)).join(", ")}` };
  const session = block["session"];
  if (session !== undefined && (typeof session !== "string" || !SESSION.test(session))) return { ok: false, message: `herdr.session must match ${SESSION.source}` };
  const config: HerdrConfig = { session: typeof session === "string" ? session : null };
  if (Object.hasOwn(block, "workspace_labels")) {
    const labels = block["workspace_labels"];
    if (labels === null || typeof labels !== "object" || Array.isArray(labels)) return { ok: false, message: "herdr.workspace_labels must be an object of absolute paths to labels" };
    for (const [key, value] of Object.entries(labels)) {
      const invalid = (rule: string) => ({ ok: false as const, message: `herdr.workspace_labels key ${JSON.stringify(key)}: ${rule}` });
      if (!key.startsWith("/") || CONTROL.test(key) || key.slice(1).split("/").some((part) => part === "" || part === "." || part === "..")) return invalid("must be an absolute slash-separated path without empty, dot, dot-dot or control-character segments or a trailing slash");
      if (typeof value !== "string" || [...value].length < 1 || [...value].length > 128 || CONTROL.test(value) || value.trim() !== value) return invalid("label must be a string of 1 to 128 characters without control characters or surrounding whitespace");
    }
    config.workspace_labels = labels as Record<string, string>;
  }
  return { ok: true, config };
}
