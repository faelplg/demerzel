#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" };
import { runCommand, type CliOutcome } from "./cli/run.ts";

export type Outcome = CliOutcome;

export async function main(argv: readonly string[], env: Record<string, string | undefined>, cwd: string): Promise<Outcome> {
  if (argv.length === 1 && argv[0] === "--version") {
    return { code: 0, stdout: `${pkg.version}\n`, stderr: "" };
  }
  return runCommand(argv, env, cwd);
}

if (import.meta.main) {
  const outcome = await main(Bun.argv.slice(2), { ...process.env }, process.cwd());
  process.stdout.write(outcome.stdout);
  process.stderr.write(outcome.stderr);
  process.exitCode = outcome.code;
}
