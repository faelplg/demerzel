import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { close, collect, dispatch, status, wait } from "../../src/core/index.ts";
import { FakeBackend } from "../../src/core/fake-backend.ts";
import { git } from "../../src/core/git.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { backend, context, sandbox, task, writeReport, type Sandbox } from "./helpers/sandbox.ts";

// Findings of the third independent verification of TC-0001.

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

function record(id = "TC-0099.1"): TaskRecord {
  return JSON.parse(readFileSync(join(resolveProject(sb.repo, sb.env)?.dir ?? "", "tasks", `${id}.json`), "utf8")) as TaskRecord;
}

describe("the return stays inside the worktree (R1, R17)", () => {
  // Protects: Spec 2.1 and 6. A committed symlink that leads the return path
  // out of the worktree never makes collect read the file outside. Fails if
  // the containment is only lexical.
  test("a symlink out of the worktree is not a return", async () => {
    const outside = join(sb.root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "report.md"), "CONTEUDO-EXTERNO-7d1c\n");
    symlinkSync(outside, join(sb.repo, "reports"));
    git(sb.repo, ["add", "reports"], sb.env);
    git(sb.repo, ["commit", "-qm", "symlink para fora"], sb.env);
    const be = backend(sb);
    const ctx = context(sb, be);
    const pointers = [{ label: "private", path: join(outside, "report.md") }];
    const d = await dispatch({ task: task({ returnPath: "reports/report.md", request: { role: "radiant-dev", pointers } }), humanApproved: false }, ctx);
    expect(d.code).toBe(0);
    expect((await wait({ ids: ["TC-0099.1"], timeoutMs: 0 }, ctx)).envelope.tasks[0]?.report).toBe("absent");
    const c = await collect("TC-0099.1", ctx);
    expect(c.code).toBe(1);
    expect(JSON.stringify(c)).not.toContain("CONTEUDO-EXTERNO-7d1c");
  });

  // Protects: a symlink that stays inside the worktree is still a return.
  // Fails if the containment check refuses every symlink.
  test("a symlink inside the worktree is a return", async () => {
    const be = backend(sb);
    const ctx = context(sb, be);
    const d = await dispatch({ task: task({ returnPath: "out/report.md" }), humanApproved: false }, ctx);
    const worktree = d.envelope.tasks[0]?.worktree ?? "";
    writeReport(worktree, "real/report.md", "dentro\n");
    symlinkSync(join(worktree, "real"), join(worktree, "out"));
    expect((await collect("TC-0099.1", ctx)).envelope.tasks[0]?.collected?.content).toBe("dentro\n");
  });
});

describe("wait observes every task on every cycle (R14)", () => {
  // Protects: a task that stopped early is observed again, so the result
  // is never an old observation. Fails if wait freezes stopped tasks.
  test("an early idle task whose report appears later", async () => {
    const be = backend(sb);
    const ctx = context(sb, be);
    const a = (await dispatch({ task: task({ id: "A", writes: ["a/"], returnPath: "out.md" }), humanApproved: false }, ctx)).envelope.tasks[0];
    const b = (await dispatch({ task: task({ id: "B", writes: ["b/"], returnPath: "out.md" }), humanApproved: false }, ctx)).envelope.tasks[0];
    be.setAgentStatus(a?.agent_name ?? "", "idle");
    let cycles = 0;
    const w = await wait({ ids: ["A", "B"], timeoutMs: null }, {
      ...ctx,
      sleep: async () => {
        cycles++;
        writeReport(a?.worktree ?? "", "out.md");
        writeReport(b?.worktree ?? "", "out.md");
      },
    });
    expect(cycles).toBe(1);
    expect(w.code).toBe(0);
    expect(w.envelope.tasks.map((t) => t.report)).toEqual(["present", "present"]);
  });

  // Protects: a repeated ID counts once. Fails if a duplicate keeps wait
  // from ever settling.
  test("a repeated ID", async () => {
    const be = backend(sb);
    const ctx = context(sb, be);
    const t = (await dispatch({ task: task(), humanApproved: false }, ctx)).envelope.tasks[0];
    writeReport(t?.worktree ?? "", ".radiant/reports/TC-0099.1.md");
    let cycles = 0;
    const w = await wait({ ids: ["TC-0099.1", "TC-0099.1"], timeoutMs: null }, { ...ctx, sleep: async () => { cycles++; } });
    expect(w.code).toBe(0);
    expect(cycles).toBe(0);
    expect(w.envelope.tasks).toHaveLength(1);
  });
});

describe("status reads record and snapshot from the same moment (R15)", () => {
  // Protects: when the re-read finds that a dispatch moved on, the agent is
  // classified on a new snapshot. Fails if status pairs a launched record
  // with a snapshot taken before the agent existed.
  test("a dispatch finishing while status reads the snapshot", async () => {
    const be = backend(sb);
    const ctx = context(sb, be);
    let release = () => {};
    let reached = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { reached = resolve; });
    const launch = be.launch.bind(be);
    be.launch = async (...args) => {
      reached();
      await gate;
      return launch(...args);
    };
    const running = dispatch({ task: task(), humanApproved: false }, ctx);
    await started;
    const snapshot = be.snapshot.bind(be);
    let first = true;
    be.snapshot = async () => {
      const taken = await snapshot();
      if (first) {
        first = false;
        release();
        await running;
      }
      return taken;
    };
    const s = await status({ ids: ["TC-0099.1"], all: false }, ctx);
    expect(s.envelope.tasks[0]?.lifecycle).toBe("launched");
    expect(s.envelope.tasks[0]?.agent).toBe("working");
    expect(s.code).toBe(0);
  });
});

describe("persisted fake backend (R12)", () => {
  // Protects: reads never write the state file, so a read in one process
  // cannot erase an effect of another. Fails if probe or snapshot saves.
  test("status leaves the state file untouched", async () => {
    const stateFile = join(sb.root, "fake.json");
    const be = new FakeBackend(sb.env, { stateFile });
    const ctx = context(sb, be);
    await dispatch({ task: task(), humanApproved: false }, ctx);
    const bytes = readFileSync(stateFile, "utf8");
    const mtime = statSync(stateFile).mtimeMs;
    const reader = new FakeBackend(sb.env, { stateFile });
    await status({ ids: [], all: true }, context(sb, reader));
    await wait({ ids: ["TC-0099.1"], timeoutMs: 0 }, context(sb, reader));
    expect(readFileSync(stateFile, "utf8")).toBe(bytes);
    expect(statSync(stateFile).mtimeMs).toBe(mtime);
    expect(reader.calls.filter((c) => c.op === "probe").length).toBeGreaterThan(0);
  });
});

describe("an interrupted discard keeps the human decision (R17)", () => {
  // Protects: the --discard-worktree decision is written before git removes
  // the worktree, and a repeated discard finishes an interrupted one. Fails
  // if the flag is only written after the effect.
  test("killed right after git worktree remove", async () => {
    const stateFile = join(sb.root, "fake.json");
    const be = new FakeBackend(sb.env, { stateFile, script: { statusAfterSend: "idle" } });
    const t = (await dispatch({ task: task(), humanApproved: false }, context(sb, be))).envelope.tasks[0];
    const shim = join(sb.root, "shim");
    mkdirSync(shim);
    const realGit = Bun.which("git") ?? "git";
    writeFileSync(
      join(shim, "git"),
      `#!${process.execPath}\nconst args = process.argv.slice(2);\nconst r = Bun.spawnSync([${JSON.stringify(realGit)}, ...args], { env: process.env, stdout: "inherit", stderr: "inherit" });\nif (args[0] === "worktree" && args[1] === "remove" && r.exitCode === 0) process.kill(process.ppid, "SIGKILL");\nprocess.exit(r.exitCode ?? 1);\n`,
      { mode: 0o755 },
    );
    const env = { ...sb.env, PATH: `${shim}:${sb.env["PATH"] ?? ""}` };
    const source = `
      import { FakeBackend } from ${JSON.stringify(join(import.meta.dir, "../../src/core/fake-backend.ts"))};
      import { close } from ${JSON.stringify(join(import.meta.dir, "../../src/core/index.ts"))};
      const env = ${JSON.stringify(env)};
      await close({ id: "TC-0099.1", discardWorktree: true }, { cwd: ${JSON.stringify(sb.repo)}, env, backend: new FakeBackend(env, { stateFile: ${JSON.stringify(stateFile)} }) });
    `;
    const child = Bun.spawn([process.execPath, "--eval", source], { env: env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
    await child.exited;
    expect(child.signalCode).toBe("SIGKILL");
    expect(existsSync(t?.worktree ?? "")).toBe(false);
    expect(record().flags.discard_worktree).toBe(true);
    expect(record().worktree_removed).toBe(false);

    const again = await close({ id: "TC-0099.1", discardWorktree: true }, context(sb, new FakeBackend(sb.env, { stateFile })));
    expect(again.code).toBe(0);
    expect(record().worktree_removed).toBe(true);
  });
});
