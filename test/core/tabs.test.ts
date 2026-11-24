import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { close, dispatch, resume, status, wait } from "../../src/core/index.ts";
import { FakeBackend } from "../../src/core/fake-backend.ts";
import { resolveProject } from "../../src/core/project.ts";
import { Registry } from "../../src/core/registry.ts";
import { tabLabel } from "../../src/core/tab.ts";
import { context, sandbox, task, type Sandbox } from "./helpers/sandbox.ts";

let sb: Sandbox;
let be: FakeBackend;
beforeEach(() => { sb = sandbox(); be = new FakeBackend(sb.env); });
afterEach(() => sb.cleanup());
const registry = () => new Registry(resolveProject(sb.repo, sb.env)!.dir);
const record = (id = "TC-0099.1") => registry().read(id)!;
const ctx = () => context(sb, be);
async function interrupted() {
  be.script({ failAfter: "worktree" });
  await dispatch({ task: task(), humanApproved: false }, ctx());
  const r = record();
  r.lifecycle = "launching";
  registry().write(r);
  be.script({ failAfter: null });
  return r;
}
const effects = () => be.effectCalls().length;
const capture = () => ({ tasks: sb.tasksSnapshot(), git: sb.gitState(), effects: effects() });

describe("project workspace tabs: refusals before effects and scoped ownership", () => {
  // Guards R1-R4: every mismatch must leave interrupted recovery unpublished.
  for (const label of ["missing", "Project", " project", "project ", "project-extra"]) {
    test(`exact lookup refuses ${JSON.stringify(label)} before recording or recovery`, async () => {
      await interrupted();
      be.snapshotNow().workspaces[0]!.label = label;
      const before = capture();
      const d = await dispatch({ task: task({ id: "NEXT" }), humanApproved: false }, ctx());
      expect(d.code).toBe(2);
      expect(d.envelope.refusal?.code).toBe("project-workspace-missing");
      expect(d.envelope.refusal?.message).toContain(sb.repo);
      expect(d.envelope.refusal?.message).toContain("directory");
      expect(capture()).toEqual(before);
    });
  }
  test("ambiguous project labels refuse with all IDs and no effects", async () => {
    await interrupted();
    const extra = be.addWorkspace("project");
    const before = capture();
    const d = await dispatch({ task: task({ id: "NEXT" }), humanApproved: false }, ctx());
    expect(d.envelope.refusal?.code).toBe("project-workspace-ambiguous");
    expect(d.envelope.refusal?.message).toContain(extra);
    expect(d.envelope.refusal?.message).toContain("w1");
    expect(capture()).toEqual(before);
  });

  // F1-F4 through recovery and close, including a foreign agent beside our own.
  for (const foreign of [null, "dz-ffffffffffffffff", "human", "beside-own"] as const) {
    for (const command of ["recovery", "close"] as const) {
      test(`${command}: ${foreign ?? "empty pre-start"} candidate ownership`, async () => {
        const r = await interrupted();
        const tab = be.addTab(tabLabel(r));
        const state = be.snapshotNow();
        const pane = state.tabs.find((t) => t.id === tab)!.pane!;
        if (foreign !== null) state.agents.push({ name: foreign === "beside-own" ? "human" : foreign, status: "idle", tab, pane });
        if (foreign === "beside-own") state.agents.push({ name: r.agent_name, status: "idle", tab, pane });
        const before = capture();
        if (command === "close") {
          const c = await close({ id: r.id, discardWorktree: false }, ctx());
          if (foreign !== null) {
            expect(c.code).toBe(2);
            expect(c.envelope.refusal?.code).toBe("tab-not-owned");
            expect(c.envelope.refusal?.message).toContain(tab);
            expect(capture()).toEqual(before);
          } else {
            expect(c.code).toBe(0);
            expect(record().history.slice(-2).map((h) => [h.event, h.detail])).toEqual([
              ["tab-found", { tab, by: "label" }],
              ["closed", { tab_closed: tab, last_tab_in_workspace: false }],
            ]);
            expect(record().backend_ids.pane).toBe(pane);
            expect(record().created).toEqual([...r.created, { kind: "tab", id: tab }, { kind: "pane", id: pane }]);
            expect(state.tabs.some((t) => t.id === "w1:t0")).toBe(true);
          }
        } else {
          const d = await dispatch({ task: task({ id: "NEXT" }), humanApproved: false }, ctx());
          expect(d.code).toBe(0);
          const recovered = record();
          if (foreign !== null) {
            expect(recovered.backend_ids.tab).toBeNull();
            expect(recovered.backend_ids.pane).toBeNull();
            expect(recovered.created.some((c) => c.kind === "tab")).toBe(false);
            expect(recovered.history.at(-1)?.detail?.["tab_not_owned"]).toEqual({ tab, agents: state.agents.filter((a) => a.tab === tab).map((a) => a.name).sort() });
          } else {
            expect(recovered.backend_ids.tab).toBe(tab);
            expect(recovered.backend_ids.pane).toBe(pane);
          }
        }
      });
    }
  }
  for (const realCandidate of [false, true]) {
    for (const command of ["recovery", "close"] as const) {
      test(`${command}: same label outside project ignored, real candidate ${realCandidate}`, async () => {
        const r = await interrupted();
        const other = be.addWorkspace("other");
        const decoy = be.addTab(tabLabel(r), other);
        const real = realCandidate ? be.addTab(tabLabel(r)) : null;
        await be.snapshot();
        if (command === "close") {
          expect((await close({ id: r.id, discardWorktree: false }, ctx())).code).toBe(0);
          expect(record().history.at(-1)?.detail).toEqual({ tab_closed: real, last_tab_in_workspace: false });
        } else {
          expect((await dispatch({ task: task({ id: "NEXT" }), humanApproved: false }, ctx())).code).toBe(0);
          expect(record().backend_ids.tab).toBe(real);
        }
        expect(be.snapshotNow().tabs.some((t) => t.id === decoy)).toBe(true);
        expect(record().created.some((c) => c.kind === "tab" && c.id === decoy)).toBe(false);
      });
    }
  }
  test("duplicate task labels in recorded workspace refuse every snapshot without recovery", async () => {
    const r = await interrupted();
    be.addTab(tabLabel(r)); be.addTab(tabLabel(r));
    const before = capture();
    const c = await close({ id: r.id, discardWorktree: false }, ctx());
    expect(c.envelope.refusal?.code).toBe("backend-unavailable");
    expect(capture()).toEqual(before);
  });
  for (const recorded of [false, true]) {
    test(`legacy task has recorded tab ${recorded}: never uses label fallback`, async () => {
      be.script({ statusAfterSend: "idle" });
      await dispatch({ task: task(), humanApproved: false }, ctx());
      const r = record();
      const ownTab = r.backend_ids.tab!;
      delete r.project_workspace;
      if (!recorded) r.backend_ids.tab = null;
      r.lifecycle = "launching";
      registry().write(r);
      expect((await close({ id: r.id, discardWorktree: false }, ctx())).code).toBe(0);
      expect(record().history.at(-1)?.detail?.["tab_closed"]).toBe(recorded ? ownTab : null);
      expect(be.snapshotNow().tabs.some((t) => t.id === ownTab)).toBe(!recorded);
    });
  }
  test("last-tab close records removal and next dispatch refuses missing", async () => {
    be.script({ statusAfterSend: "idle" });
    await dispatch({ task: task(), humanApproved: false }, ctx());
    await be.closeTab("w1:t0");
    expect((await close({ id: record().id, discardWorktree: false }, ctx())).code).toBe(0);
    expect(record().history.at(-1)?.detail).toEqual({ tab_closed: "w1:t1", last_tab_in_workspace: true });
    expect((await dispatch({ task: task({ id: "NEXT" }), humanApproved: false }, ctx())).envelope.refusal?.code).toBe("project-workspace-missing");
  });
  test("two units observe, wait, resume and close independently beside a human", async () => {
    be.script({ startup: "blocked" });
    await dispatch({ task: task(), humanApproved: false }, ctx());
    await dispatch({ task: task({ id: "NEXT" }), humanApproved: false }, ctx());
    const first = record(), second = record("NEXT");
    be.setAgentStatus(first.agent_name, "idle");
    expect((await resume(first.id, ctx())).code).toBe(0);
    expect((await status({ ids: [first.id, second.id], all: false }, ctx())).envelope.tasks.map((t) => t.agent)).toEqual(["working", "blocked"]);
    expect((await wait({ ids: [second.id], timeoutMs: 5 }, ctx())).envelope.tasks[0]?.agent).toBe("blocked");
    be.setAgentStatus(first.agent_name, "idle");
    expect((await close({ id: first.id, discardWorktree: false }, ctx())).code).toBe(0);
    expect((await status({ ids: [second.id], all: false }, ctx())).envelope.tasks[0]?.agent).toBe("blocked");
    expect(be.snapshotNow().tabs.map((t) => t.id)).toEqual(["w1:t0", second.backend_ids.tab!]);
    expect(existsSync(first.worktree)).toBe(true);
    const raw = JSON.parse(readFileSync(join(registry().dir, "tasks", `${first.id}.json`), "utf8"));
    expect(raw.project_workspace).toEqual({ id: "w1", label: "project", source: "directory" });
    expect(raw.created.map((c: { kind: string }) => c.kind)).toEqual(["worktree", "tab", "pane", "agent"]);
  });
});

test("fake snapshot selects per-tab agent pane and refuses split Demerzel agents", async () => {
  const tab = be.addTab("human");
  const state = be.snapshotNow();
  state.agents.push({ name: "human", status: "idle", tab, pane: "human-pane" });
  expect((await be.snapshot()).tabs.find((t) => t.id === tab)?.pane).toBe("human-pane");
  state.agents.push({ name: "dz-1111111111111111", status: "idle", tab, pane: "unit-pane" });
  expect((await be.snapshot()).tabs.find((t) => t.id === tab)?.pane).toBe("unit-pane");
  state.agents.push({ name: "dz-2222222222222222", status: "idle", tab, pane: "other-unit-pane" });
  await expect(be.snapshot()).rejects.toThrow("multiple Demerzel panes in one tab");
});

test("close of an already failed task leaves pane and created unchanged", async () => {
  be.script({ failAfter: "worktree" });
  await dispatch({ task: task(), humanApproved: false }, ctx());
  const r = record();
  const tab = be.addTab(tabLabel(r));
  expect((await close({ id: r.id, discardWorktree: false }, ctx())).code).toBe(0);
  expect(record().backend_ids.tab).toBe(tab);
  expect(record().backend_ids.pane).toBeNull();
  expect(record().created).toEqual(r.created);
});
