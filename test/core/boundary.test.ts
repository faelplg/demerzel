import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Verification 2 and the no-telemetry rule of the contract: the core never
// imports the Radiant integration, never names Radiant artifacts, and never
// opens a network connection.

const CORE = join(import.meta.dir, "..", "..", "src", "core");

const FORBIDDEN: Array<[string, RegExp]> = [
  ["import of src/radiant", /from\s+["'][^"']*\/radiant\//],
  [".radiant", /\.radiant\b/],
  ["radiant-units", /radiant-units/],
  ["check_project", /check_project/],
  ["fetch", /\bfetch\s*\(/],
  ["node:net", /["']node:net["']/],
  ["node:http", /["']node:https?["']/],
  ["node:dgram", /["']node:dgram["']/],
  ["Bun.connect", /Bun\.connect\b/],
];

export function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

export function violations(dir: string): string[] {
  return files(dir).flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return FORBIDDEN.filter(([, re]) => re.test(text)).map(([what]) => `${relative(dir, path)}: ${what}`);
  });
}

describe("verification 2: boundary of src/core", () => {
  // Protects: the core stays free of Radiant and of network access. Fails
  // if any file in src/core imports src/radiant, cites .radiant,
  // radiant-units or check_project, or uses a network API.
  test("no forbidden import, term or network API", () => {
    expect(files(CORE).length).toBeGreaterThan(5);
    expect(violations(CORE)).toEqual([]);
  });
});
