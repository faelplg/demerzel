// A core command in its own process, for the lock and interruption tests.
// It reports each trace event to <barrier>/<name>.events, can pause at one
// event until the parent creates <barrier>/<name>.go, and can kill itself
// with SIGKILL at another. The parent never relies on sleep for ordering.
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collect } from "../../../src/core/commands/collect.ts";
import { close } from "../../../src/core/commands/close.ts";
import { dispatch } from "../../../src/core/commands/dispatch.ts";
import { FakeBackend } from "../../../src/core/fake-backend.ts";
import type { Env } from "../../../src/core/env.ts";

type Args = {
  name: string;
  cwd: string;
  env: Env;
  stateFile: string;
  barrier: string;
  command: "dispatch" | "collect" | "close";
  input: unknown;
  holdOn?: string;
  killOn?: string;
  lockTimeoutMs?: number;
};

const args = JSON.parse(process.argv[2] ?? "{}") as Args;
const events = join(args.barrier, `${args.name}.events`);

function trace(event: string): void {
  appendFileSync(events, `${event}\n`);
  if (event === args.killOn) process.kill(process.pid, "SIGKILL");
  if (event === args.holdOn) {
    writeFileSync(join(args.barrier, `${args.name}.held`), "");
    const go = join(args.barrier, `${args.name}.go`);
    while (!existsSync(go)) Bun.sleepSync(5);
  }
}

const backend = new FakeBackend(args.env, { stateFile: args.stateFile });
const ctx = { cwd: args.cwd, env: args.env, backend, trace, lockIntervalMs: 5, ...(args.lockTimeoutMs !== undefined ? { lockTimeoutMs: args.lockTimeoutMs } : {}) };
const outcome =
  args.command === "dispatch"
    ? await dispatch({ task: args.input, humanApproved: false }, ctx)
    : args.command === "collect"
      ? await collect(args.input as string, ctx)
      : await close({ id: args.input as string, discardWorktree: false }, ctx);
appendFileSync(events, `exit:${outcome.code}\n`);
writeFileSync(join(args.barrier, `${args.name}.result.json`), JSON.stringify(outcome));
