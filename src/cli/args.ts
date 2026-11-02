// Spec 4: the commands that take an ID, with --json everywhere. `dispatch`
// enters the CLI in increment 5.

export type Parsed =
  | { command: "resume" | "collect"; json: boolean; id: string }
  | { command: "status"; json: boolean; ids: string[]; all: boolean }
  | { command: "wait"; json: boolean; ids: string[]; timeoutMs: number | null }
  | { command: "close"; json: boolean; id: string; discardWorktree: boolean };

export type ParseResult = { ok: true; parsed: Parsed } | { ok: false; command: string; json: boolean; message: string };

export const USAGE = [
  "demerzel --version",
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
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--timeout") {
      const value = args[i + 1];
      if (value === undefined || !/^\d+$/.test(value)) return bad("--timeout precisa de um número de milissegundos");
      timeoutMs = Number(value);
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
    case "dispatch":
      return bad("dispatch entra no CLI no incremento 5 do Plan");
    default:
      return bad(command === undefined ? "nenhum comando" : `comando desconhecido: ${command}`);
  }
}
