import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { backend, sandbox, type Sandbox } from "../core/helpers/sandbox.ts";
import { attempt, effects, interposePython, radiantFiles, radiantRoot, ready, withoutPython, type PythonMode } from "./helpers/fixture.ts";

// TC-0003, I7: each validator outside its own protocol (Spec 3, item 2) is
// validator-failed, with the validator and a summary, and no contract
// content. A python3 first on PATH passes every run to the real one, except
// the targeted validator, which answers outside its protocol.

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

const BODY = "Corpo com o MARCADOR-VALIDADOR-4e1d que nunca sai.";

const cases: Array<[string, PythonMode, string, string]> = [
  ["the gate exits 2", "exit2", "check_project.py", "check_project.py"],
  ["the gate ends by a signal", "signal", "check_project.py", "check_project.py"],
  ["the gate exits 1 without a HOLD line", "exit1-no-hold", "check_project.py", "check_project.py"],
  ["the gate exits 0 without a PASS line", "garbage", "check_project.py", "check_project.py"],
  ["the gate exits 0 with a PASS line without the revision", "pass-no-revision", "check_project.py", "check_project.py"],
  ["units exits 2", "exit2", "check_dispatch.py units", "check_dispatch.py units -"],
  ["units ends by a signal", "signal", "check_dispatch.py units", "check_dispatch.py units -"],
  ["units exits 0 with invalid JSON", "garbage", "check_dispatch.py units", "check_dispatch.py units -"],
  ["units exits 1 with invalid JSON", "exit1-garbage", "check_dispatch.py units", "check_dispatch.py units -"],
  ["routing exits 2", "exit2", "check_dispatch.py routing", "check_dispatch.py routing"],
  ["routing ends by a signal", "signal", "check_dispatch.py routing", "check_dispatch.py routing"],
  ["routing exits 0 with invalid JSON", "garbage", "check_dispatch.py routing", "check_dispatch.py routing"],
  ["routing exits 1 with invalid JSON", "exit1-garbage", "check_dispatch.py routing", "check_dispatch.py routing"],
];

describe("validator-failed (I7)", () => {
  for (const [name, mode, target, named] of cases) {
    // Protects: an outcome outside the protocol never passes and never
    // becomes a domain refusal: it is validator-failed, naming the
    // validator, with no effect and no contract content. Fails if it is
    // read as success, as pin-mismatch, units-invalid or routing-invalid,
    // or if the message carries the contract.
    test(name, async () => {
      ready(sb, root, { body: BODY });
      const py = interposePython(sb, mode, target);
      const be = backend(sb);
      const was = effects(sb, be);
      const r = await attempt(sb, be, {}, { env: py.env });
      expect(r.code).toBe(2);
      expect(r.envelope.refusal?.code).toBe("validator-failed");
      expect(r.envelope.refusal?.message).toContain(named);
      expect(JSON.stringify(r.envelope)).not.toContain("MARCADOR-VALIDADOR-4e1d");
      expect(effects(sb, be)).toEqual(was);
      if (mode === "signal") expect(r.envelope.refusal?.message).toContain("SIGTERM");
      // The units output could repeat the contract, so nothing it printed
      // is quoted.
      if (target === "check_dispatch.py units") expect(r.envelope.refusal?.message).not.toContain("falha injetada");
    });
  }

  // Protects: a missing python3 is validator-failed before any effect.
  // Fails if it throws or reads as a pin mismatch.
  test("python3 missing from PATH", async () => {
    ready(sb, root);
    const be = backend(sb);
    const r = await attempt(sb, be, {}, { env: withoutPython(sb) });
    expect(r.code).toBe(2);
    expect(r.envelope.refusal?.code).toBe("validator-failed");
    expect(r.envelope.refusal?.message).toContain("python3 não pôde ser executado");
    expect(be.effectCalls()).toEqual([]);
  });
});

describe("how the validators run", () => {
  // Protects: Spec 3, item 2, every validator runs with
  // PYTHONDONTWRITEBYTECODE=1, so no bytecode lands in the Radiant
  // checkout. Fails if any run lacks it.
  test("with PYTHONDONTWRITEBYTECODE=1", async () => {
    ready(sb, root);
    const py = interposePython(sb);
    expect((await attempt(sb, backend(sb), {}, { env: { ...py.env, PYTHONDONTWRITEBYTECODE: "" } })).code).toBe(0);
    expect(py.bytecode()).toEqual(["1", "1", "1"]);
  });

  test("leave the Radiant checkout without a new file", () => {
    expect(radiantFiles(root)).toBe(before);
  });
});
