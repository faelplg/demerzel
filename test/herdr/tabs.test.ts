import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, realpathSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { close, dispatch, resume, status, wait } from "../../src/core/index.ts";
import { HerdrBackend } from "../../src/herdr/backend.ts";
import { parseHerdrConfig } from "../../src/herdr/config.ts";
import { Registry } from "../../src/core/registry.ts";
import { resolveProject } from "../../src/core/project.ts";
import { tabLabel } from "../../src/core/tab.ts";
import { sandbox, task, type Sandbox } from "../core/helpers/sandbox.ts";
import { installFakeHerdr, type FakeHerdr, type FakeHerdrState } from "./helpers/fake.ts";
let sb: Sandbox, fake: FakeHerdr, be: HerdrBackend;
beforeEach(() => { sb = sandbox(); fake = installFakeHerdr(sb.root, sb.env); be = new HerdrBackend(fake.env, { session: "dz-test" }); });
afterEach(() => sb.cleanup());
const ctx = () => ({ cwd: sb.repo, env: fake.env, backend: be, waitIntervalMs: 2 });
const registry = () => new Registry(resolveProject(sb.repo, sb.env)!.dir);
const record = () => registry().read("TC-0099.1")!;
function edit(fn: (state: FakeHerdrState) => void) {
  const path = fake.env["FAKE_HERDR_STATE"]!;
  const state = JSON.parse(readFileSync(path, "utf8"));
  fn(state); writeFileSync(path, JSON.stringify(state));
}
const effects = () => fake.calls().filter((c) => ["create", "close", "start", "prompt"].includes(c[3] ?? ""));
const capture = () => ({ tasks: sb.tasksSnapshot(), git: sb.gitState(), effects: effects() });
async function unrecorded() {
  fake.script({ createAnswer: "garbage-after", snapshot: "fail-once-with-workspace" });
  const d = await dispatch({ task: task(), humanApproved: false }, ctx());
  expect(d.code).toBe(1);
  expect(record().backend_ids).toEqual({ workspace: "w1", tab: null, pane: null });
  return record();
}

describe("workspace config and pure lookup (C1-C3, R1-R6)", () => {
  // Reject controls in keys without echoing the value or injecting a line.
  for (const key of ["relative", "/", "/a/", "/a//b", "/a/./b", "/a/../b", "/a\nb", "/a\u007fb", "/a\u0000b"]) {
    test(`invalid mapping key ${JSON.stringify(key)} is safely diagnosed`, () => {
      const parsed = parseHerdrConfig({ workspace_labels: { [key]: "PRIVATE-LABEL" } });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.message).toContain("herdr.workspace_labels");
        expect(parsed.message).toContain(JSON.stringify(key));
        expect(parsed.message).not.toContain("PRIVATE-LABEL");
        expect(parsed.message).not.toContain("\n");
      }
    });
  }
  for (const value of [null, [], 2, "", " x", "x ", "x\n", "x".repeat(129)]) {
    test(`invalid label type or shape ${JSON.stringify(value)} refuses`, () => {
      expect(parseHerdrConfig({ workspace_labels: { "/valid": value } }).ok).toBe(false);
    });
  }
  for (const value of [null, [], "label", 4]) {
    test(`workspace_labels requires an object: ${JSON.stringify(value)}`, () => expect(parseHerdrConfig({ workspace_labels: value }).ok).toBe(false));
  }
  test("nonexistent paths and absent session accepted, unknown keys still refused", () => {
    expect(parseHerdrConfig({ workspace_labels: { "/does-not-exist": "x" } })).toEqual({ ok: true, config: { session: null, workspace_labels: { "/does-not-exist": "x" } } });
    expect(parseHerdrConfig({ workspace_label: "wrong" }).ok).toBe(false);
  });
  test("override selects exact path and label without any lookup call", async () => {
    edit((s) => s.workspaces.push({ id: "mapped", label: "mapped-label" }));
    be = new HerdrBackend(fake.env, { session: "dz-test", workspace_labels: { [sb.repo]: "mapped-label" } });
    const snapshot = await be.snapshot(); const before = fake.calls();
    expect(be.resolveWorkspace(sb.repo, snapshot)).toEqual({ ok: true, workspace: { id: "mapped", label: "mapped-label", source: "config" } });
    expect(fake.calls()).toEqual(before);
    const d = await dispatch({ task: task(), humanApproved: false }, ctx());
    expect(d.code).toBe(0);
    expect(record().backend_ids.workspace).toBe("mapped");
  });
  test("symlink key is not resolved and fallback from linked checkout uses main basename", async () => {
    const link = join(sb.root, "alias"); symlinkSync(sb.repo, link);
    be = new HerdrBackend(fake.env, { session: "dz-test", workspace_labels: { [link]: "no-match" } });
    const snapshot = await be.snapshot();
    expect(be.resolveWorkspace(realpathSync(link), snapshot)).toEqual({ ok: true, workspace: { id: "w1", label: "project", source: "directory" } });
    const first = await dispatch({ task: task(), humanApproved: false }, ctx());
    fake.setAgentStatus(first.envelope.tasks[0]!.agent_name, "idle");
    const d = await dispatch({ task: task({ id: "LINKED" }), humanApproved: false }, { ...ctx(), cwd: record().worktree });
    expect(d.code).toBe(0);
    expect(d.envelope.tasks[0]?.backend_ids.workspace).toBe("w1");
  });
  for (const mode of ["missing", "ambiguous"] as const) {
    test(`${mode} refuses before effects and waiting recovery`, async () => {
      const r = await unrecorded(); r.lifecycle = "launching"; registry().write(r);
      edit((s) => mode === "missing" ? s.workspaces[0]!.label = "other" : s.workspaces.push({ id: "w2", label: "project" }));
      const before = capture();
      const d = await dispatch({ task: task({ id: "NEXT" }), humanApproved: false }, ctx());
      expect(d.code).toBe(2); expect(d.envelope.refusal?.code).toBe(`project-workspace-${mode}`);
      expect(capture()).toEqual(before);
    });
  }
  test("config-invalid on every CLI command leaves tasks and effects unchanged", async () => {
    const r = await unrecorded(); r.lifecycle = "launching"; registry().write(r);
    mkdirSync(join(sb.configHome, "demerzel"), { recursive: true });
    writeFileSync(join(sb.configHome, "demerzel", "config.json"), JSON.stringify({ schema: 1, herdr: { workspace_labels: { "/bad\nkey": "PRIVATE" } } }));
    const before = capture();
    for (const args of [["dispatch", "NEXT"], ["resume", r.id], ["status"], ["units"], ["wait", r.id], ["collect", r.id], ["close", r.id]]) {
      const p = Bun.spawnSync([process.execPath, join(import.meta.dir, "../../src/cli.ts"), ...args, "--json"], { cwd: sb.repo, env: fake.env, stdout: "pipe", stderr: "pipe" });
      expect(p.exitCode).toBe(2);
      const json = JSON.parse(p.stdout.toString());
      expect(json.refusal.code).toBe("config-invalid");
      expect(json.refusal.next).toBe("Fix the herdr block of the Demerzel configuration and run again.");
      expect(json.refusal.message).toContain(JSON.stringify("/bad\nkey"));
    }
    expect(capture()).toEqual(before);
  });
});

describe("fallback with real adapter and fake herdr (F1-F4, T4, V1-V3, X1)", () => {
  for (const action of ["recovery", "close", "T4"] as const) {
    for (const kind of ["outside", "outside-and-own", "foreign-dz", "foreign-human", "foreign-beside-own", "own", "empty"] as const) {
      test(`${action}: ${kind}`, async () => {
        // For T4 modify the reconciliation answer immediately after tab create.
        // The pure snapshot wrapper preserves herdr's relation validation.
        const original = be.snapshot.bind(be);
        let changed = false;
        const change = () => edit((s) => {
          const own = s.tabs.find((t) => t.id === "w1:t1");
          if (!own) return;
          if (kind.startsWith("outside")) {
            s.workspaces.push({ id: "other", label: "other" });
            s.tabs.push({ ...own, id: "decoy", tab: "decoy", workspace: "other", pane: "decoy-pane" });
            if (kind === "outside") s.tabs = s.tabs.filter((t) => t.id !== own.id);
          }
          if (kind === "own") s.agents.push({ name: record().agent_name, kind: "codex", status: "idle", pane: own.pane, tab: own.id, workspace: own.workspace, cwd: own.cwd });
          if (kind.startsWith("foreign")) {
            const foreign = kind === "foreign-dz" ? "dz-ffffffffffffffff" : "human";
            s.agents.push({ name: foreign, kind: "codex", status: "idle", pane: own.pane, tab: own.id, workspace: own.workspace, cwd: own.cwd });
            if (kind === "foreign-beside-own") s.agents.push({ name: record().agent_name, kind: "codex", status: "idle", pane: own.pane, tab: own.id, workspace: own.workspace, cwd: own.cwd });
          }
        });
        if (action === "T4") {
          fake.script({ createAnswer: "no-pane" });
          be.snapshot = async () => {
            if (!changed && fake.state().tabs.some((t) => t.id === "w1:t1")) { change(); changed = true; }
            return original();
          };
          const d = await dispatch({ task: task(), humanApproved: false }, ctx());
          expect(d.code).toBe(1);
        } else {
          await unrecorded(); change();
          if (action === "recovery") { const r = record(); r.lifecycle = "launching"; registry().write(r); }
          const before = capture();
          if (action === "close") {
            const c = await close({ id: record().id, discardWorktree: false }, ctx());
            if (kind.startsWith("foreign")) {
              expect(c.envelope.refusal?.code).toBe("tab-not-owned"); expect(c.code).toBe(2); expect(capture()).toEqual(before);
            } else {
              expect(c.code).toBe(0);
              expect(record().history.at(-1)?.detail).toEqual({ tab_closed: kind === "outside" ? null : "w1:t1", last_tab_in_workspace: false });
              if (kind !== "outside") expect(record().history.at(-2)?.detail).toEqual({ tab: "w1:t1", by: "label" });
            }
          } else {
            fake.script({ createAnswer: "ok" });
            expect((await dispatch({ task: task({ id: "NEXT" }), humanApproved: false }, ctx())).code).toBe(0);
          }
        }
        if (action !== "close") {
          expect(record().backend_ids.tab).toBe(kind === "outside" || kind.startsWith("foreign") ? null : "w1:t1");
          if (kind.startsWith("foreign")) {
            expect(record().created.some((c) => c.kind === "tab" || c.kind === "pane")).toBe(false);
            if (action === "T4") expect(String(record().history.at(-1)?.detail?.["reason"])).toContain("not owned");
            else expect(record().history.at(-1)?.detail?.["tab_not_owned"]).toEqual({ tab: "w1:t1", agents: (await be.snapshot()).agents.filter((a) => a.tab === "w1:t1").map((a) => a.name).sort() });
          }
        }
        if (kind.startsWith("outside")) expect(fake.state().tabs.some((t) => t.id === "decoy")).toBe(true);
      });
    }
  }
  test("two live units share workspace; closing one leaves working neighbor and human tab", async () => {
    fake.script({ start: { codex: "not_ready", claude: "not_ready" } });
    const a = await dispatch({ task: task(), humanApproved: false }, ctx());
    const b = await dispatch({ task: task({ id: "NEXT", harness: "claude-code" }), humanApproved: false }, ctx());
    expect(a.code).toBe(1); expect(b.code).toBe(1);
    fake.setAgentStatus(a.envelope.tasks[0]!.agent_name, "idle");
    expect((await resume(record().id, ctx())).code).toBe(0);
    fake.setAgentStatus(b.envelope.tasks[0]!.agent_name, "idle");
    expect((await close({ id: "NEXT", discardWorktree: false }, ctx())).code).toBe(0);
    expect((await status({ ids: [record().id], all: false }, ctx())).envelope.tasks[0]?.agent).toBe("working");
    expect((await wait({ ids: [record().id], timeoutMs: 1 }, ctx())).code).toBe(1);
    expect(fake.state().tabs.map((t) => t.id)).toEqual(["w1:t0", "w1:t1"]);
  });
});

describe("tab invariants and immutable dispatch decision", () => {
  test("duplicate human labels accepted; task labels scoped per workspace; missing tab label refused", async () => {
    await dispatch({ task: task(), humanApproved: false }, ctx());
    edit((s) => {
      s.tabs.push({ ...s.tabs[0]!, id: "human-2", tab: "human-2", pane: "human-pane" });
      s.workspaces.push({ id: "other", label: "project" });
      s.tabs.push({ ...s.tabs[1]!, id: "other-tab", tab: "other-tab", workspace: "other", pane: "other-pane" });
    });
    expect((await be.snapshot()).tabs).toHaveLength(4);
    fake.script({ relation: "tab-without-label" });
    const before = capture();
    expect((await close({ id: record().id, discardWorktree: false }, ctx())).envelope.refusal?.code).toBe("backend-unavailable");
    expect(capture()).toEqual(before);
  });
  for (const remove of [false, true]) {
    test(`recorded workspace never re-resolved after preparation, removed ${remove}`, async () => {
      const base = sb.commit(".demerzel.json", JSON.stringify({ schema: 1, prepare: [["bun", "--version"]] }), "add preparation");
      const d = await dispatch({ task: task({ base }), humanApproved: false }, {
        ...ctx(), trace: (event) => {
          if (event === "wrote:recorded") expect(record().project_workspace).toEqual({ id: "w1", label: "project", source: "directory" });
          if (event === "wrote:prepared") edit((s) => {
            s.workspaces[0]!.label = "renamed";
            s.workspaces.push({ id: "new-project", label: "project" });
            if (remove) { s.workspaces = s.workspaces.filter((w) => w.id !== "w1"); s.tabs = []; }
          });
        },
      });
      expect(record().project_workspace?.id).toBe("w1");
      expect(record().backend_ids.workspace).toBe("w1");
      if (remove) {
        expect(d.code).toBe(1); expect(d.envelope.tasks[0]?.backend_error).toContain("workspace_not_found");
        expect(record().created.map((c) => c.kind)).toEqual(["worktree"]);
      } else {
        expect(d.code).toBe(0);
        expect(fake.state().tabs.find((t) => t.id === record().backend_ids.tab)?.workspace).toBe("w1");
      }
    });
  }
  test("tab disappears after snapshot: tab_not_found succeeds with exact history", async () => {
    fake.script({ statusAfterPrompt: "idle" });
    await dispatch({ task: task(), humanApproved: false }, ctx());
    const original = be.closeTab.bind(be);
    be.closeTab = async (tab) => { edit((s) => { s.tabs = s.tabs.filter((t) => t.id !== tab); s.agents = []; }); await original(tab); };
    expect((await close({ id: record().id, discardWorktree: false }, ctx())).code).toBe(0);
    expect(record().history.at(-1)?.detail).toEqual({ tab_closed: "w1:t1", last_tab_in_workspace: false });
  });
  test("failed close records exact tab detail and preserves lifecycle", async () => {
    fake.script({ statusAfterPrompt: "idle", closeFails: true });
    await dispatch({ task: task(), humanApproved: false }, ctx());
    const c = await close({ id: record().id, discardWorktree: false }, ctx());
    expect(c.code).toBe(1); expect(record().lifecycle).toBe("launched");
    expect(record().history.at(-1)?.detail).toEqual({ tab: "w1:t1", backend_error: c.envelope.tasks[0]?.backend_error });
  });
});

for (const known of [true, false]) {
  test(`legacy herdr record with known tab ${known} uses IDs only`, async () => {
    fake.script({ statusAfterPrompt: "idle" });
    await dispatch({ task: task(), humanApproved: false }, ctx());
    const r = record(); delete r.project_workspace;
    if (!known) r.backend_ids.tab = null;
    r.lifecycle = "launching"; registry().write(r);
    expect((await close({ id: r.id, discardWorktree: false }, ctx())).code).toBe(0);
    expect(record().history.at(-1)?.detail?.["tab_closed"]).toBe(known ? "w1:t1" : null);
    expect(fake.state().tabs.some((t) => t.id === "w1:t1")).toBe(!known);
  });
}

test("observation, resume and close never resolve renamed or ambiguous workspace labels", async () => {
  fake.script({ start: { codex: "not_ready", claude: "not_ready" } });
  await dispatch({ task: task(), humanApproved: false }, ctx());
  edit((s) => { s.workspaces[0]!.label = "renamed"; s.workspaces.push({ id: "new", label: "project" }, { id: "duplicate", label: "project" }); });
  fake.setAgentStatus(record().agent_name, "idle");
  expect((await status({ ids: [record().id], all: false }, ctx())).envelope.refusal).toBeNull();
  expect((await wait({ ids: [record().id], timeoutMs: 1 }, ctx())).envelope.refusal).toBeNull();
  expect((await resume(record().id, ctx())).code).toBe(0);
  fake.setAgentStatus(record().agent_name, "idle");
  expect((await close({ id: record().id, discardWorktree: false }, ctx())).code).toBe(0);
});
