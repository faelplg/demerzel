import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dispatch, status } from "../../src/core/index.ts";
import { FakeBackend } from "../../src/core/fake-backend.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { spawnChild } from "./helpers/processes.ts";
import { context, sandbox, task, type Sandbox } from "./helpers/sandbox.ts";

let sb: Sandbox;
let stateFile: string;
beforeEach(() => {
  sb = sandbox();
  stateFile = join(sb.root, "fake-backend.json");
  new FakeBackend(sb.env, { stateFile });
});
afterEach(() => sb.cleanup());

function record(id: string): TaskRecord {
  return JSON.parse(readFileSync(join(resolveProject(sb.repo, sb.env)?.dir ?? "", "tasks", `${id}.json`), "utf8")) as TaskRecord;
}

type Expectation = { lifecycle: TaskRecord["lifecycle"]; created: string[]; requestSent: TaskRecord["request_sent"] };

const CASES: Record<string, Array<[string, Expectation]>> = {
  codex: [
    ["wrote:recorded", { lifecycle: "launch-failed", created: [], requestSent: false }],
    ["wrote:launching", { lifecycle: "launch-failed", created: [], requestSent: false }],
    ["wrote:created:worktree", { lifecycle: "launch-failed", created: ["worktree"], requestSent: false }],
    ["wrote:created:workspace", { lifecycle: "launch-failed", created: ["worktree", "workspace"], requestSent: false }],
    ["wrote:created:agent", { lifecycle: "launched", created: ["worktree", "workspace", "agent"], requestSent: false }],
    ["wrote:send-started", { lifecycle: "launched", created: ["worktree", "workspace", "agent"], requestSent: "unknown" }],
  ],
  "claude-code": [
    ["wrote:created:workspace", { lifecycle: "launch-failed", created: ["workspace"], requestSent: false }],
    ["wrote:created:worktree", { lifecycle: "launch-failed", created: ["worktree", "workspace"], requestSent: false }],
    ["wrote:created:agent", { lifecycle: "launched", created: ["worktree", "workspace", "agent"], requestSent: false }],
  ],
};

describe("interrupted dispatch and its recovery (R6, R7)", () => {
  for (const [harness, cases] of Object.entries(CASES)) {
    for (const [point, want] of cases) {
      // Protects: a dispatch killed at this point leaves a registry the next
      // lock holder recovers without relaunching or resending. Fails if a
      // write lands after its effect, or recovery guesses wrong.
      test(`${harness}: killed after ${point}`, async () => {
        const child = spawnChild(sb, stateFile, { name: "k", command: "dispatch", input: task({ harness }), killOn: point });
        await child.proc.exited;
        expect(child.proc.signalCode).toBe("SIGKILL");
        expect(record("TC-0099.1").lifecycle).not.toBe("launched");

        const be = new FakeBackend(sb.env, { stateFile });
        const ctx = context(sb, be);
        const before = await status({ ids: ["TC-0099.1"], all: false }, ctx);
        expect(before.code).toBe(1);
        expect(before.envelope.tasks[0]?.interrupted).toBe(true);

        const effectsBefore = be.effectCalls().length;
        const next = await dispatch({ task: task({ id: "TC-0099.2", writes: ["other/"] }), humanApproved: false }, ctx);
        expect(next.code).toBe(0);

        const recovered = record("TC-0099.1");
        expect(recovered.lifecycle).toBe(want.lifecycle);
        expect(recovered.created.map((c): string => c.kind).sort()).toEqual([...want.created].sort());
        expect(recovered.request_sent).toBe(want.requestSent);
        expect(recovered.history.at(-1)?.detail?.["reason"]).toBe("interrupted");
        const newEffects = be.effectCalls().slice(effectsBefore);
        expect(newEffects.filter((c) => c.args["task"] === "TC-0099.1" || c.args["agent"] === recovered.agent_name)).toEqual([]);
      });
    }
  }
});
