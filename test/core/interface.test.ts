import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { close, dispatch } from "../../src/core/index.ts";
import { FakeBackend, type EffectPoint } from "../../src/core/fake-backend.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { backend, context, sandbox, task, type Sandbox } from "./helpers/sandbox.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

function record(): TaskRecord {
  return JSON.parse(readFileSync(join(resolveProject(sb.repo, sb.env)?.dir ?? "", "tasks", "TC-0099.1.json"), "utf8")) as TaskRecord;
}

describe("backend interface in both worktree modes (R11, R12)", () => {
  // Protects: preparation data is recorded in `recorded`, before the first
  // effect. Fails if the core records it later or drops it.
  test("claude-code: hook data recorded before launching", async () => {
    const be = backend(sb);
    let atRecorded: unknown = null;
    const ctx = context(sb, be, {
      trace: (event) => {
        if (event === "wrote:recorded") {
          atRecorded = record().preparation;
          expect(be.effectCalls()).toEqual([]);
        }
      },
    });
    await dispatch({ task: task({ harness: "claude-code" }), humanApproved: false }, ctx);
    expect(atRecorded).toEqual({ worktreeCreateHook: { branch: "radiant/TC-0099.1", path: record().worktree, base: record().base.commit } });
  });

  // Protects: the effort the backend omits is recorded with its reason.
  // Fails if the requested effort is reported as applied.
  test("omitted effort is recorded", async () => {
    const be = backend(sb, { effortAccepted: false });
    await dispatch({ task: task({ effort: "xhigh" }), humanApproved: false }, context(sb, be));
    expect(record().effort).toEqual({ requested: "xhigh", applied: null, omitted_reason: "o harness não aceita o esforço xhigh" });
  });

  // Protects: `created` lists exactly what exists after a failure at each
  // point, in each order. Fails if a resource is recorded late or not at all.
  const ORDER: Record<string, EffectPoint[]> = { codex: ["worktree", "workspace", "agent"], "claude-code": ["workspace", "worktree", "agent"] };
  for (const [harness, order] of Object.entries(ORDER)) {
    for (const [i, point] of order.entries()) {
      test(`${harness}: failure after ${point}`, async () => {
        const be = backend(sb, { failAfter: point });
        const d = await dispatch({ task: task({ harness }), humanApproved: false }, context(sb, be));
        expect(d.code).toBe(1);
        expect(d.envelope.tasks[0]?.lifecycle).toBe("launch-failed");
        const kinds = record().created.map((c) => c.kind).filter((k) => k !== "tab" && k !== "pane");
        expect(kinds).toEqual(order.slice(0, i + 1));
      });
    }
  }

  // Protects: a failed launch postcondition with partial resources ends in
  // launch-failed with every resource listed. Fails if it ends in launched.
  test("claude-code: postcondition failure", async () => {
    const be = backend(sb, { postcondition: "fail" });
    const d = await dispatch({ task: task({ harness: "claude-code" }), humanApproved: false }, context(sb, be));
    expect(d.code).toBe(1);
    expect(record().lifecycle).toBe("launch-failed");
    expect(record().history.at(-1)?.detail?.["reason"]).toContain("pós-condição");
    expect(record().created.map((c) => c.kind)).toEqual(["workspace", "tab", "pane", "worktree", "agent"]);
  });

  // Protects: request_sent for each send outcome (R16). Fails if a stalled
  // or timed out send is recorded as sent or not sent.
  test.each([
    ["sent", true, 0],
    ["not-ready", false, 1],
    ["unknown", "unknown", 1],
  ] as const)("send %s gives request_sent %p", async (send, want, code) => {
    const be = backend(sb, { send });
    const d = await dispatch({ task: task(), humanApproved: false }, context(sb, be));
    expect(d.code).toBe(code);
    expect(record().request_sent).toBe(want);
  });

  // Protects: the decision is recorded before the first effect and the
  // order of writes holds. Fails if launching is written after launch.
  test("write order: recorded, launching, resources, send-started, launched", async () => {
    const be = backend(sb);
    const events: string[] = [];
    const ctx = context(sb, be, {
      trace: (event) => {
        if (event.startsWith("wrote:")) events.push(`${event}@${be.effectCalls().length}`);
      },
    });
    await dispatch({ task: task(), humanApproved: false }, ctx);
    expect(events).toEqual([
      "wrote:recorded@0",
      "wrote:launching@0",
      "wrote:created:worktree@1",
      "wrote:created:workspace@1",
      "wrote:created:tab@1",
      "wrote:created:pane@1",
      "wrote:created:agent@1",
      "wrote:send-started@1",
      "wrote:launched@2",
    ]);
  });
});

describe("fake backend state across instances (R12)", () => {
  // Protects: the persisted fake keeps every effect, so the tests between
  // processes see what the effects did. Fails if an update is lost when the
  // state is reloaded.
  test("send and close are visible from another instance", async () => {
    const stateFile = join(sb.root, "fake.json");
    const be = new FakeBackend(sb.env, { stateFile });
    const d = await dispatch({ task: task(), humanApproved: false }, context(sb, be));
    const other = new FakeBackend(sb.env, { stateFile });
    expect(other.snapshotNow().agents.find((a) => a.name === d.envelope.tasks[0]?.agent_name)?.status).toBe("working");
    other.setAgentStatus(d.envelope.tasks[0]?.agent_name ?? "", "idle");
    expect((await close({ id: "TC-0099.1", discardWorktree: false }, context(sb, be))).code).toBe(0);
    const third = new FakeBackend(sb.env, { stateFile });
    expect(third.snapshotNow().workspaces).toEqual([]);
    expect(third.snapshotNow().agents).toEqual([]);
  });
});
