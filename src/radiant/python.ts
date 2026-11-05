import type { Env } from "../core/env.ts";

// The single place that runs python3, by the owner's amendment to TC-0003:
// only the Radiant validators, read-only, with the arguments as a list and
// never through a shell (contract, section 9). PYTHONDONTWRITEBYTECODE keeps
// Python from writing bytecode into the Radiant checkout (Spec 3, item 2).

export type PythonRun =
  | { kind: "exited"; code: number; stdout: string; stderr: string }
  | { kind: "signaled"; signal: string }
  | { kind: "missing"; detail: string };

export function runPython(script: string, args: readonly string[], options: { env: Env; cwd: string; stdin?: string }): PythonRun {
  let proc;
  try {
    proc = Bun.spawnSync(["python3", script, ...args], {
      cwd: options.cwd,
      env: { ...options.env, PYTHONDONTWRITEBYTECODE: "1" },
      stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return { kind: "missing", detail: error instanceof Error ? error.message : String(error) };
  }
  if (proc.exitCode === null) return { kind: "signaled", signal: proc.signalCode ?? "desconhecido" };
  return { kind: "exited", code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}
