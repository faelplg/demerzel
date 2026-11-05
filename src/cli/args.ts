// Spec 4: the commands, with --json everywhere. `dispatch` takes a unit ID
// and goes through the Radiant integration before the core.

export type Parsed =
  | { command: "dispatch"; json: boolean; unitId: string; rule: string | null; base: string | null; humanApproved: boolean }
  | { command: "resume" | "collect"; json: boolean; id: string }
  | { command: "status"; json: boolean; ids: string[]; all: boolean }
  | { command: "wait"; json: boolean; ids: string[]; timeoutMs: number | null }
  | { command: "close"; json: boolean; id: string; discardWorktree: boolean };

export type ParseResult = { ok: true; parsed: Parsed } | { ok: false; command: string; json: boolean; message: string };

export const USAGE = [
  "demerzel --version",
  "demerzel dispatch <unit-id> [--rule <id>] [--base <ref>] [--human-approved] [--json]",
  "demerzel resume <id> [--json]",
  "demerzel status [<id>...] [--all] [--json]",
  "demerzel wait <id>... [--timeout <ms>] [--json]",
  "demerzel collect <id> [--json]",
  "demerzel close <id> [--discard-worktree] [--json]",
].join("\n");

export function parse(argv: readonly string[]): ParseResult {
  const json = argv.includes("--json");
  const rest = argv.filter((a) => a !== "--json");
  const [command, ...args] = rest;
  const bad = (message: string): ParseResult => ({ ok: false, command: command ?? "", json, message });
  const flags = args.filter((a) => a.startsWith("--"));
  const positional: string[] = [];
  let timeoutMs: number | null = null;
  // Options that take a value; each may appear once.
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--timeout") {
      const value = args[i + 1];
      if (value === undefined || !/^\d+$/.test(value)) return bad("--timeout precisa de um número de milissegundos");
      timeoutMs = Number(value);
      i++;
    } else if (a === "--rule" || a === "--base") {
      const value = args[i + 1];
      if (value === undefined || value === "" || value.startsWith("--")) return bad(`${a} precisa de um valor`);
      if (values.has(a)) return bad(`${a} aparece mais de uma vez`);
      values.set(a, value);
      i++;
    } else if (!a.startsWith("--")) {
      positional.push(a);
    }
  }
  const allowed = (names: string[]) => {
    const extra = flags.filter((f) => !names.includes(f));
    return extra.length === 0 ? null : bad(`opção desconhecida para ${command}: ${extra.join(", ")}`);
  };
  switch (command) {
    case "resume":
    case "collect": {
      const extra = allowed([]);
      if (extra !== null) return extra;
      if (positional.length !== 1) return bad(`${command} recebe exatamente um ID`);
      return { ok: true, parsed: { command, json, id: positional[0] ?? "" } };
    }
    case "status": {
      const extra = allowed(["--all"]);
      if (extra !== null) return extra;
      return { ok: true, parsed: { command, json, ids: positional, all: args.includes("--all") } };
    }
    case "wait": {
      const extra = allowed(["--timeout"]);
      if (extra !== null) return extra;
      if (positional.length === 0) return bad("wait recebe pelo menos um ID");
      return { ok: true, parsed: { command, json, ids: positional, timeoutMs } };
    }
    case "close": {
      const extra = allowed(["--discard-worktree"]);
      if (extra !== null) return extra;
      if (positional.length !== 1) return bad("close recebe exatamente um ID");
      return { ok: true, parsed: { command, json, id: positional[0] ?? "", discardWorktree: args.includes("--discard-worktree") } };
    }
    case "dispatch": {
      const extra = allowed(["--rule", "--base", "--human-approved"]);
      if (extra !== null) return extra;
      if (positional.length !== 1) return bad("dispatch recebe exatamente um ID de unidade");
      return { ok: true, parsed: { command, json, unitId: positional[0] ?? "", rule: values.get("--rule") ?? null, base: values.get("--base") ?? null, humanApproved: args.includes("--human-approved") } };
    }
    default:
      return bad(command === undefined ? "nenhum comando" : `comando desconhecido: ${command}`);
  }
}
