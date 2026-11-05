import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { route, type Adapter, type RouteInput } from "../../src/radiant/index.ts";
import { backend, sandbox, type Sandbox } from "../core/helpers/sandbox.ts";
import { attempt, radiantFiles, radiantRoot, ready, writeRouting } from "./helpers/fixture.ts";

// TC-0003, I8: the routing of Spec 3, item 6. At the pin no adapter declares
// `provides`, so a candidate that covers `requires` and wins is proven only
// on the pure function, with data in memory (contract, section 9).

const ORDER = ["deep", "standard", "light"];
const models = (h: string): Record<string, string> => ({ deep: `${h}-deep`, standard: `${h}-standard`, light: `${h}-light` });
const adapters = new Map<string, Adapter>([
  ["claude-code", { models: models("claude"), provides: [] }],
  ["codex", { models: models("codex"), provides: ["browser"] }],
  ["gemini", { models: { deep: "gemini-deep" }, provides: ["browser"] }],
]);

function input(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    candidates: [{ harness: "claude-code", capability: null, effort: null }],
    unit: { capability: null, requires: [] },
    roleDefault: "standard",
    order: ORDER,
    adapters,
    supports: () => true,
    ...overrides,
  };
}

describe("the routing function, in memory", () => {
  // Protects: a candidate that covers requires wins after one that does
  // not. Fails if provides is ignored or the order of candidates is lost.
  test("a candidate covering requires wins after a discarded one", () => {
    const r = route(input({ unit: { capability: null, requires: ["browser"] }, candidates: [{ harness: "claude-code", capability: null, effort: null }, { harness: "codex", capability: null, effort: "high" }] }));
    expect(r).toEqual({ ok: true, harness: "codex", model: "codex-standard", effort: "high", capability: "standard", floor: "standard" });
  });

  // Protects: the floor is the unit's capability, else the role default,
  // resolved before the candidates; the effective capability is the
  // candidate's, else the floor. Fails if any of these is swapped.
  test("floor and effective capability", () => {
    expect(route(input({ roleDefault: "deep" }))).toMatchObject({ ok: true, capability: "deep", floor: "deep", model: "claude-deep" });
    expect(route(input({ unit: { capability: "light", requires: [] }, roleDefault: "deep" }))).toMatchObject({ ok: true, capability: "light", floor: "light" });
    expect(route(input({ candidates: [{ harness: "claude-code", capability: "deep", effort: null }] }))).toMatchObject({ ok: true, capability: "deep", floor: "standard", model: "claude-deep" });
  });

  // Protects: no downgrade: a candidate below the floor is not viable, and
  // the refusal is hold when one failed only by capability. Fails if a
  // lower candidate is taken or hold is wrong.
  test("below the floor, with and without hold", () => {
    const low = route(input({ roleDefault: "deep", candidates: [{ harness: "claude-code", capability: "light", effort: null }] }));
    expect(low).toMatchObject({ ok: false, hold: true });
    const provides = route(input({ unit: { capability: null, requires: ["computer-use"] } }));
    expect(provides).toMatchObject({ ok: false, hold: false });
    const mixed = route(input({ unit: { capability: "deep", requires: ["browser"] }, candidates: [{ harness: "claude-code", capability: null, effort: null }, { harness: "codex", capability: "light", effort: null }] }));
    expect(mixed).toMatchObject({ ok: false, hold: true });
    if (!mixed.ok) expect(mixed.reasons).toHaveLength(2);
  });

  // Protects: a candidate the backend does not launch, or without an
  // adapter, is discarded and the next one is tried. Fails if the first
  // candidate wins regardless.
  test("backend support and adapter", () => {
    const r = route(input({ supports: (h) => h !== "claude-code", candidates: [{ harness: "claude-code", capability: null, effort: null }, { harness: "codex", capability: null, effort: null }] }));
    expect(r).toMatchObject({ ok: true, harness: "codex" });
    expect(route(input({ candidates: [{ harness: "nenhum", capability: null, effort: null }] }))).toMatchObject({ ok: false, hold: false });
  });

  // Protects: the model comes from the adapter's capabilities; a capability
  // the adapter does not map is not viable. Fails if a model is invented.
  test("a capability without a model", () => {
    expect(route(input({ roleDefault: "standard", candidates: [{ harness: "gemini", capability: null, effort: null }] }))).toMatchObject({ ok: false, hold: false });
    expect(route(input({ roleDefault: "standard", candidates: [{ harness: "gemini", capability: "deep", effort: null }] }))).toMatchObject({ ok: true, model: "gemini-deep" });
  });
});

describe("the routing against the real Radiant", () => {
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

  // Protects: the first viable candidate wins, after one below the floor,
  // with the model from the real capabilities.json. Fails if the order is
  // lost or the model is not the adapter's.
  test("the first viable candidate wins", async () => {
    ready(sb, root);
    writeRouting(sb, { schema: 1, rules: [], default: [{ harness: "codex", capability: "light" }, { harness: "claude-code", effort: "max" }, { harness: "codex" }] });
    const r = await attempt(sb, backend(sb));
    expect(r.code).toBe(0);
    const t = JSON.parse(readFileSync(join(resolveProject(sb.repo, sb.env)?.dir ?? "", "tasks", "TC-0042.1.json"), "utf8")) as TaskRecord;
    const real = JSON.parse(readFileSync(join(root, "adapters", "claude-code", "capabilities.json"), "utf8"));
    expect(t.harness).toBe("claude-code");
    expect(t.model).toBe(real.standard);
    expect(t.effort.requested).toBe("max");
  });

  test("leaves the Radiant checkout without a new file", () => {
    expect(radiantFiles(root)).toBe(before);
  });
});
