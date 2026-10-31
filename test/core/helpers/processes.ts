import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Outcome } from "../../../src/core/commands/common.ts";
import type { Sandbox } from "./sandbox.ts";

const CHILD = join(import.meta.dir, "child.ts");

export type Child = {
  name: string;
  proc: ReturnType<typeof Bun.spawn>;
  events: () => string[];
  until: (event: string, timeoutMs?: number) => Promise<void>;
  held: (timeoutMs?: number) => Promise<void>;
  go: () => void;
  result: () => Outcome | null;
};

// Polls for a file the child writes. The deadline is a real guard so a
// broken test fails instead of hanging.
async function poll(check: () => boolean, what: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`);
    await Bun.sleep(5);
  }
}

export function barrierDir(sb: Sandbox): string {
  const dir = join(sb.root, "barrier");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function spawnChild(sb: Sandbox, stateFile: string, options: { name: string; command: "dispatch" | "collect" | "close"; input: unknown; holdOn?: string; killOn?: string; lockTimeoutMs?: number }): Child {
  const barrier = barrierDir(sb);
  const args = { ...options, cwd: sb.repo, env: sb.env, stateFile, barrier };
  const proc = Bun.spawn([process.execPath, CHILD, JSON.stringify(args)], { stdout: "pipe", stderr: "pipe", env: { ...sb.env } as Record<string, string> });
  const eventsFile = join(barrier, `${options.name}.events`);
  const events = () => (existsSync(eventsFile) ? readFileSync(eventsFile, "utf8").split("\n").filter(Boolean) : []);
  return {
    name: options.name,
    proc,
    events,
    until: (event, timeoutMs = 15_000) => poll(() => events().includes(event), `${options.name} ${event}`, timeoutMs),
    held: (timeoutMs = 15_000) => poll(() => existsSync(join(barrier, `${options.name}.held`)), `${options.name} held`, timeoutMs),
    go: () => writeFileSync(join(barrier, `${options.name}.go`), ""),
    result: () => {
      const file = join(barrier, `${options.name}.result.json`);
      return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Outcome) : null;
    },
  };
}
