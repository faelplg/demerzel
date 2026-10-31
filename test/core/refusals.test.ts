import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collect, close, dispatch, resume, status, type Outcome } from "../../src/core/index.ts";
import type { FakeBackend } from "../../src/core/fake-backend.ts";
import { git } from "../../src/core/git.ts";
import { ProjectLock } from "../../src/core/lock.ts";
import { agentName, resolveProject } from "../../src/core/project.ts";
import { backend, context, sandbox, task, type Sandbox } from "./helpers/sandbox.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

function projectDir(): string {
  const project = resolveProject(sb.repo, sb.env);
  if (project === null) throw new Error("no project");
  return project.dir;
}

// Runs `act`, then proves Spec 5: exit 2, the code in the JSON, and no
// effect: task files equal byte for byte, Git refs and worktrees equal, and
// no effect call on the backend.
async function expectRefusal(be: FakeBackend, code: string, act: () => Promise<Outcome>): Promise<void> {
  const tasks = sb.tasksSnapshot();
  const gitState = sb.gitState();
  const effects = be.effectCalls().length;
  const outcome = await act();
  expect(outcome.code).toBe(2);
  expect(outcome.envelope.ok).toBe(false);
  expect(outcome.envelope.refusal?.code).toBe(code);
  expect(outcome.envelope.refusal?.message.length).toBeGreaterThan(0);
  expect(outcome.envelope.refusal?.next.length).toBeGreaterThan(0);
  expect(sb.tasksSnapshot()).toEqual(tasks);
  expect(sb.gitState()).toBe(gitState);
  expect(be.effectCalls().length).toBe(effects);
}

describe("verification 3, core part: every core refusal is without effect", () => {
  // Protects: each code of R13. Fails if a refusal writes a task file,
  // creates a branch or worktree, or calls a backend effect.
  test("not-a-project", async () => {
    const be = backend(sb);
    const outside = join(sb.root, "outside");
    mkdirSync(outside);
    await expectRefusal(be, "not-a-project", () => dispatch({ task: task(), humanApproved: false }, context(sb, be, { cwd: outside })));
  });

  test("config-invalid", async () => {
    const be = backend(sb);
    mkdirSync(join(sb.configHome, "demerzel"), { recursive: true });
    writeFileSync(join(sb.configHome, "demerzel", "config.json"), JSON.stringify({ schema: 1, trusted_repositories: [] }));
    await expectRefusal(be, "config-invalid", () => dispatch({ task: task(), humanApproved: false }, context(sb, be)));
  });

  for (const [why, overrides] of [
    ["ID fora do formato", { id: "-bad" }],
    ["harness sem suporte", { harness: "copilot" }],
    ["base que não resolve", { base: "nao-existe" }],
    ["pointer fora do commit base", { request: { role: "radiant-dev", pointers: [{ label: "contract", path: "docs/nao-existe.md" }] } }],
    ["branch inválido", { branch: "radiant/..bad" }],
    ["writes com ..", { writes: ["src/../x"] }],
  ] as const) {
    test(`task-invalid: ${why}`, async () => {
      const be = backend(sb);
      await expectRefusal(be, "task-invalid", () => dispatch({ task: task(overrides), humanApproved: false }, context(sb, be)));
    });
  }

  test("task-exists, even for a closed task", async () => {
    const be = backend(sb);
    const ctx = context(sb, be);
    await dispatch({ task: task(), humanApproved: false }, ctx);
    be.setAgentStatus(agentName(resolveProject(sb.repo, sb.env)?.key ?? "", "TC-0099.1"), "idle");
    await close({ id: "TC-0099.1", discardWorktree: false }, ctx);
    await expectRefusal(be, "task-exists", () => dispatch({ task: task({ branch: "radiant/other" }), humanApproved: false }, ctx));
  });

  test("dependency-pending", async () => {
    const be = backend(sb);
    await expectRefusal(be, "dependency-pending", () => dispatch({ task: task({ dependsOn: ["TC-0099.0"] }), humanApproved: false }, context(sb, be)));
  });

  test("writes-overlap", async () => {
    const be = backend(sb);
    const ctx = context(sb, be);
    await dispatch({ task: task({ id: "TC-0099.1", writes: ["src/a/"] }), humanApproved: false }, ctx);
    await expectRefusal(be, "writes-overlap", () => dispatch({ task: task({ id: "TC-0099.2", writes: ["src/"] }), humanApproved: false }, ctx));
  });

  test("backend-unavailable", async () => {
    const be = backend(sb, { running: false });
    await expectRefusal(be, "backend-unavailable", () => dispatch({ task: task(), humanApproved: false }, context(sb, be)));
  });

  test("backend-version", async () => {
    const be = backend(sb, { versionOk: false });
    await expectRefusal(be, "backend-version", () => dispatch({ task: task(), humanApproved: false }, context(sb, be)));
  });

  test("branch-exists", async () => {
    const be = backend(sb);
    git(sb.repo, ["branch", "radiant/TC-0099.1"], sb.env);
    await expectRefusal(be, "branch-exists", () => dispatch({ task: task(), humanApproved: false }, context(sb, be)));
  });

  test("worktree-exists", async () => {
    const be = backend(sb);
    mkdirSync(join(projectDir(), "worktrees", "TC-0099.1"), { recursive: true });
    await expectRefusal(be, "worktree-exists", () => dispatch({ task: task(), humanApproved: false }, context(sb, be)));
  });

  test("agent-name-taken", async () => {
    const be = backend(sb);
    be.addAgent(agentName(resolveProject(sb.repo, sb.env)?.key ?? "", "TC-0099.1"));
    await expectRefusal(be, "agent-name-taken", () => dispatch({ task: task(), humanApproved: false }, context(sb, be)));
  });

  test("project-locked", async () => {
    const be = backend(sb);
    mkdirSync(projectDir(), { recursive: true });
    const holder = ProjectLock.tryAcquire(join(projectDir(), "lock"));
    expect(holder).not.toBeNull();
    try {
      await expectRefusal(be, "project-locked", () => dispatch({ task: task(), humanApproved: false }, context(sb, be, { lockTimeoutMs: 50 })));
    } finally {
      holder?.release();
    }
  });

  // Protects: an ID outside the format never becomes a path. Fails if
  // `../outside` reads a JSON file outside tasks/ instead of task-not-found.
  test("task-not-found for an ID that would leave tasks/", async () => {
    const be = backend(sb);
    mkdirSync(projectDir(), { recursive: true });
    writeFileSync(join(projectDir(), "outside.json"), "{não é JSON");
    await expectRefusal(be, "task-not-found", () => status({ ids: ["../outside"], all: false }, context(sb, be)));
    await expectRefusal(be, "task-not-found", () => resume("../outside", context(sb, be)));
  });

  test("task-not-found", async () => {
    const be = backend(sb);
    await expectRefusal(be, "task-not-found", () => resume("TC-0099.9", context(sb, be)));
  });

  test("wrong-lifecycle: collect on a closed task", async () => {
    const be = backend(sb, { statusAfterSend: "idle" });
    const ctx = context(sb, be);
    await dispatch({ task: task(), humanApproved: false }, ctx);
    await close({ id: "TC-0099.1", discardWorktree: false }, ctx);
    await expectRefusal(be, "wrong-lifecycle", () => collect("TC-0099.1", ctx));
  });

  test("request-already-sent", async () => {
    const be = backend(sb);
    const ctx = context(sb, be);
    await dispatch({ task: task(), humanApproved: false }, ctx);
    await expectRefusal(be, "request-already-sent", () => resume("TC-0099.1", ctx));
  });

  test("task-lost", async () => {
    const be = backend(sb, { startup: "blocked" });
    const ctx = context(sb, be);
    const d = await dispatch({ task: task(), humanApproved: false }, ctx);
    be.dropAgent(d.envelope.tasks[0]?.agent_name ?? "");
    await expectRefusal(be, "task-lost", () => resume("TC-0099.1", ctx));
  });

  test("task-working", async () => {
    const be = backend(sb);
    const ctx = context(sb, be);
    await dispatch({ task: task(), humanApproved: false }, ctx);
    await expectRefusal(be, "task-working", () => close({ id: "TC-0099.1", discardWorktree: true }, ctx));
  });
});
