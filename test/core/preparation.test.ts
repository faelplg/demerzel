import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dispatch } from "../../src/core/index.ts";
import { git } from "../../src/core/git.ts";
import { resolveProject } from "../../src/core/project.ts";
import { readProjectConfig } from "../../src/core/project-config.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { alive, prepareFixture, readJson, type PrepareFixture } from "./helpers/prepare-fixture.ts";
import { spawnChild } from "./helpers/processes.ts";
import { backend, context, sandbox, task, type Sandbox } from "./helpers/sandbox.ts";

// TC-0004, Spec 2.6: the project's preparation, with the fake backend.

let sb: Sandbox;
let fx: PrepareFixture;
beforeEach(() => {
  sb = sandbox();
  fx = prepareFixture(sb);
});
afterEach(() => sb.cleanup());

const registryDir = (): string => resolveProject(sb.repo, sb.env)?.dir ?? "";
const record = (id = "TC-0099.1"): TaskRecord => JSON.parse(readFileSync(join(registryDir(), "tasks", `${id}.json`), "utf8")) as TaskRecord;
const worktree = (id = "TC-0099.1"): string => join(registryDir(), "worktrees", id);
const logOf = (id = "TC-0099.1"): string => join(registryDir(), "logs", id, "prepare.log");
const prep = (overrides: Record<string, unknown> = {}) => task({ base: fx.base, ...overrides });

describe("the project file (F1 to F5)", () => {
  // Protects: F1, the file comes from the base commit, never from the
  // working tree. Fails if `.demerzel.json` is read from the main checkout.
  test("read from the base commit, not the working tree", async () => {
    fx.commit({ schema: 1, prepare: [["bun", "prep/record.ts", "from-commit"]] });
    // The main checkout holds another file, uncommitted.
    writeFileSync(join(sb.repo, ".demerzel.json"), JSON.stringify({ schema: 1, prepare: [["bun", "prep/record.ts", "from-working-tree"]] }));
    const d = await dispatch({ task: prep(), humanApproved: false }, context(sb, backend(sb)));
    expect(d.code).toBe(0);
    expect(existsSync(join(worktree(), "prepared", "from-commit.json"))).toBe(true);
    expect(existsSync(join(worktree(), "prepared", "from-working-tree.json"))).toBe(false);
  });

  // Protects: F1 and F3, no file, a file without `prepare` and an empty
  // list run nothing and write no log, and the task launches as before.
  // Fails if any of them runs a command or refuses.
  test("absent, without prepare, and empty", async () => {
    const cases: Array<[string, unknown, boolean]> = [
      ["TC-0099.1", undefined, false],
      ["TC-0099.2", { schema: 1 }, true],
      ["TC-0099.3", { schema: 1, prepare: [] }, true],
    ];
    for (const [id, config, present] of cases) {
      const commit = fx.commit(config);
      const be = backend(sb);
      const d = await dispatch({ task: prep({ id, base: commit, writes: [`src/${id}/`] }), humanApproved: false }, context(sb, be));
      expect(d.code, id).toBe(0);
      const r = record(id);
      expect(r.project_preparation, id).toMatchObject({ file: ".demerzel.json", commit, present, commands: [], prepare_started_at: null, log: null, outcome: null });
      expect(existsSync(logOf(id)), id).toBe(false);
      expect(r.history.map((h) => h.event), id).not.toContain("prepare-started");
    }
  });

  // Protects: F2, every rule of Spec 2.6 broken is project-config-invalid,
  // exit 2, with no effect, and the message names the file, the commit and
  // the rule, never a value from the file. Fails if a bad file passes, is
  // treated as absent, or leaks its content.
  const SECRET = "VALUE-FROM-FILE-91c2";
  const BAD: Array<[string, string, string]> = [
    ["not JSON", `{"schema": 1, "prepare": [["${SECRET}"`, "not JSON"],
    ["not an object", JSON.stringify([SECRET]), "JSON object"],
    ["schema 2", JSON.stringify({ schema: 2, prepare: [[SECRET]] }), "schema must be exactly 1"],
    ["schema as a string", JSON.stringify({ schema: "1" }), "schema must be exactly 1"],
    ["no schema", JSON.stringify({ prepare: [[SECRET]] }), "schema must be exactly 1"],
    ["an unknown key", JSON.stringify({ schema: 1, [SECRET]: true }), "only the keys schema and prepare"],
    ["prepare not a list", JSON.stringify({ schema: 1, prepare: SECRET }), "prepare must be a list"],
    ["a command not a list", JSON.stringify({ schema: 1, prepare: [SECRET] }), "prepare[0] must be a non-empty list"],
    ["an empty command", JSON.stringify({ schema: 1, prepare: [[]] }), "prepare[0] must be a non-empty list"],
    ["a non-string argument", JSON.stringify({ schema: 1, prepare: [["bun", 7]] }), "prepare[0][1] must be a string"],
    ["an empty string", JSON.stringify({ schema: 1, prepare: [["bun", ""]] }), "prepare[0][1] must not be empty"],
    ["a NUL", JSON.stringify({ schema: 1, prepare: [["bun", `${SECRET}\u0000x`]] }), "prepare[0][1] must not hold a NUL"],
    ["null prepare", JSON.stringify({ schema: 1, prepare: null }), "prepare must be a list"],
  ];
  for (const [name, content, rule] of BAD) {
    test(`project-config-invalid: ${name}`, async () => {
      const commit = fx.commit(content);
      const be = backend(sb);
      const git0 = sb.gitState();
      const d = await dispatch({ task: prep({ base: commit }), humanApproved: false }, context(sb, be));
      expect(d.code).toBe(2);
      expect(d.envelope.refusal?.code).toBe("project-config-invalid");
      const message = d.envelope.refusal?.message ?? "";
      expect(message).toContain(".demerzel.json");
      expect(message).toContain(commit);
      expect(message).toContain(rule);
      expect(message).not.toContain(SECRET);
      expect(sb.tasksSnapshot()).toEqual({});
      expect(sb.gitState()).toBe(git0);
      expect(be.effectCalls()).toEqual([]);
    });
  }

  // Protects: F4, an entry that is not a regular file is refused, never
  // taken as absent: a symlink, a directory and a submodule. Fails if any of
  // them skips the preparation.
  test("a symlink, a directory and a submodule entry", async () => {
    const scratch = join(sb.root, "fixture-wt");
    const sg = (...args: string[]): string => {
      const r = git(scratch, args, sb.env);
      if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout;
    };
    const commitAll = (message: string): string => {
      sg("add", "-A");
      sg("commit", "-q", "-m", message);
      return sg("rev-parse", "HEAD");
    };
    const entries: Array<[string, () => string]> = [
      ["symlink", () => {
        writeFileSync(join(scratch, "real.json"), JSON.stringify({ schema: 1 }));
        symlinkSync("real.json", join(scratch, ".demerzel.json"));
        return commitAll("symlink entry");
      }],
      ["directory", () => {
        sg("rm", "-q", ".demerzel.json");
        mkdirSync(join(scratch, ".demerzel.json"));
        writeFileSync(join(scratch, ".demerzel.json", "inner"), "{}");
        return commitAll("directory entry");
      }],
      ["submodule", () => {
        sg("rm", "-r", "-q", ".demerzel.json");
        const sha = sg("rev-parse", "main");
        sg("update-index", "--add", "--cacheinfo", `160000,${sha},.demerzel.json`);
        sg("commit", "-q", "-m", "submodule entry");
        return sg("rev-parse", "HEAD");
      }],
    ];
    let n = 0;
    for (const [kind, make] of entries) {
      n++;
      const commit = make();
      const mode = git(sb.repo, ["ls-tree", commit, ".demerzel.json"], sb.env).stdout.split(" ")[0];
      expect(mode, kind).toBe(kind === "symlink" ? "120000" : kind === "directory" ? "040000" : "160000");
      const be = backend(sb);
      const d = await dispatch({ task: prep({ id: `TC-0099.${n}`, base: commit, writes: [`src/${n}/`] }), humanApproved: false }, context(sb, be));
      expect(d.envelope.refusal?.code, kind).toBe("project-config-invalid");
      expect(d.envelope.refusal?.message, kind).toContain("not a regular file");
      expect(sb.tasksSnapshot(), kind).toEqual({});
      expect(be.effectCalls(), kind).toEqual([]);
    }
  });

  // Protects: F4, a Git error reading the blob or the tree is a refusal,
  // never an absent file. Fails if an unreadable object skips the
  // preparation.
  test("an unreadable blob and an unreadable tree", async () => {
    const commit = fx.commit({ schema: 1, prepare: [["bun", "prep/record.ts", "x"]] });
    const blob = git(sb.repo, ["rev-parse", `${commit}:.demerzel.json`], sb.env).stdout;
    const objects = git(sb.repo, ["rev-parse", "--git-path", "objects"], sb.env).stdout;
    rmSync(join(sb.repo, objects, blob.slice(0, 2), blob.slice(2)));
    const be = backend(sb);
    const d = await dispatch({ task: prep({ base: commit }), humanApproved: false }, context(sb, be));
    expect(d.envelope.refusal?.code).toBe("project-config-invalid");
    expect(d.envelope.refusal?.message).toContain("could not read the file's blob");
    expect(sb.tasksSnapshot()).toEqual({});
    expect(be.effectCalls()).toEqual([]);

    // The tree: the reader alone, since the dispatch checks before it read
    // the same tree.
    const tree = git(sb.repo, ["rev-parse", `${commit}^{tree}`], sb.env).stdout;
    rmSync(join(sb.repo, objects, tree.slice(0, 2), tree.slice(2)));
    const r = readProjectConfig(sb.repo, commit, sb.env);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.message).toContain("could not read the commit's tree");
  });

  // Protects: F5, the commands and their commit are in `recorded`, before
  // the first effect, and nothing reads the file again for that task: a
  // recovery after the base branch changed keeps what was recorded. Fails if
  // the commands are recorded late or read again.
  test("recorded before the first effect and never read again", async () => {
    const commit = fx.commit({ schema: 1, prepare: [["bun", "prep/record.ts", "first"]] });
    let atRecorded: TaskRecord["project_preparation"] | null = null;
    const be = backend(sb, {}, join(sb.root, "fake.json"));
    const child = spawnChild(sb, join(sb.root, "fake.json"), { name: "k", command: "dispatch", input: prep({ base: commit }), killOn: "wrote:launching" });
    await child.proc.exited;
    atRecorded = record().project_preparation ?? null;
    expect(atRecorded).toMatchObject({ commit, commands: [["bun", "prep/record.ts", "first"]], prepare_started_at: null });
    expect(be.effectCalls()).toEqual([]);

    fx.commit({ schema: 2 });
    const other = await dispatch({ task: task({ id: "TC-0099.2", writes: ["src/other/"] }), humanApproved: false }, context(sb, be));
    expect(other.code).toBe(0);
    expect(record().lifecycle).toBe("launch-failed");
    expect(record().project_preparation).toEqual(atRecorded ?? undefined);
  });
});

describe("worktree created by the core (W1, W5)", () => {
  // Protects: W1, the worktree and then the preparation come after
  // `launching` and before any backend effect, in both harnesses, and the
  // worktree is in `created` as soon as it exists. Fails if the backend
  // creates the worktree, or the preparation runs after the session opens.
  for (const harness of ["codex", "claude-code"]) {
    test(`order of effects, ${harness}`, async () => {
      fx.commit({ schema: 1, prepare: [["bun", "prep/record.ts", "order"]] });
      const be = backend(sb);
      const seen: string[] = [];
      const ctx = context(sb, be, {
        trace: (event) => {
          if (!event.startsWith("wrote:") && event !== "prepare-ran") return;
          seen.push(`${event}@${be.effectCalls().length}`);
          if (event === "wrote:created:worktree") expect(existsSync(worktree())).toBe(true);
          if (event === "wrote:prepare-started") expect(record().created.map((c) => c.kind)).toEqual(["worktree"]);
        },
      });
      const d = await dispatch({ task: prep({ harness }), humanApproved: false }, ctx);
      expect(d.code).toBe(0);
      expect(seen).toEqual([
        "wrote:recorded@0",
        "wrote:launching@0",
        "wrote:created:worktree@0",
        "wrote:prepare-started@0",
        "wrote:prepare-command:1@0",
        "prepare-ran@0",
        "wrote:prepared@0",
        "wrote:created:workspace@1",
        "wrote:created:tab@1",
        "wrote:created:pane@1",
        "wrote:created:agent@1",
        "wrote:send-started@1",
        "wrote:launched@2",
      ]);
      expect(existsSync(join(worktree(), "prepared", "order.json"))).toBe(true);
    });
  }

  // Protects: W5, creating the worktree runs no Git hook, in both harness
  // paths, whether the hook sits in .git/hooks or in a configured
  // core.hooksPath. Fails if `git worktree add` runs without the empty
  // core.hooksPath.
  for (const harness of ["codex", "claude-code"]) {
    test(`no post-checkout hook, ${harness}`, async () => {
      const marker = join(sb.root, `hook-ran-${harness}`);
      const hook = `#!/bin/sh\n: > '${marker}'\n`;
      const hooksDir = join(sb.repo, git(sb.repo, ["rev-parse", "--git-path", "hooks"], sb.env).stdout);
      mkdirSync(hooksDir, { recursive: true });
      writeFileSync(join(hooksDir, "post-checkout"), hook, { mode: 0o755 });
      const custom = join(sb.root, "custom-hooks");
      mkdirSync(custom, { recursive: true });
      writeFileSync(join(custom, "post-checkout"), hook, { mode: 0o755 });
      // The hook works: a plain checkout in the project runs it.
      expect(git(sb.repo, ["worktree", "add", "-q", "-b", "probe-hook", join(sb.root, "probe-hook"), "main"], sb.env).code).toBe(0);
      expect(existsSync(marker)).toBe(true);
      rmSync(marker);
      fx.commit({ schema: 1, prepare: [["bun", "prep/record.ts", "hook"]] });
      const d = await dispatch({ task: prep({ harness }), humanApproved: false }, context(sb, backend(sb)));
      expect(d.code).toBe(0);
      expect(existsSync(marker)).toBe(false);

      expect(git(sb.repo, ["config", "core.hooksPath", custom], sb.env).code).toBe(0);
      const d2 = await dispatch({ task: prep({ id: "TC-0099.2", harness, writes: ["src/two/"] }), humanApproved: false }, context(sb, backend(sb)));
      expect(d2.code).toBe(0);
      expect(existsSync(marker)).toBe(false);
    });
  }

  // Protects: W1, the folder given to Git as core.hooksPath is new and
  // empty at each worktree creation, so a hook left in the registry, as in
  // a folder an earlier version reused, never runs. Fails if a shared
  // folder that already exists is reused.
  test("no hook from a folder left in the registry", async () => {
    const marker = join(sb.root, "stale-hook-ran");
    fx.commit({ schema: 1, prepare: [["bun", "prep/record.ts", "stale"]] });
    expect((await dispatch({ task: prep(), humanApproved: false }, context(sb, backend(sb)))).code).toBe(0);
    for (const name of ["no-hooks", ...readdirSync(registryDir()).filter((n) => n.startsWith("no-hooks"))]) {
      mkdirSync(join(registryDir(), name), { recursive: true });
      writeFileSync(join(registryDir(), name, "post-checkout"), `#!/bin/sh\n: > '${marker}'\n`, { mode: 0o755 });
    }
    const d = await dispatch({ task: prep({ id: "TC-0099.2", writes: ["src/two/"] }), humanApproved: false }, context(sb, backend(sb)));
    expect(d.code).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("running the preparation (P1 to P9)", () => {
  // Protects: P1, P2, P3 and P7. The commands run in order in the worktree,
  // with stdin from /dev/null, Demerzel's environment and no shell; a
  // program with a / is found from the worktree and one without on PATH;
  // the output goes, in order, to the log with one header per command; and
  // each command's result is recorded. Fails if a shell expands an
  // argument, the cwd or stdin differ, or the log loses a command.
  test("argv, cwd, stdin, environment, log and results", async () => {
    const commit = fx.commit({
      schema: 1,
      prepare: [
        ["bun", "prep/record.ts", "one", "a b", "$HOME", ";", "x;y", "`id`"],
        ["./prep/relative.sh"],
        ["bun", "prep/record.ts", "three"],
      ],
    });
    // The program with a / does not exist in the main checkout.
    expect(existsSync(join(sb.repo, "prep", "relative.sh"))).toBe(false);
    const be = backend(sb);
    const d = await dispatch({ task: prep({ base: commit }), humanApproved: false }, context(sb, be, { env: { ...sb.env, DZ_PREP_MARK: "from-demerzel" } }));
    expect(d.code).toBe(0);
    const one = readJson(join(worktree(), "prepared", "one.json"));
    expect(one["argv"]).toEqual(["a b", "$HOME", ";", "x;y", "`id`"]);
    expect(one["cwd"]).toBe(worktree());
    expect(one["stdinNull"]).toBe(true);
    expect(one["mark"]).toBe("from-demerzel");
    expect(existsSync(join(worktree(), "relative-ran"))).toBe(true);
    expect(existsSync(join(worktree(), "prepared", "three.json"))).toBe(true);

    const log = readFileSync(logOf(), "utf8");
    const lines = log.split("\n").filter(Boolean);
    expect(lines[0]).toStartWith("[demerzel] command 1 of 3: ");
    expect(lines.indexOf("OUT-one")).toBeGreaterThan(0);
    expect(lines.indexOf("ERR-one")).toBeGreaterThan(0);
    const header2 = lines.findIndex((l) => l.startsWith("[demerzel] command 2 of 3"));
    const header3 = lines.findIndex((l) => l.startsWith("[demerzel] command 3 of 3"));
    expect(header2).toBeGreaterThan(lines.indexOf("ERR-one"));
    expect(header3).toBeGreaterThan(header2);
    expect(lines.indexOf("OUT-three")).toBeGreaterThan(header3);

    const p = record().project_preparation;
    expect(p?.outcome).toBe("succeeded");
    expect(p?.log).toBe(logOf());
    expect(p?.prepare_started_at).not.toBeNull();
    expect(p?.results.map((r) => [r.index, r.program, r.exit_code, r.signal, r.failure])).toEqual([
      [1, "bun", 0, null, null],
      [2, "./prep/relative.sh", 0, null, null],
      [3, "bun", 0, null, null],
    ]);
    for (const r of p?.results ?? []) expect(r.duration_ms).toBeGreaterThanOrEqual(0);
    // Readback: the record says where the effects happened.
    expect(record().created.map((c) => c.kind)).toEqual(["worktree", "workspace", "tab", "pane", "agent"]);
  });

  // Protects: P3, nothing of the preparation reaches Demerzel's own stdout
  // or stderr. Fails if a command inherits them.
  test("no output on Demerzel's own streams", async () => {
    fx.commit({ schema: 1, prepare: [["bun", "prep/record.ts", "quiet"]] });
    const stateFile = join(sb.root, "fake.json");
    backend(sb, {}, stateFile);
    const child = spawnChild(sb, stateFile, { name: "q", command: "dispatch", input: prep() });
    await child.proc.exited;
    const out = await new Response(child.proc.stdout as ReadableStream).text();
    const err = await new Response(child.proc.stderr as ReadableStream).text();
    expect(child.result()?.code).toBe(0);
    expect(out + err).not.toContain("OUT-quiet");
    expect(out + err).not.toContain("ERR-quiet");
    expect(readFileSync(logOf(), "utf8")).toContain("OUT-quiet");
  });

  // Protects: P4 and P6, the first command that exits non-zero, is ended by
  // a signal or cannot start stops the preparation; the task ends in
  // launch-failed with branch and worktree in `created`, no backend effect,
  // exit 1, and a reason with the index, the program, how it ended and the
  // log path, never the log's content. Fails if a later command runs, the
  // session opens, or the log is copied into the reason.
  const FAILING: Array<[string, string[], string]> = [
    ["a non-zero exit", ["bun", "prep/exit.ts", "3"], "preparation command 2 (bun) exited with 3"],
    ["a signal", ["bun", "prep/signal.ts"], "preparation command 2 (bun) was ended by signal SIGKILL"],
    ["a program that cannot start", ["./prep/missing-program"], "preparation command 2 (./prep/missing-program) could not start (ENOENT)"],
  ];
  for (const harness of ["codex", "claude-code"]) {
    for (const [name, command, said] of FAILING) {
      test(`${name} stops the preparation, ${harness}`, async () => {
        fx.commit({ schema: 1, prepare: [["bun", "prep/record.ts", "before"], command, ["bun", "prep/record.ts", "after"]] });
        const be = backend(sb);
        const d = await dispatch({ task: prep({ harness }), humanApproved: false }, context(sb, be));
        expect(d.code).toBe(1);
        expect(d.envelope.tasks[0]?.lifecycle).toBe("launch-failed");
        const reason = d.envelope.tasks[0]?.launch_error ?? "";
        expect(reason).toContain(said);
        expect(reason).toContain(`log: ${logOf()}`);
        expect(reason).not.toContain("LOG-CONTENT-7f3a");
        expect(reason).not.toContain("OUT-before");
        expect(be.effectCalls()).toEqual([]);
        expect(existsSync(join(worktree(), "prepared", "before.json"))).toBe(true);
        expect(existsSync(join(worktree(), "prepared", "after.json"))).toBe(false);
        const r = record();
        expect(r.lifecycle).toBe("launch-failed");
        expect(r.created).toEqual([{ kind: "worktree", path: worktree(), branch: "radiant/TC-0099.1" }]);
        expect(r.project_preparation?.outcome).toBe("failed");
        expect(r.project_preparation?.reason).toBe(reason);
        expect(r.history.at(-1)?.detail?.["reason"]).toBe(reason);
        expect(git(sb.repo, ["rev-parse", "--verify", "--quiet", "refs/heads/radiant/TC-0099.1"], sb.env).code).toBe(0);
      });
    }
  }

  // Protects: P8, a command whose leader exits 0 while a child keeps
  // running fails with "left processes running"; the child is gone after
  // the grace period and the next command does not run. Fails if the
  // leader's exit alone ends the command.
  test("a child left running", async () => {
    const pidfile = join(sb.root, "left.pid");
    fx.commit({ schema: 1, prepare: [["bun", "prep/leave-child.ts", pidfile], ["bun", "prep/record.ts", "after"]] });
    const be = backend(sb);
    const d = await dispatch({ task: prep(), humanApproved: false }, context(sb, be, { prepareGraceMs: 300 }));
    expect(d.code).toBe(1);
    expect(d.envelope.tasks[0]?.launch_error).toContain("preparation command 1 (bun) left processes running");
    const pid = Number(readFileSync(pidfile, "utf8"));
    expect(alive(pid)).toBe(false);
    expect(existsSync(join(worktree(), "prepared", "after.json"))).toBe(false);
    expect(be.effectCalls()).toEqual([]);
  });

  // Protects: P5, past the limit the whole group gets SIGTERM and, after
  // the grace period, SIGKILL, so a child that ignores SIGTERM is gone too;
  // the preparation fails with the time limit, and the identity check does
  // not run. Fails if only the leader is killed, or SIGKILL never comes.
  test("the time limit with a child that ignores SIGTERM", async () => {
    const pidfile = join(sb.root, "stubborn.pid");
    fx.commit({ schema: 1, prepare: [["bun", "prep/leave-child.ts", pidfile, "ignore", "stay"], ["bun", "prep/record.ts", "after"]] });
    const be = backend(sb);
    const started = Date.now();
    const d = await dispatch({ task: prep(), humanApproved: false }, context(sb, be, { prepareLimitMs: 1_500, prepareGraceMs: 400 }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_500);
    expect(d.code).toBe(1);
    const reason = d.envelope.tasks[0]?.launch_error ?? "";
    expect(reason).toContain("preparation command 1 (bun) passed the time limit");
    expect(reason).not.toContain("identity");
    const pid = Number(readFileSync(pidfile, "utf8"));
    expect(alive(pid)).toBe(false);
    expect(existsSync(join(worktree(), "prepared", "after.json"))).toBe(false);
    expect(be.effectCalls()).toEqual([]);
  });

  // Protects: P5 and P8, the limit also bounds the wait for a command's
  // group after its leader exits: a command whose group is still not empty
  // at the limit fails with the time limit, and no later command starts.
  // Fails if that wait runs past the limit, so the command counts as done
  // when its last child leaves after the limit and the next one starts.
  test("the limit during the wait for an empty group", async () => {
    const release = join(sb.root, "release");
    const pidfile = join(sb.root, "waiter.pid");
    fx.commit({ schema: 1, prepare: [["bun", "prep/leave-waiter.ts", release, pidfile], ["bun", "prep/record.ts", "after"]] });
    // The child leaves after the limit and well inside the wait for its
    // group, which the test makes long so the timing has wide margins.
    const timer = setTimeout(() => writeFileSync(release, ""), 1_600);
    const d = await dispatch(
      { task: prep(), humanApproved: false },
      context(sb, backend(sb), { prepareLimitMs: 800, prepareGraceMs: 200, prepareSettleMs: 4_000 }),
    );
    clearTimeout(timer);
    expect(d.code).toBe(1);
    expect(d.envelope.tasks[0]?.launch_error).toContain("preparation command 1 (bun) passed the time limit");
    expect(record().project_preparation?.results.map((r) => r.index)).toEqual([1]);
    expect(existsSync(join(worktree(), "prepared", "after.json"))).toBe(false);
    expect(alive(Number(readFileSync(pidfile, "utf8")))).toBe(false);
  });

  // Protects: P5 and P8, no command starts once the limit has passed: the
  // preparation fails with the time limit before spawning it, so no
  // process group is recorded. Fails if a command is spawned after the
  // limit and only then stopped by its own timer.
  test("no command starts after the limit", async () => {
    fx.commit({ schema: 1, prepare: [["bun", "prep/record.ts", "late"]] });
    const d = await dispatch({ task: prep(), humanApproved: false }, context(sb, backend(sb), { prepareLimitMs: 0, prepareGraceMs: 200 }));
    expect(d.code).toBe(1);
    expect(d.envelope.tasks[0]?.launch_error).toContain("preparation command 1 (bun) was not started: the time limit");
    expect(record().project_preparation?.process_group).toBeNull();
    expect(record().history.some((h) => h.event === "prepare-command")).toBe(false);
  });

  // Protects: P8, the limit counts all commands together: two commands
  // that each fit the limit but not together fail it on the second. Fails
  // if the limit restarts for each command.
  test("the limit across commands", async () => {
    fx.commit({ schema: 1, prepare: [["bun", "prep/sleep.ts", "900"], ["bun", "prep/sleep.ts", "900"]] });
    const d = await dispatch({ task: prep(), humanApproved: false }, context(sb, backend(sb), { prepareLimitMs: 1_400, prepareGraceMs: 200 }));
    expect(d.code).toBe(1);
    expect(d.envelope.tasks[0]?.launch_error).toContain("preparation command 2 (bun) passed the time limit");
    expect(record().project_preparation?.results.map((r) => r.failure)).toEqual([null, expect.stringContaining("time limit")]);
  });

  // Protects: P9, a preparation that commits, switches the branch or
  // detaches HEAD fails the identity check before any session effect, in
  // both harnesses, with the invariant and the commits in the reason;
  // untracked and ignored files pass. Fails if the check is skipped.
  const BREAKS: Array<[string, string[][], string]> = [
    ["a commit", [["git", "commit", "-q", "--allow-empty", "-m", "moved"]], "moved off the base commit"],
    ["a branch switch", [["git", "checkout", "-q", "-b", "elsewhere"]], "HEAD is on refs/heads/elsewhere at "],
    ["a detached HEAD", [["git", "checkout", "-q", "--detach"]], "HEAD is detached"],
  ];
  for (const harness of ["codex", "claude-code"]) {
    for (const [name, commands, said] of BREAKS) {
      test(`identity: ${name}, ${harness}`, async () => {
        const base = fx.commit({ schema: 1, prepare: commands });
        const be = backend(sb);
        const d = await dispatch({ task: prep({ harness, base }), humanApproved: false }, context(sb, be));
        expect(d.code).toBe(1);
        const reason = d.envelope.tasks[0]?.launch_error ?? "";
        expect(reason).toContain("the preparation broke the task's identity");
        expect(reason).toContain(said);
        expect(reason).toContain(base);
        expect(reason).toContain(`log: ${logOf()}`);
        expect(reason).not.toContain("preparation command");
        expect(be.effectCalls()).toEqual([]);
        expect(record().created.map((c) => c.kind)).toEqual(["worktree"]);
      });
    }
  }

  test("untracked and ignored files keep the identity", async () => {
    fx.commit({ schema: 1, prepare: [["bun", "prep/record.ts", "untracked"], ["git", "init", "-q", "ignored-deps/pkg"]] });
    const d = await dispatch({ task: prep(), humanApproved: false }, context(sb, backend(sb)));
    expect(d.code).toBe(0);
    expect(readdirSync(join(worktree(), "ignored-deps"))).toEqual(["pkg"]);
  });
});
