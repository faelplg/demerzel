import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dispatch, status } from "../../src/core/index.ts";
import { BackendError, type LaunchPlan } from "../../src/core/backend.ts";
import type { Created } from "../../src/core/types.ts";
import { git } from "../../src/core/git.ts";
import { resolveProject } from "../../src/core/project.ts";
import { HerdrBackend, hookSettings, shQuote, versionAtLeast } from "../../src/herdr/backend.ts";
import { parseHerdrConfig } from "../../src/herdr/config.ts";
import { sandbox, task, type Sandbox } from "../core/helpers/sandbox.ts";
import { installFakeHerdr, type FakeHerdr } from "./helpers/fake.ts";

let sb: Sandbox;
let fake: FakeHerdr;
beforeEach(() => {
  sb = sandbox();
  fake = installFakeHerdr(sb.root, sb.env);
});
afterEach(() => sb.cleanup());

const herdr = (session: string | null = "dz-test", options = {}) => new HerdrBackend(fake.env, { session }, { postconditionWaitMs: 200, ...options });
const ctx = (backend: HerdrBackend) => ({ cwd: sb.repo, env: fake.env, backend, lockIntervalMs: 10, waitIntervalMs: 5 });

function plan(overrides: Partial<LaunchPlan> = {}): LaunchPlan {
  const base = git(sb.repo, ["rev-parse", "main"], sb.env).stdout;
  return {
    taskId: "TC-0099.1",
    agentName: "dz-0123456789abcdef",
    label: "TC-0099.1 dz-0123456789abcdef",
    harness: "codex",
    model: "gpt-6.1-sol",
    effort: "medium",
    branch: "radiant/TC-0099.1",
    baseCommit: base,
    worktreePath: join(sb.root, "wt", "TC-0099.1"),
    mainCheckout: sb.repo,
    ...overrides,
  };
}

async function launch(backend: HerdrBackend, p: LaunchPlan) {
  const created: Created[] = [];
  const outcome = await backend.launch(p, backend.prepare(p), (r) => created.push(r));
  return { outcome, created, kinds: created.map((c) => c.kind) };
}

const PERMISSION = /dangerously|permission-mode|bypass|--yolo|full-auto|danger-full-access|ask-for-approval|trust-repository|--sandbox/;

describe("configuration and session (H1)", () => {
  // Protects: Spec 2.4. Fails if a bad session name or unknown key passes.
  test("the herdr block", () => {
    expect(parseHerdrConfig(null)).toEqual({ ok: true, config: { session: null } });
    expect(parseHerdrConfig({ session: "lab" })).toEqual({ ok: true, config: { session: "lab" } });
    expect(parseHerdrConfig({ session: "-bad" }).ok).toBe(false);
    expect(parseHerdrConfig({ session: "lab", other: 1 }).ok).toBe(false);
  });

  // Protects: every herdr call carries --session when configured, and none
  // does when it is not. Fails if any call drops or adds it.
  test("--session on every call", async () => {
    const be = herdr("dz-test");
    await be.probe();
    await be.snapshot();
    await launch(be, plan());
    await be.send("dz-0123456789abcdef", "pedido");
    await be.closeWorkspace("w1");
    const calls = fake.calls();
    expect(calls.length).toBeGreaterThan(5);
    for (const call of calls) expect(call.slice(0, 2)).toEqual(["--session", "dz-test"]);

    const plain = installFakeHerdr(join(sb.root, "plain"), sb.env);
    await new HerdrBackend(plain.env, { session: null }).probe();
    for (const call of plain.calls()) expect(call).not.toContain("--session");
  });
});

describe("probe (H2)", () => {
  // Protects: a usable herdr, a stopped one, an old one and a missing one
  // all end as a Probe, never as a loose exception. Fails if any throws.
  test("running, stopped, old and missing", async () => {
    expect(await herdr().probe()).toMatchObject({ running: true, compatible: true, versionOk: true, version: "0.9.0", detail: null });
    fake.script({ version: "0.8.9" });
    expect(await herdr().probe()).toMatchObject({ running: true, versionOk: false });
    fake.script({ running: false });
    const stopped = await herdr().probe();
    expect(stopped.running).toBe(false);
    expect(stopped.detail).toContain("parado");
    const empty = join(sb.root, "empty-bin");
    mkdirSync(empty);
    const missing = await new HerdrBackend({ ...fake.env, PATH: empty }, { session: null }).probe();
    expect(missing.running).toBe(false);
    expect(missing.detail).toContain("herdr");
  });

  test("version comparison", () => {
    expect(versionAtLeast("0.9.0", "0.9.0")).toBe(true);
    expect(versionAtLeast("0.10.1", "0.9.0")).toBe(true);
    expect(versionAtLeast("1.0.0-rc1", "0.9.0")).toBe(true);
    expect(versionAtLeast("0.8.12", "0.9.0")).toBe(false);
  });
});

describe("snapshot (H3)", () => {
  // Protects: only named agents, unknown statuses as unknown, each workspace
  // with its root tab and pane. Fails if the mapping drops or invents data.
  test("mapping", async () => {
    const be = herdr();
    await launch(be, plan());
    fake.script({ extraAgents: [{ agent_status: "idle", pane_id: "w9:p1" }, { name: "dz-weird", agent_status: "thinking", pane_id: "w9:p2" }] });
    const snap = await be.snapshot();
    expect(snap.agents).toEqual([
      { name: "dz-0123456789abcdef", status: "idle", pane: "w1:p1" },
      { name: "dz-weird", status: "unknown", pane: "w9:p2" },
    ]);
    expect(snap.workspaces).toEqual([{ id: "w1", label: "TC-0099.1 dz-0123456789abcdef", tab: "w1:t1", pane: "w1:p1" }]);
  });

  // Protects: an answer that is not a snapshot is a BackendError with the
  // command. Fails if it becomes an empty snapshot.
  test("garbage and missing lists", async () => {
    fake.script({ snapshot: "garbage" });
    await expect(herdr().snapshot()).rejects.toBeInstanceOf(BackendError);
    fake.script({ snapshot: "no-lists" });
    await expect(herdr().snapshot()).rejects.toThrow("herdr api snapshot");
  });
});

describe("prepare (H4)", () => {
  // Protects: Spec 2.5, revision 0.9: only checked effort levels pass. Fails
  // if an unchecked level reaches the CLI or a checked one is dropped.
  test("effort levels", () => {
    const be = herdr();
    expect(be.prepare(plan({ effort: "xhigh" })).effort).toEqual({ applied: "xhigh", omittedReason: null });
    expect(be.prepare(plan({ effort: "max" })).effort.applied).toBeNull();
    expect(be.prepare(plan({ harness: "claude-code", effort: "max" })).effort.applied).toBe("max");
    expect(be.prepare(plan({ harness: "claude-code", effort: "minimal" })).effort.omittedReason).toContain("não conferido");
    expect(be.prepare(plan({ effort: null })).effort).toEqual({ applied: null, omittedReason: null });
  });

  // Protects: the hook quoting survives a real shell with quotes, spaces and
  // `$` in the paths. Fails if any argument is split or expanded.
  test("hook quoting through /bin/sh", async () => {
    expect(shQuote("it's $HOME")).toBe(`'it'\\''s $HOME'`);
    const odd = join(sb.root, "wt", "it's a $HOME `x`");
    const be = herdr();
    const p = plan({ harness: "claude-code", effort: "low", worktreePath: odd });
    const settings = JSON.parse(hookSettings(p));
    expect(settings.hooks.WorktreeCreate[0].hooks[0].type).toBe("command");
    const { outcome } = await launch(be, p);
    expect(outcome.kind).toBe("ready");
    expect(existsSync(odd)).toBe(true);
    expect(git(sb.repo, ["rev-parse", p.branch], sb.env).stdout).toBe(p.baseCommit);
  });
});

describe("launch (H5, H6, H7)", () => {
  // Protects: the Codex arguments of Spec 2.5 and the order of resources.
  // Fails if a flag changes or a resource is reported late.
  test("codex", async () => {
    const be = herdr(null);
    const p = plan();
    const { outcome, kinds } = await launch(be, p);
    expect(outcome).toEqual({ kind: "ready", ids: { workspace: "w1", tab: "w1:t1", pane: "w1:p1" } });
    expect(kinds).toEqual(["worktree", "workspace", "tab", "pane", "agent"]);
    const [create, start] = fake.calls();
    expect(create).toEqual(["worktree", "create", "--cwd", sb.repo, "--branch", p.branch, "--base", p.baseCommit, "--path", p.worktreePath, "--label", p.label, "--no-focus"]);
    expect(start).toEqual(["agent", "start", p.agentName, "--kind", "codex", "--pane", "w1:p1", "--timeout", "90000", "--", "--model", "gpt-6.1-sol", "-c", "model_reasoning_effort=medium"]);
  });

  // Protects: the Claude Code arguments and the hook-created worktree.
  // Fails if the worktree flags, settings or order change.
  test("claude-code", async () => {
    const be = herdr(null);
    const p = plan({ harness: "claude-code", model: "claude-sonnet-5-5", effort: "low" });
    const { outcome, kinds } = await launch(be, p);
    expect(outcome.kind).toBe("ready");
    expect(kinds).toEqual(["workspace", "tab", "pane", "worktree", "agent"]);
    const [create, start] = fake.calls();
    expect(create).toEqual(["workspace", "create", "--cwd", sb.repo, "--label", p.label, "--no-focus"]);
    expect(start).toEqual(["agent", "start", p.agentName, "--kind", "claude", "--pane", "w1:p1", "--timeout", "90000", "--", "--worktree", p.agentName, "--settings", hookSettings(p), "--model", "claude-sonnet-5-5", "--effort", "low"]);
  });

  // Protects: the postcondition fails on the cwd, on a missing branch and
  // on a branch at another commit. Fails if any of them launches.
  test("claude-code postcondition failures", async () => {
    fake.script({ hook: "wrong-path" });
    const cwd = await launch(herdr(), plan({ harness: "claude-code", agentName: "dz-a000000000000001", branch: "radiant/a", worktreePath: join(sb.root, "wt", "a") }));
    expect(cwd.outcome.kind).toBe("failed");
    expect(cwd.outcome.kind === "failed" && cwd.outcome.reason).toContain("cwd do agente");

    fake.script({ hook: "skip", cwd: "root" });
    const missing = await launch(herdr(), plan({ harness: "claude-code", agentName: "dz-a000000000000002", branch: "radiant/b", worktreePath: join(sb.root, "wt", "b") }));
    expect(missing.outcome.kind === "failed" && missing.outcome.reason).toContain("não existe");
    expect(missing.kinds).not.toContain("worktree");

    fake.script({ hook: "run", cwd: "worktree" });
    const be = herdr();
    const p = plan({ harness: "claude-code", agentName: "dz-a000000000000003", branch: "radiant/c", worktreePath: join(sb.root, "wt", "c") });
    // The hook builds from p.baseCommit; the postcondition expects another.
    const other = sb.commit("outro.txt", "x\n", "outro commit");
    const created: Created[] = [];
    const outcome = await be.launch({ ...p, baseCommit: other }, be.prepare(p), (r) => created.push(r));
    expect(outcome.kind === "failed" && outcome.reason).toContain("não para o commit base");
  });

  // Protects: Spec 2.5, revision 0.9: a blocked Claude Code startup is
  // blocked only when the postcondition holds. Fails if a blocked startup
  // without a checked worktree can be resumed.
  test("blocked startup", async () => {
    fake.script({ start: { claude: "not_ready", codex: "not_ready" } });
    const codex = await launch(herdr(), plan({ agentName: "dz-b000000000000001", branch: "radiant/d", worktreePath: join(sb.root, "wt", "d") }));
    expect(codex.outcome.kind).toBe("blocked");
    expect(codex.kinds).toEqual(["worktree", "workspace", "tab", "pane", "agent"]);

    const ok = await launch(herdr(), plan({ harness: "claude-code", agentName: "dz-b000000000000002", branch: "radiant/e", worktreePath: join(sb.root, "wt", "e") }));
    expect(ok.outcome.kind).toBe("blocked");

    fake.script({ hook: "skip", cwd: "root" });
    const unchecked = await launch(herdr(), plan({ harness: "claude-code", agentName: "dz-b000000000000003", branch: "radiant/f", worktreePath: join(sb.root, "wt", "f") }));
    expect(unchecked.outcome.kind).toBe("failed");
    expect(unchecked.kinds).toEqual(["workspace", "tab", "pane", "agent"]);
  });

  // Protects: a pane whose shell is not ready yet is retried, in both modes,
  // and a pane that stays busy ends in failed. Fails if the first
  // agent_pane_busy ends the launch, as the smoke of 2026-10-31 showed.
  test("agent start retried while the pane is busy", async () => {
    fake.script({ paneBusy: 2 });
    const codex = await launch(herdr(), plan());
    expect(codex.outcome.kind).toBe("ready");
    fake.script({ paneBusy: 2 });
    const claude = await launch(herdr(), plan({ harness: "claude-code", agentName: "dz-d000000000000001", branch: "radiant/h", worktreePath: join(sb.root, "wt", "h") }));
    expect(claude.outcome.kind).toBe("ready");
    const starts = fake.calls().filter((c) => c[2] === "agent" && c[3] === "start");
    expect(starts).toHaveLength(6);
    fake.script({ paneBusy: 100 });
    const busy = await launch(herdr("dz-test", { paneReadyWaitMs: 300 }), plan({ agentName: "dz-d000000000000002", branch: "radiant/i", worktreePath: join(sb.root, "wt", "i") }));
    expect(busy.outcome.kind === "failed" && busy.outcome.reason).toContain("agent_pane_busy");
  });

  test("agent start error", async () => {
    fake.script({ start: { codex: "error" } });
    const r = await launch(herdr(), plan());
    expect(r.outcome.kind === "failed" && r.outcome.reason).toContain("herdr agent start: agent_start_failed");
  });

  // Protects: H6, a Claude Code agent start that fails after the hook ran
  // still lists the worktree in created (finding F2). Fails if the worktree
  // is checked only on the success path.
  // Protects: H5 and H6, a success that does not name this agent, or a
  // broken answer, is a failed launch that still lists what exists
  // (findings N2 and N4). Fails if an unconfirmed agent is recorded or the
  // hook's worktree is lost.
  test("unconfirmed or broken agent start", async () => {
    fake.script({ start: { codex: "ok-empty" } });
    const empty = await launch(herdr(), plan());
    expect(empty.outcome.kind === "failed" && empty.outcome.reason).toContain("confirmação sem o agente");
    expect(empty.kinds).toEqual(["worktree", "workspace", "tab", "pane"]);

    fake.script({ start: { claude: "garbage" } });
    const broken = await launch(herdr(), plan({ harness: "claude-code", agentName: "dz-f000000000000001", branch: "radiant/k", worktreePath: join(sb.root, "wt", "k") }));
    expect(broken.outcome.kind === "failed" && broken.outcome.reason).toContain("não é JSON");
    expect(broken.kinds).toEqual(["workspace", "tab", "pane", "worktree"]);
  });

  test("claude-code agent start error after the hook", async () => {
    fake.script({ start: { claude: "error" } });
    const r = await launch(herdr(), plan({ harness: "claude-code", agentName: "dz-e000000000000001", branch: "radiant/j", worktreePath: join(sb.root, "wt", "j") }));
    expect(r.outcome.kind).toBe("failed");
    expect(r.kinds).toEqual(["workspace", "tab", "pane", "worktree"]);
  });
});

describe("send and close (H8, H9)", () => {
  // Protects: each prompt outcome maps to Spec 2.5. Fails if a stalled send
  // is taken as sent or as not sent.
  test("send outcomes", async () => {
    const be = herdr();
    await launch(be, plan());
    expect(await be.send("dz-0123456789abcdef", "linha 1\nlinha 2")).toBe("sent");
    const prompt = fake.calls().find((c) => c[2] === "agent" && c[3] === "prompt") ?? [];
    expect(prompt.slice(2)).toEqual(["agent", "prompt", "dz-0123456789abcdef", "linha 1\nlinha 2", "--wait", "--until", "working", "--until", "blocked", "--timeout", "30000"]);
    fake.script({ prompt: "agent_not_ready" });
    expect(await be.send("dz-0123456789abcdef", "x")).toBe("not-ready");
    fake.script({ prompt: "agent_prompt_stalled" });
    await expect(be.send("dz-0123456789abcdef", "x")).rejects.toThrow("herdr agent prompt: agent_prompt_stalled");
    fake.script({ prompt: "ok" });
    fake.setAgentStatus("dz-0123456789abcdef", "blocked");
    expect(await be.send("dz-0123456789abcdef", "x")).toBe("not-ready");
    await expect(be.send("dz-ffffffffffffffff", "x")).rejects.toThrow("agent_not_found");
  });

  // Protects: H8, a success that is not a confirmation never counts as sent
  // (finding F1 of the TC-0002 verification). Fails if a result without the
  // agent's state, or a result with a non-zero exit, is taken as delivered.
  test("an unexpected success is not a confirmation", async () => {
    const be = herdr();
    await launch(be, plan());
    fake.script({ prompt: "ok-no-status" });
    await expect(be.send("dz-0123456789abcdef", "x")).rejects.toThrow("confirmação sem o estado do agente");
    fake.script({ prompt: "result-exit-1" });
    await expect(be.send("dz-0123456789abcdef", "x")).rejects.toThrow("unexpected_exit");
    // Finding N1 of the second verification: a confirmation about another
    // agent is not this agent's delivery.
    fake.script({ prompt: "other-agent" });
    await expect(be.send("dz-0123456789abcdef", "x")).rejects.toThrow("confirmação de outro agente");
  });

  // Protects: Spec 2.3 and 6, a structured herdr error that echoes the
  // request never brings it into the diagnosis (finding N3). Fails if the
  // error message is kept as it came.
  test("a structured error that echoes the request is redacted", async () => {
    const be = herdr();
    await launch(be, plan());
    fake.script({ prompt: "error-echo" });
    const request = "Demerzel: tarefa TC-0099.1.\nLeia os pointers abaixo e execute a tarefa no papel indicado.";
    const error = await be.send("dz-0123456789abcdef", request).catch((e: unknown) => e);
    expect(String((error as Error).message)).toContain("prompt_failed");
    expect(String((error as Error).message)).not.toContain("Leia os pointers");
    expect(String((error as Error).message)).not.toContain("Demerzel: tarefa");
  });

  // Protects: H13 and Spec 6, a broken answer never copies the request into
  // the diagnosis (finding F4). Fails if the raw body is quoted.
  test("a non-JSON answer does not quote the request", async () => {
    const be = herdr();
    await launch(be, plan());
    fake.script({ prompt: "echo-garbage" });
    const error = await be.send("dz-0123456789abcdef", "PEDIDO-SECRETO-91c2").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendError);
    expect(String((error as Error).message)).not.toContain("PEDIDO-SECRETO-91c2");
  });

  test("close", async () => {
    const be = herdr();
    await launch(be, plan());
    await be.closeWorkspace("w1");
    expect(fake.state().workspaces).toEqual([]);
    await be.closeWorkspace("w1");
    fake.script({ running: false });
    await expect(be.closeWorkspace("w1")).rejects.toBeInstanceOf(BackendError);
  });
});

describe("no permission flag reaches a harness or herdr (H10)", () => {
  // Protects: Spec 2.5 and 6. Fails if any call carries a permission,
  // bypass, sandbox or trust flag.
  test("all calls of both modes", async () => {
    const be = herdr();
    await launch(be, plan());
    await launch(be, plan({ harness: "claude-code", agentName: "dz-c000000000000001", branch: "radiant/g", worktreePath: join(sb.root, "wt", "g") }));
    await be.send("dz-0123456789abcdef", "x");
    for (const call of fake.calls()) for (const arg of call) expect(arg).not.toMatch(PERMISSION);
  });
});

describe("the core with the herdr backend (H13)", () => {
  // Protects: a full dispatch through the herdr backend, and a snapshot that
  // fails after the probe as a refusal with the herdr command. Fails if the
  // exception escapes or the message loses the command.
  test("dispatch and a broken snapshot", async () => {
    const be = herdr(null);
    const d = await dispatch({ task: task({ harness: "claude-code", model: "claude-sonnet-5-5", effort: "low" }), humanApproved: false }, ctx(be));
    expect(d.code).toBe(0);
    const t = d.envelope.tasks[0];
    expect(t?.agent).toBe("working");
    expect(t?.backend_ids.workspace).toBe("w1");
    const record = JSON.parse(readFileSync(join(resolveProject(sb.repo, fake.env)?.dir ?? "", "tasks", "TC-0099.1.json"), "utf8"));
    expect(record.preparation.settings).toBe(hookSettings({ ...plan({ harness: "claude-code" }), agentName: record.agent_name, label: `TC-0099.1 ${record.agent_name}`, branch: record.branch, worktreePath: record.worktree, baseCommit: record.base.commit, model: "claude-sonnet-5-5", effort: "low" }));
    expect(fake.state().workspaces[0]?.label).toBe(`TC-0099.1 ${record.agent_name}`);

    fake.script({ snapshot: "garbage" });
    const s = await status({ ids: [], all: false }, ctx(herdr(null)));
    expect(s.code).toBe(2);
    expect(s.envelope.refusal?.message).toContain("herdr api snapshot");
  });
});
