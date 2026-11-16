import type { Env } from "./env.ts";
import { git } from "./git.ts";

// Spec 2.6: the project's own preparation, declared in `.demerzel.json` and
// read from the base commit, never from the working tree. Absent means the
// commit's root tree was read and has no such entry; any failure to read it
// is a refusal, so a preparation is never skipped because a read failed.

export const PROJECT_FILE = ".demerzel.json";

export type ProjectConfig = { present: boolean; commands: string[][] };
export type ProjectConfigResult = { ok: true; config: ProjectConfig } | { ok: false; message: string };

const REGULAR = new Set(["100644", "100755"]);
const KEYS = new Set(["schema", "prepare"]);

// The message names the file, the commit and the rule, never a value read
// from the file (Spec 2.6 and 6).
export function readProjectConfig(mainCheckout: string, commit: string, env: Env): ProjectConfigResult {
  const invalid = (rule: string): ProjectConfigResult => ({ ok: false, message: `${PROJECT_FILE} at commit ${commit}: ${rule}` });
  const tree = git(mainCheckout, ["ls-tree", "-z", "--full-tree", commit, "--", PROJECT_FILE], env);
  if (tree.code !== 0) return invalid(`could not read the commit's tree (git ls-tree exited with ${tree.code})`);
  const entries = tree.stdout.split("\0").filter((line) => line !== "");
  if (entries.length === 0) return { ok: true, config: { present: false, commands: [] } };
  const match = /^(\d{6}) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(entries[0] ?? "");
  if (entries.length !== 1 || match === null || match[4] !== PROJECT_FILE) return invalid("the tree entry could not be read");
  const [, mode, type, oid] = match;
  if (type !== "blob" || !REGULAR.has(mode ?? "")) return invalid(`the entry is not a regular file (mode ${mode}, type ${type})`);
  const blob = git(mainCheckout, ["cat-file", "blob", oid ?? ""], env);
  if (blob.code !== 0) return invalid(`could not read the file's blob (git cat-file exited with ${blob.code})`);

  let data: unknown;
  try {
    data = JSON.parse(blob.stdout);
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
