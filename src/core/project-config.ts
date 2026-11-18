import type { Env } from "./env.ts";
import { readCommitFile } from "./git.ts";

// Spec 2.6: the project's own preparation, declared in `.demerzel.json` and
// read from the base commit, never from the working tree. Absent means the
// commit's root tree was read and has no such entry; any failure to read it
// is a refusal, so a preparation is never skipped because a read failed.

export const PROJECT_FILE = ".demerzel.json";

export type ProjectConfig = { present: boolean; commands: string[][] };
export type ProjectConfigResult = { ok: true; config: ProjectConfig } | { ok: false; message: string };

const KEYS = new Set(["schema", "prepare"]);

// The message names the file, the commit and the rule, never a value read
// from the file (Spec 2.6 and 6).
export function readProjectConfig(mainCheckout: string, commit: string, env: Env): ProjectConfigResult {
  const invalid = (rule: string): ProjectConfigResult => ({ ok: false, message: `${PROJECT_FILE} at commit ${commit}: ${rule}` });
  const file = readCommitFile(mainCheckout, commit, PROJECT_FILE, env);
  if (!file.ok) return invalid(file.message);
  if (file.text === null) return { ok: true, config: { present: false, commands: [] } };

  let data: unknown;
  try {
    data = JSON.parse(file.text);
  } catch {
    return invalid("the file is not JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return invalid("the file must hold a JSON object");
  const object = data as Record<string, unknown>;
  for (const key of Object.keys(object)) if (!KEYS.has(key)) return invalid("only the keys schema and prepare are allowed");
  if (object["schema"] !== 1) return invalid("schema must be exactly 1");
  const prepare = object["prepare"];
  if (prepare === undefined) return { ok: true, config: { present: true, commands: [] } };
  if (!Array.isArray(prepare)) return invalid("prepare must be a list of commands");
  const commands: string[][] = [];
  for (const [i, command] of prepare.entries()) {
    const at = `prepare[${i}]`;
    if (!Array.isArray(command) || command.length === 0) return invalid(`${at} must be a non-empty list of strings`);
    for (const [j, arg] of command.entries()) {
      if (typeof arg !== "string") return invalid(`${at}[${j}] must be a string`);
      if (arg === "") return invalid(`${at}[${j}] must not be empty`);
      if (arg.includes("\0")) return invalid(`${at}[${j}] must not hold a NUL`);
    }
    commands.push([...(command as string[])]);
  }
  return { ok: true, config: { present: true, commands } };
}
