import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// EB-05 of TC-0002: the core never depends on the herdr backend, and the
// backend never reaches the Radiant integration.

const SRC = join(import.meta.dir, "..", "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

function offenders(dir: string, pattern: RegExp): string[] {
  return files(dir).filter((path) => pattern.test(readFileSync(path, "utf8"))).map((path) => relative(SRC, path));
}

describe("module boundaries", () => {
  // Protects: src/core stays usable without herdr. Fails if a core file
  // names a module path into src/herdr.
  test("src/core does not import src/herdr", () => {
    expect(offenders(join(SRC, "core"), /["'`](?:\.\.?\/)+(?:[^"'`\n]*\/)?herdr(?:\/[^"'`\n]*)?["'`]/)).toEqual([]);
  });

  // Protects: the backend stays free of Radiant. Fails if a herdr file
  // names a module path into src/radiant or a Radiant artifact.
  test("src/herdr does not reach Radiant", () => {
    expect(offenders(join(SRC, "herdr"), /["'`](?:\.\.?\/)+(?:[^"'`\n]*\/)?radiant(?:\/[^"'`\n]*)?["'`]|\.radiant\b|radiant-units|check_project/)).toEqual([]);
  });

  // Protects: `src/herdr/run.ts` is the single place that runs the herdr
  // executable (finding S4 of the sixth verification); Git runs only from
  // `src/core/git.ts`; and, by the owner's amendment to TC-0003, python3 runs
  // only from `src/radiant/python.ts`, for the Radiant validators. Fails if
  // any other file of src/ spawns a process.
  test("processes run only from src/herdr/run.ts, src/core/git.ts and src/radiant/python.ts", () => {
    const allowed = [join("herdr", "run.ts"), join("core", "git.ts"), join("radiant", "python.ts")];
    expect(offenders(SRC, /\bspawn(?:Sync)?\s*\(|child_process/).filter((path) => !allowed.includes(path))).toEqual([]);
  });
});
