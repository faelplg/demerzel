import { collect, close, resume, status, wait, type Envelope } from "../core/index.ts";
import { loadConfig } from "../core/config.ts";
import type { Env } from "../core/env.ts";
import { HerdrBackend } from "../herdr/backend.ts";
import { parseHerdrConfig } from "../herdr/config.ts";
import { parse, USAGE } from "./args.ts";
import { formatText } from "./text.ts";

export type CliOutcome = { code: 0 | 1 | 2; stdout: string; stderr: string };

function refusalEnvelope(command: string, code: string, message: string, next: string): Envelope {
  return { ok: false, command, tasks: [], refusal: { code, message, next, hold: false } };
}

function render(code: 0 | 1 | 2, envelope: Envelope, json: boolean): CliOutcome {
  if (json) return { code, stdout: `${JSON.stringify(envelope)}\n`, stderr: "" };
  return { code, ...formatText(envelope) };
}

// The five commands that take an ID, over the core and the herdr backend.
export async function runCommand(argv: readonly string[], env: Env, cwd: string): Promise<CliOutcome> {
  const parsed = parse(argv);
  if (!parsed.ok) {
    const envelope = refusalEnvelope(parsed.command, "usage-invalid", parsed.message, `Uso:\n${USAGE}`);
    return render(2, envelope, parsed.json);
  }
  const p = parsed.parsed;
  const config = loadConfig(env);
  if (!config.ok) return render(2, refusalEnvelope(p.command, "config-invalid", config.message, "Corrija a configuração do Demerzel e rode de novo."), p.json);
  const herdr = parseHerdrConfig(config.config.herdr);
  if (!herdr.ok) return render(2, refusalEnvelope(p.command, "config-invalid", herdr.message, "Corrija o bloco herdr da configuração e rode de novo."), p.json);
  const ctx = { cwd, env, backend: new HerdrBackend(env, herdr.config) };

  let outcome;
  switch (p.command) {
    case "resume":
      outcome = await resume(p.id, ctx);
      break;
    case "collect":
      outcome = await collect(p.id, ctx);
      break;
    case "status":
      outcome = await status({ ids: p.ids, all: p.all }, ctx);
      break;
    case "wait":
      outcome = await wait({ ids: p.ids, timeoutMs: p.timeoutMs }, ctx);
      break;
    case "close":
      outcome = await close({ id: p.id, discardWorktree: p.discardWorktree }, ctx);
      break;
  }
  return render(outcome.code, outcome.envelope, p.json);
}
