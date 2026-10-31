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
