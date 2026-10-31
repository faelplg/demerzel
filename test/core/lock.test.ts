import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dispatch, status, wait } from "../../src/core/index.ts";
import { FakeBackend } from "../../src/core/fake-backend.ts";
import { ProjectLock } from "../../src/core/lock.ts";
import { resolveProject } from "../../src/core/project.ts";
import { spawnChild } from "./helpers/processes.ts";
import { context, sandbox, task, writeReport, type Sandbox } from "./helpers/sandbox.ts";

let sb: Sandbox;
let stateFile: string;
beforeEach(() => {
  sb = sandbox();
  stateFile = join(sb.root, "fake-backend.json");
  new FakeBackend(sb.env, { stateFile });
});
afterEach(() => sb.cleanup());

function lockPath(): string {
  const dir = resolveProject(sb.repo, sb.env)?.dir ?? "";
  mkdirSync(dir, { recursive: true });
  return join(dir, "lock");
}

describe("project lock across processes (R5)", () => {
  // Protects: two dispatches never run their critical sections together.
  // Fails if the second acquires the lock before the first releases it.
  test("two dispatches are serialized", async () => {
    const a = spawnChild(sb, stateFile, { name: "a", command: "dispatch", input: task({ id: "TC-0099.1", writes: ["a/"] }), holdOn: "lock-acquired" });
    await a.held();
    const b = spawnChild(sb, stateFile, { name: "b", command: "dispatch", input: task({ id: "TC-0099.2", writes: ["b/"] }) });
    await b.until("lock-waiting");
    expect(b.events()).not.toContain("lock-acquired");
    a.go();
    await a.proc.exited;
    await b.proc.exited;
    expect(a.result()?.code).toBe(0);
    expect(b.result()?.code).toBe(0);
    const bEvents = b.events();
    expect(bEvents.indexOf("lock-waiting")).toBeLessThan(bEvents.indexOf("lock-acquired"));
  });

  // Protects: collect and close both write, so neither loses the other's
  // update. Fails if collect is allowed to write outside the lock.
  test("collect against close loses no update", async () => {
    const be = new FakeBackend(sb.env, { stateFile, script: { statusAfterSend: "idle" } });
    const ctx = context(sb, be);
    const d = await dispatch({ task: task(), humanApproved: false }, ctx);
    writeReport(d.envelope.tasks[0]?.worktree ?? "", ".radiant/reports/TC-0099.1.md");

    const c = spawnChild(sb, stateFile, { name: "c", command: "collect", input: "TC-0099.1", holdOn: "lock-acquired" });
    await c.held();
    const x = spawnChild(sb, stateFile, { name: "x", command: "close", input: "TC-0099.1" });
    await x.until("lock-waiting");
    c.go();
    await c.proc.exited;
    await x.proc.exited;
    expect(c.result()?.code).toBe(0);
    expect(x.result()?.code).toBe(0);
    const recorded = JSON.parse(readFileSync(join(resolveProject(sb.repo, sb.env)?.dir ?? "", "tasks", "TC-0099.1.json"), "utf8"));
    expect(recorded.lifecycle).toBe("closed");
    expect(recorded.collected?.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(recorded.history.map((h: { event: string }) => h.event).slice(-2)).toEqual(["collected", "closed"]);
  });

  // Protects: the kernel releases the lock of a killed owner, so there is
  // no stale lock. Fails if a lock outlives its process.
  test("a lock held by a killed process is free right after", async () => {
    const a = spawnChild(sb, stateFile, { name: "a", command: "dispatch", input: task(), holdOn: "lock-acquired" });
    await a.held();
    expect(ProjectLock.tryAcquire(lockPath())).toBeNull();
    a.proc.kill("SIGKILL");
    await a.proc.exited;
    const free = ProjectLock.tryAcquire(lockPath());
    expect(free).not.toBeNull();
    free?.release();
  });

  // Protects: project-locked after the timeout, measured on the injected
  // clock, with a real deadline guarding the test. Fails if the command waits
  // forever or gives up before the timeout.
  test("project-locked after the timeout on a controlled clock", async () => {
    const holder = ProjectLock.tryAcquire(lockPath());
    let fake = 0;
    const be = new FakeBackend(sb.env, { stateFile });
    const ctx = context(sb, be, { now: () => fake, sleep: async (ms) => { fake += ms; }, lockTimeoutMs: 30_000, lockIntervalMs: 1000 });
    const started = Date.now();
    const outcome = await dispatch({ task: task(), humanApproved: false }, ctx);
    holder?.release();
    expect(outcome.envelope.refusal?.code).toBe("project-locked");
    expect(fake).toBeGreaterThanOrEqual(30_000);
    expect(fake).toBeLessThan(32_000);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  // Protects: status and wait only read and never wait for the lock. Fails
  // if either blocks while another process holds it.
  test("status and wait do not wait for the lock", async () => {
    const be = new FakeBackend(sb.env, { stateFile });
    const ctx = context(sb, be);
    const d = await dispatch({ task: task(), humanApproved: false }, ctx);
    writeReport(d.envelope.tasks[0]?.worktree ?? "", ".radiant/reports/TC-0099.1.md");
    const holder = ProjectLock.tryAcquire(lockPath());
    expect(holder).not.toBeNull();
    try {
      const started = Date.now();
      expect((await status({ ids: [], all: false }, ctx)).code).toBe(0);
      expect((await wait({ ids: ["TC-0099.1"], timeoutMs: 1000 }, ctx)).code).toBe(0);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      holder?.release();
    }
  });
});
