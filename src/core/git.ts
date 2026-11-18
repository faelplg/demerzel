import type { Env } from "./env.ts";

export type GitResult = { code: number; stdout: string; stderr: string };

// The only executable the core runs. Output is trimmed of the final newline.
export function git(cwd: string, args: readonly string[], env: Env): GitResult {
  const proc = Bun.spawnSync(["git", ...args], { cwd, env: { ...env }, stdout: "pipe", stderr: "pipe" });
  return {
    code: proc.exitCode ?? 1,
    stdout: proc.stdout.toString().replace(/\n$/, ""),
    stderr: proc.stderr.toString().trim(),
  };
}

export function gitOk(cwd: string, args: readonly string[], env: Env): boolean {
  return git(cwd, args, env).code === 0;
}

export type CommitFile = { ok: true; text: string | null } | { ok: false; message: string };

// Read only regular files from a commit. A missing entry differs from an
// unreadable tree or blob; neither symlinks nor directories become content.
export function readCommitFile(cwd: string, commit: string, path: string, env: Env): CommitFile {
  const invalid = (message: string): CommitFile => ({ ok: false, message });
  const tree = git(cwd, ["ls-tree", "-z", "--full-tree", commit, "--", `:(literal)${path}`], env);
  if (tree.code !== 0) return invalid(`could not read the commit's tree (git ls-tree exited with ${tree.code})`);
  const entries = tree.stdout.split("\0").filter(Boolean);
  if (entries.length === 0) return { ok: true, text: null };
  const match = /^(\d{6}) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(entries[0] ?? "");
  if (entries.length !== 1 || match === null || match[4] !== path) return invalid("the tree entry could not be read");
  const [, mode, type, oid] = match;
  if (type !== "blob" || (mode !== "100644" && mode !== "100755")) return invalid(`the entry is not a regular file (mode ${mode}, type ${type})`);
  const blob = git(cwd, ["cat-file", "blob", oid ?? ""], env);
  if (blob.code !== 0) return invalid(`could not read the file's blob (git cat-file exited with ${blob.code})`);
  return { ok: true, text: blob.stdout };
}
