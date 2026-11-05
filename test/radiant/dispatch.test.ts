import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { close, collect, dispatch } from "../../src/core/index.ts";
import { loadConfig } from "../../src/core/config.ts";
import { FakeBackend } from "../../src/core/fake-backend.ts";
import { git } from "../../src/core/git.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { prepareDispatch } from "../../src/radiant/index.ts";
import { backend, context, sandbox, writeReport, type Sandbox } from "../core/helpers/sandbox.ts";
import { attempt, commitAll, contractText, CONTRACT, interposePython, PIN, radiantFiles, radiantRoot, ready, request, writeRouting } from "./helpers/fixture.ts";

// TC-0003, outputs 2 and 3, verification 6: a unit of a fixture contract
// dispatched through the integration and the core, against the real Radiant
// checkout at the pin.

let root: string;
let before: string;
beforeAll(() => {
  root = radiantRoot();
  before = radiantFiles(root);
});

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

function record(id = "TC-0042.1"): TaskRecord {
  return JSON.parse(readFileSync(join(resolveProject(sb.repo, sb.env)?.dir ?? "", "tasks", `${id}.json`), "utf8")) as TaskRecord;
}

describe("the Radiant checkout", () => {
  // Protects: contract, section 9, the suite runs against the checkout at
  // the pin of this repository. Fails if DEMERZEL_RADIANT_ROOT points
  // elsewhere, which radiantRoot() would also refuse.
  test("is at the pin of .radiant.json", () => {
    expect(git(root, ["rev-parse", "HEAD"], { PATH: process.env["PATH"] }).stdout).toBe(PIN);
  });
});

describe("a dispatched unit (I3, I8, I11, readback)", () => {
  // Protects: Spec 3, items 3, 6, 8 and 2.1: the recorded task carries the
  // harness and model the routing chose, the branch with the prefix, the
  // base commit, the three pointers and the provenance. Fails if any field
  // drifts from the Spec.
  test("the recorded task matches Spec 3", async () => {
    const base = ready(sb, root);
    const be = backend(sb);
    const r = await attempt(sb, be);
    expect(r.code).toBe(0);
    const t = record();
    const models = JSON.parse(readFileSync(join(root, "adapters", "claude-code", "capabilities.json"), "utf8"));
    expect(t.harness).toBe("claude-code");
    // radiant-dev defaults to standard in agents.json.
    expect(t.model).toBe(models.standard);
    expect(t.effort).toEqual({ requested: null, applied: null, omitted_reason: null });
    expect(t.branch).toBe("radiant/TC-0042.1");
    expect(t.base.commit).toBe(base);
    expect(git(t.worktree, ["rev-parse", "HEAD"], sb.env).stdout).toBe(base);
    expect(t.task.request).toEqual({
      role: "radiant-dev",
      pointers: [
        { label: "radiant-root", path: root },
        { label: "radiant-revision", ref: PIN },
        { label: "contract", path: CONTRACT },
      ],
    });
    expect(t.task.returnPath).toBe(".radiant/reports/TC-0042.1.md");
    expect(t.provenance).toEqual({ radiant_revision: PIN, radiant_root: root, contract: CONTRACT, rule: "default", base_ref: "main" });
    expect(t.task.writes).toEqual(["src/TC-0042.1/"]);
    expect(t.task.dependsOn).toEqual([]);
    expect(t.flags.human_approved).toBe(false);
    expect(t.request_text).toContain("Demerzel: tarefa TC-0042.1.");
    expect(t.request_text).toContain(`- radiant-revision: ${PIN}`);
    expect(t.request_text).toContain(`- contract: ${CONTRACT}`);
  });

  // Protects: Spec 2.1 and the routing, a candidate's effort reaches the
  // task, and a named rule is recorded in the provenance. Fails if the
  // effort is dropped or the rule is recorded as default.
  test("a named rule and a candidate effort", async () => {
    ready(sb, root);
    writeRouting(sb, { schema: 1, rules: [{ id: "codex-build", when: "Build on Codex", use: [{ harness: "codex", effort: "high" }] }], default: [{ harness: "claude-code" }] });
    const r = await attempt(sb, backend(sb), { rule: "codex-build" });
    expect(r.code).toBe(0);
    const t = record();
    expect(t.harness).toBe("codex");
    expect(t.effort.requested).toBe("high");
    expect(t.provenance["rule"]).toBe("codex-build");
  });

  // Protects: Spec 3, item 3, revision 0.12: the base is resolved once.
  // When the branch moves after the integration validated it, the core
  // still launches the validated commit, and the requested ref stays in
  // base_ref. Fails if the core resolves the ref again.
  test("a base that moves after validation", async () => {
    const validated = ready(sb, root);
    const be = backend(sb);
    const config = loadConfig(sb.env);
    if (!config.ok) throw new Error(config.message);
    const prepared = prepareDispatch(request(), { cwd: sb.repo, env: sb.env, backend: be, config: config.config });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const moved = sb.commit("depois.txt", "x\n", "main anda depois da validação");
    expect(moved).not.toBe(validated);
    const d = await dispatch({ task: prepared.task, humanApproved: false }, context(sb, be));
    expect(d.code).toBe(0);
    const t = record();
    expect(t.base.commit).toBe(validated);
    expect(git(t.worktree, ["rev-parse", "HEAD"], sb.env).stdout).toBe(validated);
    expect(t.provenance["base_ref"]).toBe("main");
  });

  // Protects: Spec 3, item 4, the contract is read from the base commit:
  // a working tree that changes the unit's role and adds a unit does not
  // reach the dispatch. Fails if the contract or its listing comes from the
  // working tree.
  test("the contract of the base commit, not of the working tree", async () => {
    ready(sb, root);
    writeFileSync(join(sb.repo, CONTRACT), contractText([{ id: "TC-0042.1", role: "radiant-verifier" }, { id: "TC-0042.5" }]));
    expect((await attempt(sb, backend(sb), { unitId: "TC-0042.5" })).envelope.refusal?.code).toBe("unit-not-found");
    expect((await attempt(sb, backend(sb))).code).toBe(0);
    expect(record().task.request.role).toBe("radiant-dev");
  });

  // Protects: Spec 3, item 3, an explicit --base wins over the current
  // branch, and the ref asked for is the base_ref. Fails if the explicit
  // ref is ignored.
  test("--base", async () => {
    const first = ready(sb, root);
    sb.commit("outro.txt", "x\n", "outro commit");
    expect((await attempt(sb, backend(sb), { base: first.slice(0, 12) })).code).toBe(0);
    expect(record().base.commit).toBe(first);
    expect(record().provenance["base_ref"]).toBe(first.slice(0, 12));
  });

  // Protects: Spec 3, item 3, in a detached HEAD the base is the HEAD
  // commit, which is also the base_ref. Fails if a detached HEAD has no
  // base or takes another commit.
  test("a detached HEAD", async () => {
    ready(sb, root);
    const head = sb.commit("outro.txt", "x\n", "outro commit");
    git(sb.repo, ["checkout", "-q", "--detach", "HEAD"], sb.env);
    expect((await attempt(sb, backend(sb))).code).toBe(0);
    expect(record().base.commit).toBe(head);
    expect(record().provenance["base_ref"]).toBe(head);
  });

  // Protects: I9, with --human-approved a rule with approval human
  // dispatches and the record keeps that the flag was used. Fails if the
  // flag is lost.
  test("--human-approved is recorded", async () => {
    ready(sb, root);
    const r = await attempt(sb, backend(sb), { rule: "critique", humanApproved: true });
    expect(r.code).toBe(0);
    const t = record();
    expect(t.flags.human_approved).toBe(true);
    expect(t.task.approval).toBe("human");
    expect(t.history[0]?.detail?.["human_approved"]).toBe(true);
    // The rule's deep candidate is above the unit's standard floor.
    const models = JSON.parse(readFileSync(join(root, "adapters", "codex", "capabilities.json"), "utf8"));
    expect(t.model).toBe(models.deep);
  });
});

describe("depends_on and writes reach the core (I12)", () => {
  // Protects: Spec 3, item 9, a unit's dependency is the core's
  // dependency-pending until the other task is collected, closed and in the
  // base, and its writes are the core's overlap check. Fails if either is
  // dropped on the way.
  test("dependency-pending, then dispatched once the work is in the base", async () => {
    ready(sb, root);
    const be = backend(sb, { statusAfterSend: "idle" });
    expect((await attempt(sb, be, { unitId: "TC-0042.2" })).envelope.refusal?.code).toBe("dependency-pending");
    const first = await attempt(sb, be);
    expect(first.code).toBe(0);
    expect((await attempt(sb, be, { unitId: "TC-0042.2" })).envelope.refusal?.code).toBe("dependency-pending");
    const worktree = first.envelope.tasks[0]?.worktree ?? "";
    writeReport(worktree, ".radiant/reports/TC-0042.1.md");
    expect((await collect("TC-0042.1", context(sb, be))).code).toBe(0);
    expect((await close({ id: "TC-0042.1", discardWorktree: false }, context(sb, be))).code).toBe(0);
    git(sb.repo, ["merge", "-q", "--no-edit", "radiant/TC-0042.1"], sb.env);
    const second = await attempt(sb, be, { unitId: "TC-0042.2" });
    expect(second.code).toBe(0);
    expect(record("TC-0042.2").task.dependsOn).toEqual(["TC-0042.1"]);
  });

  // Radiant already refuses independent units of one contract whose writes
  // overlap, so the overlap comes from a unit of another contract still
  // open in the registry.
  test("writes-overlap", async () => {
    ready(sb, root, { units: [{ id: "TC-0042.1", writes: ["src/"] }] });
    writeFileSync(join(sb.repo, "docs", "contracts", "TC-0043-outro.md"), contractText([{ id: "TC-0043.1", writes: ["src/a.ts"] }]));
    commitAll(sb, "second contract");
    const be = backend(sb);
    expect((await attempt(sb, be)).code).toBe(0);
    const r = await attempt(sb, be, { unitId: "TC-0043.1" });
    expect(r.code).toBe(2);
    expect(r.envelope.refusal?.code).toBe("writes-overlap");
    expect(r.envelope.refusal?.message).toContain("src/a.ts se sobrepõe a src/");
  });
});

describe("each validator runs at most once per dispatch (EB-08)", () => {
  // Protects: Spec 3, item 5, one gate, one units and one routing per
  // dispatch, and none after the first refusal. Fails if a validator runs
  // twice or the run goes on after a refusal.
  test("a dispatch runs the gate, units and routing once each", async () => {
    ready(sb, root);
    const py = interposePython(sb);
    expect((await attempt(sb, backend(sb), {}, { env: py.env })).code).toBe(0);
    expect(py.runs()).toEqual(["check_project.py " + sb.repo, "check_dispatch.py units", "check_dispatch.py routing"]);
  });

  test("a refusal at the gate runs nothing else", async () => {
    ready(sb, root);
    writeFileSyncJson(join(sb.repo, ".radiant.json"), { radiant_revision: "0".repeat(40) });
    const py = interposePython(sb);
    expect((await attempt(sb, backend(sb), {}, { env: py.env })).envelope.refusal?.code).toBe("pin-mismatch");
    expect(py.runs()).toEqual(["check_project.py " + sb.repo]);
  });

  test("a refusal at the units runs no routing", async () => {
    ready(sb, root, { units: [{ id: "TC-0042.1", role: "papel-inexistente" }] });
    const py = interposePython(sb);
    expect((await attempt(sb, backend(sb), {}, { env: py.env })).envelope.refusal?.code).toBe("units-invalid");
    expect(py.runs()).toEqual(["check_project.py " + sb.repo, "check_dispatch.py units"]);
  });
});

function writeFileSyncJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value));
}

describe("the Radiant checkout after this file", () => {
  // Protects: contract, section 11, the suite only reads the checkout: no
  // file appears in it, ignored ones included. Fails if a validator writes
  // bytecode or a test writes into it.
  test("has no new file", () => {
    expect(radiantFiles(root)).toBe(before);
  });
});
