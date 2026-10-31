#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" };

export type Outcome = { code: 0 | 1 | 2; stdout: string; stderr: string };

const usage =
  "Nesta versão só existe `demerzel --version`; os comandos de despacho entram nos próximos incrementos do Plan.";

export function main(argv: readonly string[]): Outcome {
  if (argv.length === 1 && argv[0] === "--version") {
    return { code: 0, stdout: `${pkg.version}\n`, stderr: "" };
  }
  const given = argv.length === 0 ? "nenhum argumento" : `\`${argv.join(" ")}\``;
  return { code: 2, stdout: "", stderr: `demerzel: ${given} não é suportado. ${usage}\n` };
}

if (import.meta.main) {
  const outcome = main(Bun.argv.slice(2));
  process.stdout.write(outcome.stdout);
  process.stderr.write(outcome.stderr);
  process.exitCode = outcome.code;
}
