import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../../src/core/git.ts";
import type { Sandbox } from "./sandbox.ts";

// Small preparation programs for the tests of Spec 2.6. The core suite runs
// with only git and bun on PATH, so every program is a bun script, git, or a
// script with a /bin/sh shebang that uses only shell builtins. None needs the
// network, and a slow one waits on a file the test controls.

const SCRIPTS: Record<string, string> = {
  // Records how it was run, in prepared/<name>.json under its cwd, and
  // writes one marker to stdout and one to stderr.
  "prep/record.ts": `
import { fstatSync, mkdirSync, statSync, writeFileSync } from "node:fs";
const [name = "record", ...rest] = process.argv.slice(2);
const stdin = fstatSync(0);
const devnull = statSync("/dev/null");
mkdirSync("prepared", { recursive: true });
writeFileSync(\`prepared/\${name}.json\`, JSON.stringify({ argv: rest, cwd: process.cwd(), stdinNull: stdin.isCharacterDevice() && stdin.rdev === devnull.rdev, mark: process.env["DZ_PREP_MARK"] ?? null }));
process.stdout.write(\`OUT-\${name}\\n\`);
process.stderr.write(\`ERR-\${name}\\n\`);
`,
  "prep/exit.ts": `
process.stdout.write("LOG-CONTENT-7f3a exit\\n");
process.exit(Number(process.argv[2] ?? "1"));
`,
  "prep/signal.ts": `
process.kill(process.pid, "SIGKILL");
`,
  "prep/sleep.ts": `
await Bun.sleep(Number(process.argv[2] ?? "0"));
`,
  // Waits until a file exists, then exits 0.
  "prep/wait.ts": `
import { existsSync, writeFileSync } from "node:fs";
const [file = "", pidfile] = process.argv.slice(2);
if (pidfile !== undefined) writeFileSync(pidfile, String(process.pid));
while (!existsSync(file)) await Bun.sleep(20);
`,
  // Starts a child in its own process group's tree that keeps running, and
  // exits 0, or stays alive with "stay". With "ignore", the child ignores
  // SIGTERM, so only SIGKILL ends it.
  "prep/leave-child.ts": `
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
const [pidfile = "", ignore = "", stay = ""] = process.argv.slice(2);
const child = spawn(process.execPath, ["prep/child.ts", pidfile, ignore], { stdio: "ignore" });
child.unref();
while (!existsSync(pidfile)) await Bun.sleep(10);
if (stay === "stay") setInterval(() => {}, 1000);
`,
  "prep/child.ts": `
import { writeFileSync } from "node:fs";
const [pidfile = "", ignore = ""] = process.argv.slice(2);
if (ignore === "ignore") process.on("SIGTERM", () => {});
writeFileSync(pidfile, String(process.pid));
setInterval(() => {}, 1000);
`,
};

// A program with a / in its name, found relative to the worktree. Only
// shell builtins, since PATH may hold only git and bun.
const SHELL = "#!/bin/sh\n: > relative-ran\n";

export type PrepareFixture = { base: string; commit: (config: unknown, extra?: Record<string, string>) => string };

// Commits the scripts and a `.demerzel.json` on a branch `prepbase`, which
// the main checkout never checks out, so a program found from the main
// checkout instead of the worktree would not exist. Returns the base ref and
// a way to commit another configuration on it.
export function prepareFixture(sb: Sandbox): PrepareFixture {
  const run = (...args: string[]) => {
    const r = git(sb.repo, args, sb.env);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  const scratch = join(sb.root, "fixture-wt");
  run("worktree", "add", "-q", "-b", "prepbase", scratch, "main");
  const at = (...args: string[]) => {
    const r = git(scratch, args, sb.env);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  for (const [file, body] of Object.entries(SCRIPTS)) {
    mkdirSync(join(scratch, "prep"), { recursive: true });
    writeFileSync(join(scratch, file), body.trimStart());
  }
  writeFileSync(join(scratch, "prep", "relative.sh"), SHELL);
  chmodSync(join(scratch, "prep", "relative.sh"), 0o755);
  writeFileSync(join(scratch, ".gitignore"), "ignored-deps/\n");
  at("add", "-A");
  at("commit", "-q", "-m", "preparation scripts");
  const commit = (config: unknown, extra: Record<string, string> = {}): string => {
    if (config === undefined) {
      if (existsSync(join(scratch, ".demerzel.json"))) at("rm", "-q", ".demerzel.json");
    } else {
      writeFileSync(join(scratch, ".demerzel.json"), typeof config === "string" ? config : JSON.stringify(config));
      at("add", ".demerzel.json");
    }
    for (const [file, body] of Object.entries(extra)) {
      mkdirSync(join(scratch, file, ".."), { recursive: true });
      writeFileSync(join(scratch, file), body);
      at("add", file);
    }
    at("commit", "-q", "--allow-empty", "-m", "configure preparation");
    return at("rev-parse", "HEAD");
  };
  return { base: "prepbase", commit };
}

export function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

// True while any process of the group, or the process, is alive.
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
