import type { Env } from "../core/env.ts";
import { BackendError } from "../core/backend.ts";

// The single place where the Demerzel calls the herdr executable. Arguments
// go as a list, never through a shell, and every call carries --session when
// one is configured (Spec 2.4).

export type HerdrReply =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; code: string; message: string };

export class Herdr {
  constructor(
    private env: Env,
    private session: string | null,
  ) {}

  args(args: readonly string[]): string[] {
    return this.session === null ? [...args] : ["--session", this.session, ...args];
  }

  // Runs one herdr command and reads its JSON answer. A herdr error answer
  // comes back as a value; a missing executable, an answer that is not JSON
  // or one without `result` or `error` is a BackendError.
  run(args: readonly string[]): HerdrReply {
    const command = `herdr ${args.slice(0, 2).join(" ")}`;
    let proc;
    try {
      proc = Bun.spawnSync(["herdr", ...this.args(args)], { env: { ...this.env }, stdout: "pipe", stderr: "pipe" });
    } catch (error) {
      throw new BackendError(command, `herdr não pôde ser executado: ${error instanceof Error ? error.message : String(error)}`);
    }
    // herdr 0.9.0 answers on stdout on success and on stderr on error.
    const stdout = proc.stdout.toString().trim();
    const stderr = proc.stderr.toString().trim();
    const body = stdout !== "" ? stdout : stderr;
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      throw new BackendError(command, `resposta que não é JSON (saída ${proc.exitCode ?? "?"}): ${body.slice(0, 300)}`);
    }
    if (typeof data === "object" && data !== null) {
      const answer = data as Record<string, unknown>;
      const error = answer["error"];
      if (typeof error === "object" && error !== null) {
        const e = error as Record<string, unknown>;
        return { ok: false, code: String(e["code"] ?? "unknown"), message: String(e["message"] ?? "") };
      }
      const result = answer["result"];
      if (typeof result === "object" && result !== null) return { ok: true, result: result as Record<string, unknown> };
    }
    throw new BackendError(command, "resposta JSON sem `result` nem `error`");
  }
}

export function field(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function text(value: unknown, ...path: string[]): string | null {
  const v = field(value, ...path);
  return typeof v === "string" ? v : null;
}
