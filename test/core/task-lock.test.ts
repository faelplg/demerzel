import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { close, collect, dispatch, resume, status } from "../../src/core/index.ts";
import { FakeBackend } from "../../src/core/fake-backend.ts";
import { ProjectLock } from "../../src/core/lock.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { alive, prepareFixture, type PrepareFixture } from "./helpers/prepare-fixture.ts";
import { spawnChild, type Child } from "./helpers/processes.ts";
import { context, sandbox, task, writeReport, type Sandbox } from "./helpers/sandbox.ts";

// TC-0004, Spec 2.3, revision 0.15: the task lock, between processes. Each
// slow preparation waits on a file the test creates, never on a sleep, and
// every child and leftover preparation is stopped after the test.

let sb: Sandbox;
let fx: PrepareFixture;
let stateFile: string;
let go: string;
let pidfile: string;
let children: Child[];
beforeEach(() => {
  sb = sandbox();
  fx = prepareFixture(sb);
  stateFile = join(sb.root, "fake-backend.json");
  new FakeBackend(sb.env, { stateFile });
  go = join(sb.root, "go");
  pidfile = join(sb.root, "prep.pid");
  children = [];
});
afterEach(async () => {
  writeFileSync(go, "");
  for (const child of children) {
    child.go();
    child.proc.kill("SIGKILL");
    await child.proc.exited;
  }
  if (existsSync(pidfile)) {
    const pid = Number(readFileSync(pidfile, "utf8"));
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  sb.cleanup();
});

const dir = (): string => resolveProject(sb.repo, sb.env)?.dir ?? "";
const record = (id = "TC-0099.1"): TaskRecord => JSON.parse(readFileSync(join(dir(), "tasks", `${id}.json`), "utf8")) as TaskRecord;
const taskLockPath = (id = "TC-0099.1"): string => join(dir(), "locks", `${id}.lock`);
const be = (): FakeBackend => new FakeBackend(sb.env, { stateFile });
const ctx = (extra = {}) => context(sb, be(), extra);
const other = () => task({ id: "TC-0099.2", writes: ["src/other/"] });

function slow(extra: string[][] = []): string {
  return fx.commit({ schema: 1, prepare: [["bun", "prep/wait.ts", go, pidfile], ...extra] });
}

// A dispatch of TC-0099.1 in its own process, inside its preparation.
async function preparing(options: { lockTimeoutMs?: number; extra?: string[][]; killOn?: string } = {}): Promise<Child> {
  const base = slow(options.extra);
  const child = spawnChild(sb, stateFile, { name: "a", command: "dispatch", input: task({ base }), ...(options.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: options.lockTimeoutMs }), ...(options.killOn === undefined ? {} : { killOn: options.killOn }) });
  children.push(child);
  await child.until("wrote:prepare-command:1");
  return child;
}

async function finished(child: Child): Promise<NonNullable<ReturnType<Child["result"]>>> {
  await child.proc.exited;
  const result = child.result();
  if (result === null) throw new Error(`${child.name} left no result: ${child.events().join(", ")}`);
  return result;
}

describe("the task lock of dispatch (L1, L2, L3)", () => {
  // Protects: L1, the task lock is taken before `recorded` and held to the
  // last record, launch-failed included. Fails if dispatch writes its task
  // without it or lets it go early.
  test("held from recorded to the last record", async () => {
    const base = fx.commit({ schema: 1, prepare: [["bun", "prep/exit.ts", "3"]] });
    const child = spawnChild(sb, stateFile, { name: "h", command: "dispatch", input: task({ base }), holdOn: "wrote:recorded" });
    children.push(child);
    await child.held();
    expect(ProjectLock.probe(taskLockPath(), () => "free")).toBe("held");
    child.go();
    await finished(child);
    expect(record().lifecycle).toBe("launch-failed");

    const last = spawnChild(sb, stateFile, { name: "l", command: "dispatch", input: task({ id: "TC-0099.3", base, writes: ["src/three/"] }), holdOn: "wrote:launch-failed" });
    children.push(last);
    await last.held();
    expect(ProjectLock.probe(taskLockPath("TC-0099.3"), () => "free")).toBe("held");
    last.go();
    expect((await finished(last)).code).toBe(1);
    expect(ProjectLock.probe(taskLockPath("TC-0099.3"), () => "free")).toBe("free");
  });

  // Protects: L2 and EB-08, the project lock is free while the preparation
  // runs: an independent dispatch in another process completes while the
  // first is still preparing. Fails if the preparation runs under the
  // project lock.
  test("an independent dispatch completes during a preparation", async () => {
    const a = await preparing();
    const free = ProjectLock.tryAcquire(join(dir(), "lock"));
    expect(free).not.toBeNull();
    free?.release();
    const b = await dispatch({ task: other(), humanApproved: false }, ctx());
    expect(b.code).toBe(0);
    expect(a.events().some((e) => e.startsWith("exit:"))).toBe(false);
    expect(record().lifecycle).toBe("launching");
    writeFileSync(go, "");
    expect((await finished(a)).code).toBe(0);
    expect(record().lifecycle).toBe("launched");
    expect(record().project_preparation?.outcome).toBe("succeeded");
  });

  // Protects: L3 and L0, when the project lock cannot be taken back after
  // the preparation, the task goes to launch-failed under its task lock
  // alone, and dispatch exits 1 with no session. Fails if it waits forever,
  // records nothing, or opens the session without the project lock.
  test("the project lock cannot be taken back", async () => {
    const a = await preparing({ lockTimeoutMs: 300 });
    const blocker = ProjectLock.tryAcquire(join(dir(), "lock"));
    expect(blocker).not.toBeNull();
    try {
      writeFileSync(go, "");
      const result = await finished(a);
      expect(result.code).toBe(1);
      const r = record();
      expect(r.lifecycle).toBe("launch-failed");
      expect(String(r.history.at(-1)?.detail?.["reason"])).toBe("could not take the project lock back within 0.3 s after the preparation");
      expect(r.created.map((c) => c.kind)).toEqual(["worktree"]);
      expect(be().effectCalls().filter((c) => c.args["task"] === "TC-0099.1")).toEqual([]);
    } finally {
      blocker?.release();
    }
  });
});

describe("recovery under task locks (L4, L5)", () => {
  // Protects: L4, a recovery leaves a task whose lock is held, and its
  // file, untouched, so a live dispatch is never recovered. Fails if
  // recovery ignores the task lock.
  test("a live dispatch in its preparation is not recovered", async () => {
    const a = await preparing();
    const before = readFileSync(join(dir(), "tasks", "TC-0099.1.json"), "utf8");
    expect((await dispatch({ task: other(), humanApproved: false }, ctx())).code).toBe(0);
    expect(readFileSync(join(dir(), "tasks", "TC-0099.1.json"), "utf8")).toBe(before);
    writeFileSync(go, "");
    expect((await finished(a)).code).toBe(0);
    expect(record().lifecycle).toBe("launched");
    expect(record().history.some((h) => h.detail?.["reason"] === "interrupted")).toBe(false);
  });

  // Protects: L4 with a barrier, a recovery that listed the task as
  // `launching` before its dispatch recorded launch-failed (L3) reads it
  // again after taking its lock and does not overwrite that record. Fails
  // if recovery publishes the copy it read before taking the lock.
  test("a recovery that read the task before its last record", async () => {
    const a = await preparing({ lockTimeoutMs: 300 });
    const c = spawnChild(sb, stateFile, { name: "c", command: "dispatch", input: other(), holdOn: "recovery:listed" });
    children.push(c);
    await c.held();
    // c holds the project lock and has read TC-0099.1 as launching.
    writeFileSync(go, "");
    expect((await finished(a)).code).toBe(1);
    expect(record().lifecycle).toBe("launch-failed");
    c.go();
    expect((await finished(c)).code).toBe(0);
    const r = record();
    expect(r.lifecycle).toBe("launch-failed");
    expect(String(r.history.at(-1)?.detail?.["reason"])).toContain("could not take the project lock back");
    expect(r.history.some((h) => h.detail?.["reason"] === "interrupted")).toBe(false);
  });

  // Protects: L5, a dispatch killed during a command leaves `launching`
  // with prepare_started_at and the process group; a refused resume and a
  // refused dispatch publish no recovery; an independent dispatch takes it
  // to launch-failed with the worktree in `created` and the group named.
  // Fails if a refusal writes, or the recovery forgets the group.
  test("a dispatch killed during its preparation", async () => {
    const a = await preparing({ killOn: "wrote:prepare-command:1" });
    await a.proc.exited;
    expect(a.proc.signalCode).toBe("SIGKILL");
    const r = record();
    expect(r.lifecycle).toBe("launching");
    expect(r.project_preparation?.prepare_started_at).not.toBeNull();
    const group = r.project_preparation?.process_group ?? -1;
    while (!existsSync(pidfile)) await Bun.sleep(10);
    expect(group).toBe(Number(readFileSync(pidfile, "utf8")));
    // The command of the killed dispatch is still running.
    expect(alive(group)).toBe(true);

    const before = sb.tasksSnapshot();
    const refusedResume = await resume("TC-0099.1", ctx());
    expect(refusedResume.code).toBe(2);
    expect(refusedResume.envelope.refusal?.code).toBe("wrong-lifecycle");
    const refusedDispatch = await dispatch({ task: task({ id: "TC-0099.3", writes: ["src/TC-0099.1/x"] }), humanApproved: false }, ctx());
    expect(refusedDispatch.envelope.refusal?.code).toBe("writes-overlap");
    expect(sb.tasksSnapshot()).toEqual(before);

    expect((await dispatch({ task: other(), humanApproved: false }, ctx())).code).toBe(0);
    const recovered = record();
    expect(recovered.lifecycle).toBe("launch-failed");
    expect(recovered.created.map((c) => c.kind)).toEqual(["worktree"]);
    const detail = recovered.history.at(-1)?.detail ?? {};
    expect(detail["reason"]).toBe("interrupted");
    expect(detail["process_group"]).toBe(group);
    expect(String(detail["preparation"])).toContain(`process group ${group}`);
  });
});

describe("status under task locks (L6)", () => {
  // Protects: L6, a task whose dispatch is preparing is not interrupted,
  // though the project lock is free; status writes nothing and creates no
  // lock file. Fails if status decides by the project lock.
  test("a task in its preparation is not interrupted", async () => {
    await preparing();
    const before = sb.tasksSnapshot();
    const locks = readdirSync(join(dir(), "locks")).sort();
    const s = await status({ ids: [], all: false }, ctx());
    expect(s.envelope.tasks[0]).toMatchObject({ id: "TC-0099.1", lifecycle: "launching", interrupted: false });
    expect(s.code).toBe(0);
    expect(sb.tasksSnapshot()).toEqual(before);
    expect(readdirSync(join(dir(), "locks")).sort()).toEqual(locks);
  });

  // Protects: L6, an interrupted task is shown as such, also when its lock
  // file is missing, and status never creates one. Fails if status creates
  // or stamps a lock file, or misses the interruption.
  test("an interrupted task, with and without its lock file", async () => {
    const a = await preparing({ killOn: "wrote:prepare-command:1" });
    await a.proc.exited;
    const before = sb.tasksSnapshot();
    const stamp = readFileSync(taskLockPath(), "utf8");
    const s = await status({ ids: ["TC-0099.1"], all: false }, ctx());
    expect(s.envelope.tasks[0]?.interrupted).toBe(true);
    expect(s.code).toBe(1);
    expect(readFileSync(taskLockPath(), "utf8")).toBe(stamp);
    rmSync(taskLockPath());
    const again = await status({ ids: ["TC-0099.1"], all: false }, ctx());
    expect(again.envelope.tasks[0]?.interrupted).toBe(true);
    expect(existsSync(taskLockPath())).toBe(false);
    expect(sb.tasksSnapshot()).toEqual(before);
  });

  // Protects: L6 with a barrier, a task read as `launching` whose dispatch
  // records launch-failed and releases its lock before status probes it is
  // shown as launch-failed, not interrupted. Fails if status trusts its
  // first read once the lock is free.
  test("a dispatch that finishes between the read and the probe", async () => {
    const a = await preparing({ extra: [["bun", "prep/exit.ts", "3"]] });
    const s = await status({ ids: [], all: false }, ctx({
      trace: (event: string) => {
        if (event !== "status:read") return;
        writeFileSync(go, "");
        const deadline = Date.now() + 15_000;
        while (!a.events().some((e) => e.startsWith("exit:"))) {
          if (Date.now() > deadline) throw new Error("dispatch did not finish");
          Bun.sleepSync(10);
        }
      },
    }));
    expect(s.envelope.tasks[0]).toMatchObject({ id: "TC-0099.1", lifecycle: "launch-failed", interrupted: false });
  });
});

describe("task-busy (L7, L8)", () => {
  // Protects: L7, resume, collect and close of a task whose lock another
  // process holds are task-busy, exit 2, with no effect, and none waits on
  // the task lock while holding the project lock: the preparing dispatch
  // takes the project lock back right after. Fails if any of them waits,
  // acts, or blocks the dispatch.
  test("against a dispatch in its preparation", async () => {
    const a = await preparing({ lockTimeoutMs: 2_000 });
    const before = sb.tasksSnapshot();
    const effects = be().effectCalls().length;
    for (const [name, run] of [
      ["resume", () => resume("TC-0099.1", ctx())],
      ["collect", () => collect("TC-0099.1", ctx())],
      ["close", () => close({ id: "TC-0099.1", discardWorktree: true }, ctx())],
    ] as const) {
      const started = Date.now();
      const out = await run();
      expect(out.code, name).toBe(2);
      expect(out.envelope.refusal?.code, name).toBe("task-busy");
      expect(Date.now() - started, name).toBeLessThan(1_500);
    }
    expect(sb.tasksSnapshot()).toEqual(before);
    expect(be().effectCalls()).toHaveLength(effects);
    writeFileSync(go, "");
    expect((await finished(a)).code).toBe(0);
  });

  // Protects: L8, a task file is written only by the holder of its task
  // lock: with the lock held elsewhere, collect and close of a launched
  // task write nothing. Fails if either writes without the lock.
  test("collect and close of a launched task whose lock is held", async () => {
    const d = await dispatch({ task: task(), humanApproved: false }, ctx());
    expect(d.code).toBe(0);
    writeReport(d.envelope.tasks[0]?.worktree ?? "", ".radiant/reports/TC-0099.1.md");
    const holder = ProjectLock.tryAcquire(taskLockPath());
    expect(holder).not.toBeNull();
    const before = sb.tasksSnapshot();
    try {
      expect((await collect("TC-0099.1", ctx())).envelope.refusal?.code).toBe("task-busy");
      expect((await close({ id: "TC-0099.1", discardWorktree: false }, ctx())).envelope.refusal?.code).toBe("task-busy");
      expect(sb.tasksSnapshot()).toEqual(before);
    } finally {
      holder?.release();
    }
    expect((await collect("TC-0099.1", ctx())).code).toBe(0);
  });
});
