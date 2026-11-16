import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Env } from "./env.ts";
import { git } from "./git.ts";

// Spec 2.6: the project's preparation, run by the core in the worktree it
// created, before the session opens. Each command is an argv with no shell,
// in its own process group, with stdin from /dev/null and its output only in
// the registry log. A command is done when its leader exits and its group is
// empty. The limit counts all commands together.

export const PREPARE_LIMIT_MS = 10 * 60_000;
export const PREPARE_GRACE_MS = 5_000;

export type PrepareLimits = { limitMs: number; graceMs: number; settleMs: number };

export type CommandResult = {
  index: number;
  program: string;
  exit_code: number | null;
  signal: string | null;
  duration_ms: number;
  // How the command failed, or null when it succeeded.
  failure: string | null;
};

export type PrepareOutcome = { ok: true; results: CommandResult[] } | { ok: false; results: CommandResult[]; reason: string };

// How long a group is watched after its leader exits before what is left
// counts as left running: the last children of a command may still be on
// their way out when the leader's exit is seen.
export const PREPARE_SETTLE_MS = 200;
const POLL_MS = 20;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // The group is already gone.
  }
}

async function waitEmpty(pgid: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    if (!groupAlive(pgid)) return true;
    if (Date.now() >= until) return false;
    await sleep(POLL_MS);
  }
}

// SIGTERM to the whole group, then SIGKILL once the grace period is over.
async function stopGroup(pgid: number, graceMs: number): Promise<void> {
  signalGroup(pgid, "SIGTERM");
  if (await waitEmpty(pgid, graceMs)) return;
  signalGroup(pgid, "SIGKILL");
  await waitEmpty(pgid, 1_000);
}

type Ended = { kind: "exit"; code: number | null; signal: string | null } | { kind: "error"; code: string };

export async function runPreparation(options: {
  commands: string[][];
  worktree: string;
  env: Env;
  log: string;
  limits: PrepareLimits;
  // Called with each command's process group ID as soon as it exists, so
  // the caller records it before awaiting anything.
  onStart: (index: number, pgid: number) => void;
}): Promise<PrepareOutcome> {
  const { commands, worktree, limits } = options;
  const env = Object.fromEntries(Object.entries(options.env).filter((e): e is [string, string] => e[1] !== undefined));
  mkdirSync(dirname(options.log), { recursive: true });
  const fd = openSync(options.log, "a", 0o600);
  const deadline = Date.now() + limits.limitMs;
  const results: CommandResult[] = [];
  const fail = (result: CommandResult, how: string): PrepareOutcome => {
    result.failure = how;
    results.push(result);
    return { ok: false, results, reason: `preparation command ${result.index} (${result.program}) ${how}; log: ${options.log}` };
  };
  try {
    for (const [i, argv] of commands.entries()) {
      const index = i + 1;
      const declared = argv[0] ?? "";
      writeSync(fd, `[demerzel] command ${index} of ${commands.length}: ${JSON.stringify(argv)}\n`);
      // Spec 2.6: a program with a `/` is found relative to the worktree,
      // one without is found on PATH.
      const program = declared.includes("/") ? resolve(worktree, declared) : declared;
      const started = Date.now();
      const result: CommandResult = { index, program: declared, exit_code: null, signal: null, duration_ms: 0, failure: null };
      // Spec 2.6, step 5: no command runs once the limit has passed.
      if (Date.now() >= deadline) {
        return fail(result, `was not started: the time limit of ${Math.round(limits.limitMs / 1000)} s for the whole preparation had passed`);
      }
      let ended: Promise<Ended>;
      let pgid: number | undefined;
      try {
        const child = spawn(program, argv.slice(1), { cwd: worktree, env, stdio: ["ignore", fd, fd], detached: true });
        pgid = child.pid;
        ended = new Promise<Ended>((done) => {
          child.once("error", (error) => done({ kind: "error", code: (error as NodeJS.ErrnoException).code ?? error.message }));
          child.once("exit", (code, signal) => done({ kind: "exit", code, signal }));
        });
      } catch (error) {
        ended = Promise.resolve({ kind: "error", code: (error as NodeJS.ErrnoException).code ?? String(error) });
      }
      if (pgid !== undefined) options.onStart(index, pgid);

      // The timer is cleared as soon as the command ends, so a finished
      // preparation never keeps the process alive.
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timer = new Promise<"limit">((done) => {
        timeout = setTimeout(() => done("limit"), Math.max(0, deadline - Date.now()));
      });
      const first = await Promise.race([ended, timer]);
      clearTimeout(timeout);
      const passedLimit = async (): Promise<PrepareOutcome> => {
        if (pgid !== undefined) await stopGroup(pgid, limits.graceMs);
        const after = await Promise.race([ended, sleep(1_000).then(() => null)]);
        if (after !== null && after.kind === "exit") {
          result.exit_code = after.code;
          result.signal = after.signal;
        }
        result.duration_ms = Date.now() - started;
        return fail(result, `passed the time limit of ${Math.round(limits.limitMs / 1000)} s for the whole preparation`);
      };
      if (first === "limit") return passedLimit();
      result.duration_ms = Date.now() - started;
      if (first.kind === "error") return fail(result, `could not start (${first.code})`);
      result.exit_code = first.code;
      result.signal = first.signal;
      // The wait for an empty group counts toward the limit too: a group
      // still not empty when the limit comes is a command running past it,
      // so no later command starts after the limit.
      const left = Math.max(0, deadline - Date.now());
      if (pgid !== undefined && !(await waitEmpty(pgid, Math.min(limits.settleMs, left)))) {
        if (left < limits.settleMs) return passedLimit();
        await stopGroup(pgid, limits.graceMs);
        result.duration_ms = Date.now() - started;
        return fail(result, "left processes running");
      }
      if (first.signal !== null) return fail(result, `was ended by signal ${first.signal}`);
      if (first.code !== 0) return fail(result, `exited with ${first.code}`);
      results.push(result);
    }
    return { ok: true, results };
  } finally {
    closeSync(fd);
  }
}

// Spec 2.6, step 6: the preparation kept the task's identity. The branch
// still points to the base commit, and the worktree's HEAD is that branch at
// that commit. Untracked and ignored files are allowed. Null when it holds,
// else the invariants that broke, with the commits involved.
export function checkIdentity(check: { mainCheckout: string; worktree: string; branch: string; baseCommit: string; env: Env }): string | null {
  const { mainCheckout, worktree, branch, baseCommit, env } = check;
  const problems: string[] = [];
  const tip = git(mainCheckout, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], env);
  if (tip.code !== 0) problems.push(`the branch ${branch} moved off the base commit ${baseCommit}: it no longer exists`);
  else if (tip.stdout !== baseCommit) problems.push(`the branch ${branch} moved off the base commit ${baseCommit} to ${tip.stdout}`);
  const at = git(worktree, ["rev-parse", "--verify", "--quiet", "HEAD"], env);
  const where = at.code === 0 ? `at ${at.stdout}` : "with no commit";
  const head = git(worktree, ["symbolic-ref", "--quiet", "HEAD"], env);
  if (head.code !== 0) problems.push(`HEAD is detached ${where}, not on the branch ${branch} at the base commit ${baseCommit}`);
  else if (head.stdout !== `refs/heads/${branch}`) problems.push(`HEAD is on ${head.stdout} ${where}, not on the branch ${branch} at the base commit ${baseCommit}`);
  if (at.code !== 0) problems.push("HEAD has no commit");
  else if (at.stdout !== baseCommit) problems.push(`HEAD is at ${at.stdout}, off the base commit ${baseCommit}`);
  return problems.length === 0 ? null : problems.join("; ");
}
