import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../../package.json" with { type: "json" };
import type { Env } from "../../src/core/env.ts";
import { git } from "../../src/core/git.ts";
import { ProjectLock } from "../../src/core/lock.ts";
import { resolveProject } from "../../src/core/project.ts";
import { Registry } from "../../src/core/registry.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { sandbox, writeReport, type Sandbox } from "../core/helpers/sandbox.ts";
import { installFakeHerdr, type FakeHerdr } from "../herdr/helpers/fake.ts";
import { commitAll, consumer, CONTRACT, interposePython, map, radiantFiles, radiantRoot, ROUTING, writeConfig, writeRouting, type UnitSpec } from "./helpers/fixture.ts";

// Spec 7.11: exercise the actual CLI, real pinned validators and isolated
// consumers. Only herdr is fake; every observation must leave state intact.
const BIN = fileURLToPath(new URL(`../../${pkg.bin.demerzel}`, import.meta.url));
const ACTIVE = "docs/contracts/ACTIVE.md";
const UNITS: UnitSpec[] = [
  { id: "TC-0042.2", writes: ["src/b/"], depends_on: ["TC-0042.1"] },
  { id: "TC-0042.1", writes: ["src/a/"] },
];
let root: string;
let initialRadiant: string;
let sb: Sandbox;
let fake: FakeHerdr;
beforeAll(() => { root = radiantRoot(); initialRadiant = radiantFiles(root); });
beforeEach(() => {
  sb = sandbox();
  fake = installFakeHerdr(sb.root, sb.env);
  writeConfig(sb, { schema: 1, herdr: { session: "dz-test" }, radiant: { root } });
  writeRouting(sb, ROUTING);
});
afterEach(() => {
  sb.cleanup();
  expect(radiantFiles(root)).toBe(initialRadiant);
});

async function cli(args: string[] = [], env: Env = fake.env, cwd = sb.repo) {
  const proc = Bun.spawn([BIN, ...args], { cwd, env: env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}
const units = (args: string[] = [], env = fake.env, cwd = sb.repo) => cli(["units", ...args, "--json"], env, cwd);
const registry = () => new Registry(resolveProject(sb.repo, sb.env)!.dir);
function setup(list = UNITS): string {
  consumer(sb, { units: list, map: map({ active_contract: ACTIVE }) });
  writeFileSync(join(sb.repo, ACTIVE), "# Active contract\n\n[TC-0042](TC-0042-fixture.md)\n");
  return commitAll(sb, "activate fixture contract");
}
async function launch(id = "TC-0042.1"): Promise<TaskRecord> {
  const r = await cli(["dispatch", id, "--rule", "codex-build", "--json"]);
  expect(r.code).toBe(0);
  return registry().read(id)!;
}
function patch(record: TaskRecord, change: Partial<TaskRecord>): TaskRecord {
  const next = { ...record, ...change };
  registry().write(next);
  return next;
}
function files(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readdirSync(path, { recursive: true, withFileTypes: true }).map((e) => {
    const name = join(e.parentPath, e.name);
    return [name.slice(path.length), e.isDirectory() ? "directory" : readFileSync(name).toString("base64")];
  }));
}
async function refused(code: string, args: string[] = [], env = fake.env, cwd = sb.repo) {
  const before = { state: files(sb.stateHome), git: sb.gitState(), calls: fake.calls() };
  const r = await units(args, env, cwd);
  expect(r.code).toBe(2);
  expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, command: "units", tasks: [], units: [], contract: null, base: null, refusal: { code } });
  expect({ state: files(sb.stateHome), git: sb.gitState(), calls: fake.calls() }).toEqual(before);
  return JSON.parse(r.stdout);
}

describe("read-only contract units (Spec 7.11)", () => {
  test("lists every unit in contract order without tasks or a running backend", async () => {
    const commit = setup();
    fake.script({ running: false });
    const before = files(sb.stateHome);
    const r = await units();
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, command: "units", tasks: [], contract: CONTRACT, base: { commit }, units: [
      { id: "TC-0042.2", dependsOn: ["TC-0042.1"], writes: ["src/b/"], rule: "default", state: "waiting", waitingOn: ["TC-0042.1"], task: null },
      { id: "TC-0042.1", dependsOn: [], writes: ["src/a/"], rule: "default", state: "pending", waitingOn: [], task: null },
    ], refusal: null });
    expect(files(sb.stateHome)).toEqual(before);
    expect(fake.calls()).toEqual([]);
    const text = await cli(["units"]);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain(`contract=${CONTRACT}  commit=${commit}`);
    expect(text.stdout).toContain("TC-0042.2  state=waiting  dependsOn=[\"TC-0042.1\"]  writes=[\"src/b/\"]  rule=default  waitingOn=[\"TC-0042.1\"]");
  });

  test("normalizes an explicit root-relative path from a subdirectory and detached HEAD", async () => {
    const commit = setup();
    expect(git(sb.repo, ["checkout", "--detach", "-q", commit], sb.env).code).toBe(0);
    const r = await units(["--contract", "./docs//contracts/./TC-0042-fixture.md"], fake.env, join(sb.repo, "docs"));
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).contract).toBe(CONTRACT);
    expect(JSON.parse(r.stdout).base.commit).toBe(commit);
  });

  test("uses a linked checkout's HEAD and the main checkout's registry", async () => {
    setup();
    await launch();
    const checkout = join(sb.root, "linked-checkout");
    expect(git(sb.repo, ["worktree", "add", "-qb", "linked", checkout, "HEAD"], sb.env).code).toBe(0);
    const r = await units([], fake.env, checkout);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).tasks[0].id).toBe("TC-0042.1");
  });

  test.each([
    "# Active\n[contract](TC-0042-fixture.md)\n",
    "[contract](<TC-0042-fixture.md> \"Active contract\")\n",
    "[contract][active]\n\n[active]: TC-0042-fixture.md\n",
    "[active][]\n\n[active]: TC-0042-fixture.md\n",
    "[active]\n\n[active]: TC-0042-fixture.md\n",
    "```md\nnone\n[example](TC-0042-other.md)\n```\n![image](TC-0042-other.md)\n`[code](TC-0042-other.md)`\n[active](TC-0042-fixture.md)\n",
  ])("resolves the active Markdown link without treating examples as activation: %s", async (text) => {
    setup();
    writeFileSync(join(sb.repo, ACTIVE), text);
    commitAll(sb, "set active link");
    const r = await units();
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).contract).toBe(CONTRACT);
  });

  test("reads committed map, pointer and contract after the caller gate", async () => {
    const commit = setup();
    mkdirSync(join(sb.repo, "other-contracts"));
    writeFileSync(join(sb.repo, ".radiant.json"), JSON.stringify(map({ contracts: "other-contracts", active_contract: ACTIVE })));
    writeFileSync(join(sb.repo, ACTIVE), "none\n");
    writeFileSync(join(sb.repo, CONTRACT), "uncommitted contract marker\n");
    const r = await units();
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).base.commit).toBe(commit);
    expect(JSON.parse(r.stdout).units).toHaveLength(2);
    expect(r.stdout).not.toContain("uncommitted contract marker");
  });

  test("reuses status views, keeps closed tasks, earlier bases and historical routing", async () => {
    setup([{ id: "TC-0042.1", writes: ["src/a/"] }]);
    const record = await launch();
    sb.commit("later.txt", "later\n", "advance base");
    writeRouting(sb, { schema: 1, rules: [], default: [{ harness: "claude-code", capability: "light" }] });
    const before = files(sb.stateHome);
    const r = await units();
    const list = JSON.parse(r.stdout);
    const status = JSON.parse((await cli(["status", "--all", "--json"])).stdout);
    expect(r.code).toBe(0);
    expect(list.tasks).toEqual(status.tasks);
    expect(list.units[0]).toMatchObject({ state: "launched", rule: "default", waitingOn: [], task: { agent: "working", report: "absent", provenance: { rule: "codex-build" } } });
    expect(list.units[0].task).toEqual(list.tasks[0]);
    expect(files(sb.stateHome)).toEqual(before);
    patch(record, { lifecycle: "closed" });
    const closed = await units();
    expect(closed.code).toBe(0);
    expect(JSON.parse(closed.stdout).units[0].state).toBe("closed");
  });

  test.each(["recorded", "launching", "launch-failed", "launched", "collected", "closed"] as const)("shows lifecycle %s without recovery or writes", async (lifecycle) => {
    setup([{ id: "TC-0042.1" }]);
    const record = await launch();
    patch(record, { lifecycle });
    const before = files(sb.stateHome);
    const r = await units();
    const row = JSON.parse(r.stdout).units[0];
    expect(row.state).toBe(lifecycle);
    expect(row.task.interrupted).toBe(lifecycle === "recorded" || lifecycle === "launching");
    expect(r.code).toBe(["recorded", "launching", "launch-failed"].includes(lifecycle) ? 1 : 0);
    expect(files(sb.stateHome)).toEqual(before);
  });

  test.each(["blocked", "idle", "unknown"])("preserves agent %s and report state", async (state) => {
    setup([{ id: "TC-0042.1" }]);
    const record = await launch();
    fake.setAgentStatus(record.agent_name, state);
    const r = await units();
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).units[0]).toMatchObject({ state: "launched", task: { agent: state, report: "absent" } });
    writeReport(record.worktree, record.task.returnPath, "REPORT-BODY-MARKER\n");
    const present = await units();
    expect(present.code).toBe(state === "idle" ? 0 : 1);
    expect(JSON.parse(present.stdout).tasks[0].report).toBe("present");
    expect(present.stdout).not.toContain("REPORT-BODY-MARKER");
  });

  test("preserves the lost observation and the text fields of a task", async () => {
    setup([{ id: "TC-0042.1" }]);
    const record = await launch();
    patch(record, { agent_name: "absent-agent" });
    const r = await units();
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).tasks[0].agent).toBe("lost");
    const text = await cli(["units"]);
    expect(text.stdout).toContain("task=TC-0042.1  lifecycle=launched  agent=lost  report=absent");
  });

  test("does not match an ID from another contract or select duplicate matches", async () => {
    setup();
    const record = await launch();
    patch(record, { provenance: { ...record.provenance, contract: "docs/contracts/TC-0042-other.md" } });
    fake.script({ running: false });
    const absent = await units();
    expect(absent.code).toBe(1);
    expect(JSON.parse(absent.stdout).tasks).toEqual([]);
    registry().write(record);
    writeFileSync(join(registry().tasksDir, "duplicate.json"), JSON.stringify(record));
    await refused("task-invalid");
  });

  test.each(["missing", "launched", "collected", "uncollected", "closed-before-collected", "unmerged", "branch-missing", "finished"])("dependency %s follows dispatch completion rules", async (condition) => {
    setup();
    if (condition !== "missing") {
      const record = await launch();
      writeReport(record.worktree, record.task.returnPath);
      patch(record, { lifecycle: condition === "launched" ? "launched" : condition === "collected" ? "collected" : "closed",
        history: [{ at: "2026-11-18T00:00:00Z", event: "recorded", detail: null },
          ...(condition === "closed-before-collected" ? [{ at: "2026-11-18T00:00:01Z", event: "closed", detail: null }] : []),
          ...(condition === "uncollected" ? [] : [{ at: "2026-11-18T00:00:01Z", event: "collected", detail: null }]),
          ...(condition === "closed-before-collected" ? [] : [{ at: "2026-11-18T00:00:02Z", event: "closed", detail: null }])] });
      if (condition === "unmerged") {
        writeFileSync(join(record.worktree, "new.txt"), "new\n");
        expect(git(record.worktree, ["add", "new.txt"], sb.env).code).toBe(0);
        expect(git(record.worktree, ["commit", "-qm", "dependency result"], sb.env).code).toBe(0);
      }
      if (condition === "branch-missing") expect(git(sb.repo, ["update-ref", "-d", `refs/heads/${record.branch}`], sb.env).code).toBe(0);
    }
    const r = await units();
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).units[0]).toMatchObject({ state: condition === "finished" ? "pending" : "waiting", waitingOn: condition === "finished" ? [] : ["TC-0042.1"] });
  });

  test("waitingOn includes only unfinished dependencies and clears once branch tips enter HEAD", async () => {
    setup([
      { id: "TC-0042.3", depends_on: ["TC-0042.2", "TC-0042.1"], writes: ["src/c/"] },
      { id: "TC-0042.1", writes: ["src/a/"] },
      { id: "TC-0042.2", writes: ["src/b/"] },
    ]);
    const first = await launch();
    patch(first, { lifecycle: "closed", history: [...first.history, { at: "2026-11-18T00:00:01Z", event: "collected", detail: null }, { at: "2026-11-18T00:00:02Z", event: "closed", detail: null }] });
    const second = await launch("TC-0042.2");
    writeFileSync(join(second.worktree, "result.txt"), "result\n");
    expect(git(second.worktree, ["add", "result.txt"], sb.env).code).toBe(0);
    expect(git(second.worktree, ["commit", "-qm", "dependency result"], sb.env).code).toBe(0);
    patch(second, { lifecycle: "closed", history: [...second.history, { at: "2026-11-18T00:00:01Z", event: "collected", detail: null }, { at: "2026-11-18T00:00:02Z", event: "closed", detail: null }] });
    const waiting = JSON.parse((await units()).stdout).units[0];
    expect(waiting).toMatchObject({ state: "waiting", waitingOn: ["TC-0042.2"] });
    expect(git(sb.repo, ["merge", "--ff-only", second.branch], sb.env).code).toBe(0);
    expect(JSON.parse((await units()).stdout).units[0]).toMatchObject({ state: "pending", waitingOn: [] });
  });

  test.each(["none", "no-link", "ambiguous", "remote", "outside", "symlink", "missing-target", "missing-pointer", "null-pointer"])("refuses unusable active pointer: %s", async (condition) => {
    setup();
    const contents: Record<string, string> = { none: "none\n", "no-link": "TC-0042-fixture.md\n", ambiguous: "[one](TC-0042-fixture.md)\n[two](TC-0042-other.md)\n", remote: "[remote](https://example.invalid/TC-0042-fixture.md)\n", outside: "[outside](../../TC-0042-fixture.md)\n", "missing-target": "[absent](TC-0042-absent.md)\n" };
    if (contents[condition] !== undefined) writeFileSync(join(sb.repo, ACTIVE), contents[condition]);
    if (condition === "symlink") {
      rmSync(join(sb.repo, CONTRACT));
      symlinkSync("../../README.md", join(sb.repo, CONTRACT));
    }
    if (condition === "missing-pointer" || condition === "null-pointer") {
      writeFileSync(join(sb.repo, ".radiant.json"), JSON.stringify(map({ active_contract: condition === "null-pointer" ? null : ACTIVE })));
      if (condition === "missing-pointer") rmSync(join(sb.repo, ACTIVE));
    }
    commitAll(sb, "configure unusable pointer");
    // A missing committed pointer is checked after a valid caller gate.
    if (condition === "missing-pointer") writeFileSync(join(sb.repo, ACTIVE), "none\n");
    await refused("contract-not-found");
  });

  test.each(["/tmp/TC-0042-fixture.md", "docs/../contracts/TC-0042-fixture.md", "README.md", "docs/contracts/absent.md", "docs/contracts"])("refuses explicit contract path %s", async (path) => {
    setup();
    await refused("contract-not-found", ["--contract", path]);
  });

  test("explicit contract bypasses a none pointer but rejects a symlink", async () => {
    setup();
    writeFileSync(join(sb.repo, ACTIVE), "none\n");
    commitAll(sb, "deactivate fixture");
    expect((await units(["--contract", CONTRACT])).code).toBe(1);
    rmSync(join(sb.repo, CONTRACT));
    symlinkSync("../../README.md", join(sb.repo, CONTRACT));
    commitAll(sb, "symlink contract");
    await refused("contract-not-found", ["--contract", CONTRACT]);
  });

  test("an unreadable committed contract is contract-not-found without effects", async () => {
    setup();
    const actualGit = Bun.which("git")!;
    const oid = git(sb.repo, ["rev-parse", `HEAD:${CONTRACT}`], sb.env).stdout;
    const bin = join(sb.root, "git-bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "git"), `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (args[0] === "cat-file" && args[2] === ${JSON.stringify(oid)}) process.exit(1);\nconst p = Bun.spawnSync([${JSON.stringify(actualGit)}, ...args], { env: process.env, stdout: "inherit", stderr: "inherit" });\nprocess.exit(p.exitCode);\n`);
    chmodSync(join(bin, "git"), 0o755);
    await refused("contract-not-found", ["--contract", CONTRACT], { ...fake.env, PATH: `${bin}:${fake.env["PATH"]}` });
  });

  test("configuration, project and pin failures use the units refusal envelope", async () => {
    setup();
    await refused("not-a-project", [], fake.env, sb.root);
    writeConfig(sb, "invalid JSON");
    await refused("config-invalid");
    writeConfig(sb, { schema: 1 });
    await refused("radiant-root-missing");
    writeConfig(sb, { schema: 1, radiant: { root } });
    writeFileSync(join(sb.repo, ".radiant.json"), JSON.stringify(map({ radiant_revision: "0".repeat(40) })));
    await refused("pin-mismatch");
    // The caller's gate passes, but its HEAD still carries the wrong pin.
    commitAll(sb, "wrong committed pin");
    writeFileSync(join(sb.repo, ".radiant.json"), JSON.stringify(map({ active_contract: ACTIVE })));
    await refused("pin-mismatch");
  });

  test("uses existing refusal codes and stops validators at the first refusal", async () => {
    setup();
    let spy = interposePython(sb);
    expect((await units([], spy.env)).code).toBe(1);
    expect(spy.runs().map((s) => s.split(" ").slice(0, 2).join(" "))).toEqual([`check_project.py ${sb.repo}`, "check_dispatch.py units", "check_dispatch.py routing"]);
    expect(spy.bytecode()).toEqual(["1", "1", "1"]);
    spy = interposePython(sb, "garbage", "check_project.py");
    await refused("validator-failed", [], spy.env);
    expect(spy.runs()).toHaveLength(1);
    spy = interposePython(sb, "exit2", "check_dispatch.py units");
    await refused("validator-failed", [], spy.env);
    expect(spy.runs()).toHaveLength(2);
    spy = interposePython(sb, "garbage", "check_dispatch.py routing");
    await refused("validator-failed", [], spy.env);
    expect(spy.runs()).toHaveLength(3);
  });

  test("keeps units-invalid errors free of contract body markers", async () => {
    setup([{ id: "TC-0042.1", role: "CONTRACT-ROLE-MARKER" }]);
    const result = await refused("units-invalid");
    expect(JSON.stringify(result)).not.toContain("CONTRACT-ROLE-MARKER");
    writeRouting(sb, "not JSON");
    const spy = interposePython(sb);
    await refused("units-invalid", [], spy.env);
    expect(spy.runs()).toHaveLength(2);
  });

  test("validates current routing without requiring a viable candidate or approval", async () => {
    setup([{ id: "TC-0042.1", capability: "deep" }]);
    writeRouting(sb, { ...ROUTING, default: [{ harness: "codex", capability: "light" }] });
    expect((await units()).code).toBe(1);
    writeRouting(sb, "not JSON");
    await refused("routing-invalid");
    writeRouting(sb, { ...ROUTING, default: [{ harness: "missing-adapter" }] });
    await refused("harness-without-adapter");
  });

  test("refuses backend loss when matching tasks exist", async () => {
    setup();
    await launch();
    fake.script({ running: false });
    // Backend reads are allowed, effects and registry writes are not.
    const before = files(sb.stateHome);
    const r = await units();
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ units: [], tasks: [], contract: null, base: null, refusal: { code: "backend-unavailable" } });
    expect(files(sb.stateHome)).toEqual(before);
  });

  test("never waits for the project lock or stamps a task lock", async () => {
    setup();
    const record = await launch();
    patch(record, { lifecycle: "launching" });
    const projectLock = ProjectLock.tryAcquire(registry().lockPath);
    const taskLock = ProjectLock.tryAcquire(registry().taskLockPath(record.id));
    try {
      const before = files(sb.stateHome);
      const r = await units();
      expect(r.code).toBe(1);
      expect(JSON.parse(r.stdout).tasks[0]).toMatchObject({ lifecycle: "launching", interrupted: false });
      expect(files(sb.stateHome)).toEqual(before);
    } finally { taskLock?.release(); projectLock?.release(); }
    rmSync(registry().taskLockPath(record.id));
    const before = files(sb.stateHome);
    const r = await units();
    expect(JSON.parse(r.stdout).tasks[0].interrupted).toBe(true);
    expect(files(sb.stateHome)).toEqual(before);
  });

  test("reads an actual preparing dispatch and its interruption without recovery", async () => {
    setup([{ id: "TC-0042.1" }]);
    const ready = join(sb.root, "preparing.pid");
    const release = join(sb.root, "release-preparation");
    writeFileSync(join(sb.repo, "prepare.ts"), `import { existsSync, writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(ready)}, String(process.pid));\nwhile (!existsSync(${JSON.stringify(release)})) await Bun.sleep(10);\n`);
    writeFileSync(join(sb.repo, ".demerzel.json"), JSON.stringify({ schema: 1, prepare: [["bun", "prepare.ts"]] }));
    commitAll(sb, "configure slow preparation");
    const child = Bun.spawn([BIN, "dispatch", "TC-0042.1", "--json"], { cwd: sb.repo, env: fake.env as Record<string, string>, stdout: "pipe", stderr: "pipe" });
    const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    try {
      const deadline = Date.now() + 10_000;
      while (!existsSync(ready)) {
        if (Date.now() > deadline) throw new Error("preparation did not reach its barrier");
        await Bun.sleep(10);
      }
      const before = files(sb.stateHome);
      const calls = fake.calls();
      const live = await units();
      expect(live.code).toBe(0);
      expect(JSON.parse(live.stdout).tasks[0]).toMatchObject({ lifecycle: "launching", interrupted: false });
      expect(files(sb.stateHome)).toEqual(before);
      expect(fake.calls().slice(calls.length).every((args) => args[2] === "status" || (args[2] === "api" && args[3] === "snapshot"))).toBe(true);
      child.kill("SIGKILL");
      await child.exited;
      const interrupted = await units();
      expect(interrupted.code).toBe(1);
      expect(JSON.parse(interrupted.stdout).tasks[0]).toMatchObject({ lifecycle: "launching", interrupted: true });
      expect(files(sb.stateHome)).toEqual(before);
    } finally {
      writeFileSync(release, "");
      child.kill("SIGKILL");
      await child.exited;
      await output;
      if (existsSync(ready)) {
        const pid = Number(readFileSync(ready, "utf8"));
        try { process.kill(-pid, "SIGKILL"); } catch { /* The preparation group already exited. */ }
      }
    }
  }, 15_000);

  test.each([[ ["--contract"] ], [ ["--contract", "a", "--contract", "b"] ], [ ["unexpected"] ], [ ["--all"] ], [ ["--rule", "critique"] ]])("refuses invalid arguments %j", async (args) => {
    await refused("usage-invalid", args);
  });

  test("units help works without configuration or a project", async () => {
    const r = await cli(["units", "--help"], sb.env, sb.root);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("demerzel units [--contract <path>] [--json]");
  });
});
