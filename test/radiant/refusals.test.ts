import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Outcome } from "../../src/core/index.ts";
import { FakeBackend } from "../../src/core/fake-backend.ts";
import { backend, sandbox, type Sandbox } from "../core/helpers/sandbox.ts";
import { spawnChild } from "../core/helpers/processes.ts";
import { attempt, commitAll, consumer, CONTRACT, contractText, DEFAULT_UNITS, effects, interposePython, map, radiantFiles, radiantRoot, ready, ROUTING, writeConfig, writeRouting } from "./helpers/fixture.ts";

// TC-0003, I1 to I13 and verification 3, the integration's part: each
// refusal exits 2 with the expected code and no effect, and runs before the
// core's dispatch, without the project lock (Spec 4 and 5).

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

// Runs the attempt and checks the refusal and that nothing changed.
async function refused(code: string, run: (be: FakeBackend) => Promise<Outcome>, be: FakeBackend = backend(sb)): Promise<Outcome> {
  const was = effects(sb, be);
  const r = await run(be);
  expect(r.code).toBe(2);
  expect(r.envelope.ok).toBe(false);
  expect(r.envelope.refusal?.code).toBe(code);
  expect(r.envelope.tasks).toEqual([]);
  expect(effects(sb, be)).toEqual({ ...was, calls: [] });
  expect(sb.tasksSnapshot()).toEqual({});
  return r;
}

// Changes the working tree after a commit, so the gate, which reads the
// working tree, and the base commit disagree.
function workingTree(path: string, content: string): void {
  mkdirSync(join(sb.repo, path, ".."), { recursive: true });
  writeFileSync(join(sb.repo, path), content);
}

describe("configuration (I1)", () => {
  // Protects: Spec 2.4, radiant.root is required to dispatch and has no
  // default. Fails if dispatch goes on without it.
  test("radiant-root-missing, with and without a configuration file", async () => {
    consumer(sb);
    writeRouting(sb, ROUTING);
    const r = await refused("radiant-root-missing", (be) => attempt(sb, be));
    expect(r.envelope.refusal?.next).toContain("radiant.root");
    writeConfig(sb, { schema: 1, herdr: { session: "lab" } });
    await refused("radiant-root-missing", (be) => attempt(sb, be));
  });

  // Protects: Spec 2.4, an unknown key or a wrong type in the radiant block
  // is config-invalid. Fails if any of them is accepted.
  test.each([
    ["an unknown key", { root: "/x", other: 1 }],
    ["a relative root", { root: "radiant" }],
    ["a root that is not text", { root: 7 }],
    ["a prefix that is not text", { root: "/x", branch_prefix: 3 }],
    // Finding 2 of the independent critique: null is a wrong type, not an
    // absent key.
    ["a null prefix", { root: "/x", branch_prefix: null }],
    ["a null root", { root: null }],
  ])("config-invalid: %s", async (_, radiant) => {
    consumer(sb);
    writeConfig(sb, { schema: 1, radiant });
    await refused("config-invalid", (be) => attempt(sb, be));
  });

  test("config-invalid from the core's part of the file", async () => {
    consumer(sb);
    writeConfig(sb, { schema: 2, radiant: { root } });
    await refused("config-invalid", (be) => attempt(sb, be));
  });
});

describe("project and unit ID", () => {
  test("not-a-project", async () => {
    ready(sb, root);
    const outside = join(sb.root, "fora");
    mkdirSync(outside);
    await refused("not-a-project", (be) => attempt(sb, be, {}, { cwd: outside }));
  });

  // Protects: Spec 3, item 4 and 5, an ID outside TC-NNNN.N and an ID that
  // is not in the block are unit-not-found. Fails if either is dispatched.
  test("unit-not-found: an ID outside the format, and an ID not in the block", async () => {
    ready(sb, root);
    await refused("unit-not-found", (be) => attempt(sb, be, { unitId: "TC-42.1" }));
    const r = await refused("unit-not-found", (be) => attempt(sb, be, { unitId: "TC-0042.9" }));
    expect(r.envelope.refusal?.message).toContain(CONTRACT);
  });
});

describe("pin gate and base (I2, I3)", () => {
  // Protects: Spec 3, item 2, a pin different from the Radiant checkout is
  // pin-mismatch with the HOLD line of check_project.py. Fails if the gate
  // is skipped or its line is lost.
  test("pin-mismatch from the gate", async () => {
    ready(sb, root);
    workingTree(".radiant.json", JSON.stringify(map({ radiant_revision: "0".repeat(40) })));
    const r = await refused("pin-mismatch", (be) => attempt(sb, be));
    expect(r.envelope.refusal?.message).toContain("HOLD: checkout revision differs from the pin");
  });

  // Protects: finding 1 of the independent critique, the base map is
  // compared with the pin the gate printed, not with the caller map read
  // again: a map swapped right after the gate cannot pass a base with an
  // unvalidated pin. Fails if the integration reads the pin again.
  test("pin-mismatch: the caller map swapped right after the gate", async () => {
    ready(sb, root);
    const other = JSON.stringify(map({ radiant_revision: "1".repeat(40) }));
    workingTree(".radiant.json", other);
    commitAll(sb, "base with another pin");
    workingTree(".radiant.json", JSON.stringify(map()));
    const replacement = join(sb.root, "outro-mapa.json");
    writeFileSync(replacement, other);
    const py = interposePython(sb, "swap-after", "check_project.py", { from: replacement, to: join(sb.repo, ".radiant.json") });
    const r = await refused("pin-mismatch", (be) => attempt(sb, be, {}, { env: py.env }));
    expect(r.envelope.refusal?.message).toContain("do commit base");
  });

  test("pin-mismatch: no .radiant.json in the caller checkout", async () => {
    ready(sb, root);
    rmSync(join(sb.repo, ".radiant.json"));
    const r = await refused("pin-mismatch", (be) => attempt(sb, be));
    expect(r.envelope.refusal?.message).toContain("HOLD:");
  });

  // Protects: Spec 3, item 3, the map of the base commit must be an object
  // with the pin the gate validated: missing, not JSON, not an object,
  // without the key or with another value is pin-mismatch, even though the
  // working tree passes the gate. Fails if the base map is not read or the
  // pin comparison is removed.
  const baseMaps: Array<[string, string | null]> = [
    ["missing", null],
    ["not JSON", "isto não é JSON"],
    ["not an object", "[]"],
    ["without radiant_revision", JSON.stringify({ contracts: "docs/contracts" })],
    ["with another pin", JSON.stringify(map({ radiant_revision: "1".repeat(40) }))],
  ];
  for (const [name, content] of baseMaps) {
    test(`pin-mismatch: the base map ${name}`, async () => {
      ready(sb, root);
      const valid = JSON.stringify(map());
      if (content === null) rmSync(join(sb.repo, ".radiant.json"));
      else workingTree(".radiant.json", content);
      commitAll(sb, `base map ${name}`);
      workingTree(".radiant.json", valid);
      const r = await refused("pin-mismatch", (be) => attempt(sb, be));
      expect(r.envelope.refusal?.message).toContain("do commit base");
    });
  }

  test("an unresolvable --base is task-invalid", async () => {
    ready(sb, root);
    await refused("task-invalid", (be) => attempt(sb, be, { base: "nao-existe" }));
  });
});

describe("contract in the base commit (I4)", () => {
  // Protects: Spec 3, item 4, exactly one TC-NNNN-*.md in contracts of the
  // base map. Fails if none, two, or a contracts value outside the
  // repository is accepted.
  test("contract-not-found: none for the prefix", async () => {
    ready(sb, root);
    await refused("contract-not-found", (be) => attempt(sb, be, { unitId: "TC-0099.1" }));
  });

  test("contract-not-found: two for the prefix", async () => {
    ready(sb, root);
    workingTree("docs/contracts/TC-0042-copia.md", contractText(DEFAULT_UNITS));
    commitAll(sb, "two contracts");
    const r = await refused("contract-not-found", (be) => attempt(sb, be));
    expect(r.envelope.refusal?.message).toContain("2 TC-0042-*.md");
  });

  test.each([
    ["null", null],
    ["absent", undefined],
    ["absolute", "/etc"],
    ["outside the repository", "../fora"],
  ])("contract-not-found: contracts %s in the base map", async (_, contracts) => {
    ready(sb, root);
    const valid = JSON.stringify(map());
    const base = map({ contracts });
    if (contracts === undefined) delete base["contracts"];
    workingTree(".radiant.json", JSON.stringify(base));
    commitAll(sb, "base map with bad contracts");
    workingTree(".radiant.json", valid);
    await refused("contract-not-found", (be) => attempt(sb, be));
  });

  // Protects: Spec 3, item 4, the contract is read from the base commit,
  // never from the working tree. Fails if a contract that exists only in
  // the working tree is dispatched.
  test("contract-not-found: a contract only in the working tree", async () => {
    ready(sb, root);
    rmSync(join(sb.repo, CONTRACT));
    commitAll(sb, "contract removed from the base");
    workingTree(CONTRACT, contractText(DEFAULT_UNITS));
    await refused("contract-not-found", (be) => attempt(sb, be));
  });
});

describe("units and rules (I5, I6)", () => {
  // Protects: Spec 3, item 5, an invalid block is units-invalid with only
  // the count and the command that shows the errors. Fails if the errors are
  // copied into the message.
  test("units-invalid", async () => {
    ready(sb, root, { units: [{ id: "TC-0042.1", role: "perfil-inexistente" }] });
    const r = await refused("units-invalid", (be) => attempt(sb, be));
    expect(r.envelope.refusal?.message).toMatch(/tem 1 erro\(s\)$/);
    expect(r.envelope.refusal?.message).not.toContain("perfil-inexistente");
    expect(r.envelope.refusal?.next).toContain("check_dispatch.py units -");
    expect(r.envelope.refusal?.next).toContain(CONTRACT);
  });

  test("units-invalid: a contract without a radiant-units block", async () => {
    ready(sb, root);
    workingTree(CONTRACT, "# Contrato sem bloco\n");
    commitAll(sb, "no block");
    await refused("units-invalid", (be) => attempt(sb, be));
  });

  // Protects: Spec 3, item 5, routing errors are the user's and reach the
  // message. Fails if a missing or invalid routing.json, or an unknown
  // rule, is dispatched.
  test("routing-invalid: no routing.json", async () => {
    consumer(sb);
    writeConfig(sb, { schema: 1, radiant: { root } });
    const r = await refused("routing-invalid", (be) => attempt(sb, be));
    expect(r.envelope.refusal?.message).toContain("routing.json");
  });

  test("routing-invalid: content Radiant refuses", async () => {
    ready(sb, root);
    writeRouting(sb, { schema: 2, rules: [], default: [{ harness: "codex" }] });
    const r = await refused("routing-invalid", (be) => attempt(sb, be));
    expect(r.envelope.refusal?.message).toContain("unknown schema 2");
  });

  test("routing-invalid: an unknown --rule", async () => {
    ready(sb, root);
    const r = await refused("routing-invalid", (be) => attempt(sb, be, { rule: "nao-existe" }));
    expect(r.envelope.refusal?.message).toContain("nao-existe");
  });

  // Protects: Spec 3, item 5, a candidate without a Radiant adapter is
  // harness-without-adapter, with the other errors in the message. Fails if
  // it becomes routing-invalid or is dispatched.
  test("harness-without-adapter", async () => {
    ready(sb, root);
    writeRouting(sb, { schema: 1, rules: [{ id: "x", when: "y", use: [{ harness: "codex", capability: "huge" }] }], default: [{ harness: "opencode" }] });
    const r = await refused("harness-without-adapter", (be) => attempt(sb, be));
    expect(r.envelope.refusal?.message).toContain("default: harness without an adapter 'opencode'");
    expect(r.envelope.refusal?.message).toContain("unknown capability 'huge'");
  });
});

describe("routing, approval and return (I8, I9, I10)", () => {
  // Protects: Spec 3, item 6, a unit whose requires no adapter provides at
  // the pin has no viable candidate, without hold. Fails if the provides
  // check is skipped.
  test("no-viable-candidate: provides", async () => {
    ready(sb, root, { units: [{ id: "TC-0042.1", requires: ["browser"] }] });
    const r = await refused("no-viable-candidate", (be) => attempt(sb, be));
    expect(r.envelope.refusal?.hold).toBe(false);
    expect(r.envelope.refusal?.message).toContain("provides.json não cobre browser");
  });

  // Protects: Spec 3, item 6, a candidate below the unit's capability is
  // not viable and the refusal is hold, with no downgrade. Fails if the
  // light candidate is accepted.
  test("no-viable-candidate with hold: a candidate below the unit's capability", async () => {
    ready(sb, root, { units: [{ id: "TC-0042.1", capability: "deep" }] });
    writeRouting(sb, { schema: 1, rules: [], default: [{ harness: "codex", capability: "light" }] });
    const r = await refused("no-viable-candidate", (be) => attempt(sb, be));
    expect(r.envelope.refusal?.hold).toBe(true);
  });

  // Protects: Spec 3, item 6, without capability the floor is the role's
  // default in agents.json: radiant-verifier is deep, so a light candidate
  // is refused with hold. Fails if the floor ignores the role default.
  test("no-viable-candidate with hold: the role default as the floor", async () => {
    ready(sb, root, { units: [{ id: "TC-0042.1", role: "radiant-verifier" }] });
    writeRouting(sb, { schema: 1, rules: [], default: [{ harness: "claude-code", capability: "light" }] });
    const r = await refused("no-viable-candidate", (be) => attempt(sb, be));
    expect(r.envelope.refusal?.hold).toBe(true);
    expect(r.envelope.refusal?.message).toContain("abaixo do piso deep");
  });

  // Protects: Spec 3, item 6, a candidate the backend does not launch is
  // discarded. Fails if the backend support is not asked.
  test("no-viable-candidate: the backend launches only Codex", async () => {
    ready(sb, root);
    writeRouting(sb, { schema: 1, rules: [], default: [{ harness: "claude-code" }] });
    const be = new FakeBackend(sb.env, { script: { modes: { codex: "worktree-first" } } });
    const r = await refused("no-viable-candidate", (b) => attempt(sb, b), be);
    expect(r.envelope.refusal?.message).toContain("claude-code: sem suporte no backend");
  });

  // Protects: I9, a rule with approval human needs --human-approved.
  // Fails if approval is ignored.
  test("approval-required", async () => {
    ready(sb, root);
    await refused("approval-required", (be) => attempt(sb, be, { rule: "critique" }));
  });

  // Protects: Spec 3, item 7, the return must be ignored by Git in the
  // caller checkout. Fails if a tracked report path is dispatched.
  test("reports-not-ignored", async () => {
    ready(sb, root, { gitignore: "node_modules/\n" });
    const r = await refused("reports-not-ignored", (be) => attempt(sb, be));
    expect(r.envelope.refusal?.message).toContain(".radiant/reports/TC-0042.1.md");
  });
});

describe("integration refusals run without the lock (I13)", () => {
  // Protects: Spec 4, revision 0.12, the integration's checks only read and
  // run before the core takes the project lock. Fails if a refusal of the
  // integration waits for, or reports, the lock.
  test("approval-required while another command holds the lock", async () => {
    ready(sb, root);
    const stateFile = join(sb.root, "fake-backend.json");
    new FakeBackend(sb.env, { stateFile });
    const holder = spawnChild(sb, stateFile, { name: "h", command: "collect", input: "TC-0099.1", holdOn: "lock-acquired" });
    try {
      await holder.held();
      const started = Date.now();
      await refused("approval-required", (be) => attempt(sb, be, { rule: "critique" }), new FakeBackend(sb.env, { stateFile }));
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      holder.go();
      await holder.proc.exited;
    }
  });
});

describe("the Radiant checkout after this file", () => {
  test("has no new file", () => {
    expect(radiantFiles(root)).toBe(before);
  });
});
