// Spec 2.4: the `herdr` block of the Demerzel configuration, read only by
// this backend. `session` is optional; when present every herdr call carries
// --session <name>.

const SESSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KNOWN = new Set(["session"]);

export type HerdrConfig = { session: string | null };

export function parseHerdrConfig(block: Record<string, unknown> | null): { ok: true; config: HerdrConfig } | { ok: false; message: string } {
  if (block === null) return { ok: true, config: { session: null } };
  const unknown = Object.keys(block).filter((key) => !KNOWN.has(key));
  if (unknown.length > 0) return { ok: false, message: `"herdr" tem chave desconhecida: ${unknown.join(", ")}` };
  const session = block["session"];
  if (session === undefined) return { ok: true, config: { session: null } };
  if (typeof session !== "string" || !SESSION.test(session)) {
    return { ok: false, message: `"herdr.session" fora do formato ${SESSION.source}` };
  }
  return { ok: true, config: { session } };
}
