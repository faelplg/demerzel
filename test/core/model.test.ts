import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../src/core/config.ts";
import { git } from "../../src/core/git.ts";
import { agentName, resolveProject } from "../../src/core/project.ts";
import { buildRequest, overlaps, parseTask, segments } from "../../src/core/task.ts";
import { sandbox, task, type Sandbox } from "./helpers/sandbox.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

describe("writes (R2, Spec 2.1)", () => {
  // Protects: overlap by segments, case-sensitive. Fails if a raw prefix
  // compare returns, or equality alone is used.
  test.each([
    ["src/", "src/a.ts", true],
    ["src", "src/a.ts", true],
    ["src/a.ts", "src/a.ts", true],
    ["src", "src-old/", false],
    ["src/a", "src/ab", false],
    ["Src/", "src/", false],
    ["docs/x.md", "src/", false],
  ])("%s against %s overlaps: %p", (a, b, want) => {
    expect(overlaps(a, b)).toBe(want);
    expect(overlaps(b, a)).toBe(want);
  });

  // Protects: the path rule. Fails if an absolute, empty-segment, dot or
  // dot-dot path is accepted.
  test.each(["/abs", "", "a//b", "./a", "a/./b", "a/../b", "..", "a\nb"])("rejects %j", (path) => {
    expect(segments(path)).toBeNull();
  });

  test("a trailing slash does not change the comparison", () => {
    expect(segments("src/")).toEqual(["src"]);
  });
});

describe("IDs and agent names (R8, R9)", () => {
  // Protects: distinct agent names for IDs that differ only in case or
  // punctuation. Fails if the name drops the hash or folds case.
  test("agent names differ for TC-1.a, tc-1.A, TC-1_a and TC-1-a", () => {
    const names = ["TC-1.a", "tc-1.A", "TC-1_a", "TC-1-a"].map((id) => agentName("demerzel-abc", id));
    expect(new Set(names).size).toBe(4);
    for (const name of names) expect(name).toMatch(/^dz-[0-9a-f]{16}$/);
  });

  test("task ID format", () => {
    expect(parseTask(task({ id: "TC-0001.1" })).ok).toBe(true);
    expect(parseTask(task({ id: "a".repeat(65) })).ok).toBe(false);
    expect(parseTask(task({ id: ".x" })).ok).toBe(false);
  });

  // Protects: Request rules of Spec 2.2. Fails if a bad label, ref or role
  // is accepted.
  test("request rules", () => {
    const bad = [
      { role: "Dev", pointers: [] },
      { role: "dev", pointers: [{ label: "Bad", path: "x" }] },
      { role: "dev", pointers: [{ label: "r", ref: "abc" }] },
      { role: "dev", pointers: [{ label: "p", path: "a", ref: "b" }] },
      { role: "dev", pointers: [{ label: "p", path: "a" }, { label: "p", path: "b" }] },
    ];
    for (const request of bad) expect(parseTask(task({ request })).ok).toBe(false);
    expect(parseTask(task({ request: { role: "dev", pointers: [{ label: "r", ref: "a".repeat(40) }] } })).ok).toBe(true);
  });

  test("request text holds only the fixed text, ID, role, pointers and return path", () => {
    const parsed = parseTask(task());
    if (!parsed.ok) throw new Error(parsed.message);
    expect(buildRequest(parsed.task)).toBe(
      [
        "Demerzel: tarefa TC-0099.1.",
        "Papel: radiant-dev.",
        "Leia os pointers abaixo e execute a tarefa no papel indicado.",
        "Grave o retorno em .radiant/reports/TC-0099.1.md, relativo à raiz deste worktree.",
        "Pointers:",
        "- contract: docs/contract.md",
        "",
      ].join("\n"),
    );
  });
});

describe("configuration (R3, Spec 2.4)", () => {
  function write(content: string): void {
    mkdirSync(join(sb.configHome, "demerzel"), { recursive: true });
    writeFileSync(join(sb.configHome, "demerzel", "config.json"), content);
  }
  // Protects: schema, known keys, defaults. Fails if an unknown key or a
  // wrong schema passes, or a missing file is an error.
  test("missing file uses the defaults", () => {
    expect(loadConfig(sb.env)).toEqual({ ok: true, config: { schema: 1, herdr: null, radiant: null } });
  });
  test.each([
    ["{}", false],
    ['{"schema": 2}', false],
    ['{"schema": 1, "other": 1}', false],
    ['{"schema": 1, "herdr": "lab"}', false],
    ["not json", false],
    ['{"schema": 1, "herdr": {"session": "lab"}, "radiant": {"root": "/x"}}', true],
  ])("%s ok: %p", (content, ok) => {
    write(content);
    expect(loadConfig(sb.env).ok).toBe(ok);
  });
});

describe("registry key (R4, Spec 2.3)", () => {
  // Protects: an orchestrator in a linked worktree sees the main checkout's
  // registry. Fails if the key comes from the caller's toplevel.
  test("a linked worktree resolves to the same project", () => {
    const linked = join(sb.root, "linked");
    git(sb.repo, ["worktree", "add", "-q", "-b", "side", linked], sb.env);
    const main = resolveProject(sb.repo, sb.env);
    const side = resolveProject(linked, sb.env);
    expect(side?.key).toBe(main?.key ?? "missing");
    expect(side?.dir).toBe(main?.dir ?? "missing");
    expect(side?.callerRoot).toBe(linked);
    expect(main?.dir.startsWith(join(sb.stateHome, "demerzel", "projects", "project-"))).toBe(true);
  });

  test("outside Git there is no project", () => {
    expect(resolveProject(sb.root, sb.env)).toBeNull();
  });
});
