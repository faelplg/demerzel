import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../../package.json" with { type: "json" };
import type { Env } from "../../src/core/env.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { TaskRecord } from "../../src/core/types.ts";
import { sandbox, writeReport, type Sandbox } from "../core/helpers/sandbox.ts";
import { installFakeHerdr, type FakeHerdr } from "../herdr/helpers/fake.ts";
import { consumer, radiantFiles, radiantRoot, ROUTING, writeConfig, writeRouting, type UnitSpec } from "./helpers/fixture.ts";

// TC-0003, I14 and verification 4: `demerzel dispatch` through the CLI, over
// the integration, the core and the herdr backend, with the fake herdr; and
// no contract content in the request, the record or what the CLI prints.

const bin = fileURLToPath(new URL(`../../${pkg.bin.demerzel}`, import.meta.url));

async function run(args: string[], env: Env, cwd: string) {
  const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe", env: env as Record<string, string>, cwd });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr };
}

let root: string;
let before: string;
beforeAll(() => {
  root = radiantRoot();
  before = radiantFiles(root);
});

let sb: Sandbox;
let fake: FakeHerdr;
beforeEach(() => {
  sb = sandbox();
  fake = installFakeHerdr(sb.root, sb.env);
  writeConfig(sb, { schema: 1, herdr: { session: "dz-test" }, radiant: { root } });
  writeRouting(sb, ROUTING);
});
afterEach(() => sb.cleanup());

const cli = (args: string[]) => run(args, fake.env, sb.repo);
const record = (id: string) => JSON.parse(readFileSync(join(resolveProject(sb.repo, sb.env)?.dir ?? "", "tasks", `${id}.json`), "utf8")) as TaskRecord;
const TWO: UnitSpec[] = [{ id: "TC-0042.1" }, { id: "TC-0042.2", writes: ["docs/b/"] }];

describe("demerzel dispatch (I14)", () => {
  // Protects: the whole flow of a fixture unit through the CLI: dispatch,
  // status, wait, collect and close, with the herdr fake. Fails if any
  // command breaks on a task the integration created.
  test("dispatch, status, wait, collect and close", async () => {
    consumer(sb, { units: TWO });
    const d = await cli(["dispatch", "TC-0042.1", "--json"]);
    expect(d.code).toBe(0);
    const envelope = JSON.parse(d.stdout);
    expect(envelope).toMatchObject({ ok: true, command: "dispatch", refusal: null });
    const t = envelope.tasks[0];
    expect(t).toMatchObject({ id: "TC-0042.1", lifecycle: "launched", harness: "claude-code", request_sent: true, branch: "radiant/TC-0042.1" });
    expect(t.provenance.rule).toBe("default");

    const s = await cli(["status"]);
    expect(s.code).toBe(0);
    expect(s.stdout).toContain("TC-0042.1  lifecycle=launched  agent=working  report=absent");

    writeReport(t.worktree, ".radiant/reports/TC-0042.1.md", "# Completion report\n\nStatus: DONE\n");
    const w = await cli(["wait", "TC-0042.1", "--timeout", "2000"]);
    expect(w.code).toBe(0);
    const c = await cli(["collect", "TC-0042.1"]);
    expect(c.code).toBe(0);
    expect(c.stdout).toContain("Status: DONE");

    fake.setAgentStatus(t.agent_name, "idle");
    const x = await cli(["close", "TC-0042.1"]);
    expect(x.code).toBe(0);
    expect(record("TC-0042.1").lifecycle).toBe("closed");
  });

  // Protects: Spec 4, the short text of dispatch has the ID, lifecycle,
  // request_sent, harness, model and rule. Fails if any of them is dropped.
  test("the short text", async () => {
    consumer(sb, { units: TWO });
    const d = await cli(["dispatch", "TC-0042.2", "--rule", "codex-build"]);
    expect(d.code).toBe(0);
    const models = JSON.parse(readFileSync(join(root, "adapters", "codex", "capabilities.json"), "utf8"));
    expect(d.stdout).toContain(`TC-0042.2  lifecycle=launched  agent=working  report=absent  request_sent=true  harness=codex  model=${models.standard}  rule=codex-build`);
  });

  // Protects: a refusal of the integration exits 2 through the CLI, in
  // text and in --json, with hold when only capability was missing. Fails
  // if the exit code or the hold flag is lost.
  test("refusals in text and in --json", async () => {
    consumer(sb, { units: [{ id: "TC-0042.1", capability: "deep" }] });
    writeRouting(sb, { schema: 1, rules: [], default: [{ harness: "codex", capability: "light" }] });
    const text = await cli(["dispatch", "TC-0042.1"]);
    expect(text.code).toBe(2);
    expect(text.stdout).toBe("");
    expect(text.stderr).toContain("recusa no-viable-candidate (hold):");
    const json = await cli(["dispatch", "TC-0042.1", "--json"]);
    expect(json.code).toBe(2);
    expect(JSON.parse(json.stdout).refusal).toMatchObject({ code: "no-viable-candidate", hold: true });
  });

  // Protects: Spec 4, a missing or unknown argument is a refusal with exit
  // 2 that shows the usage. Fails if dispatch accepts a bad call.
  test.each([[["dispatch"]], [["dispatch", "TC-0042.1", "TC-0042.2"]], [["dispatch", "TC-0042.1", "--rule"]], [["dispatch", "TC-0042.1", "--base"]], [["dispatch", "TC-0042.1", "--force"]], [["dispatch", "TC-0042.1", "--rule", "a", "--rule", "b"]]])("usage: %j", async (args) => {
    consumer(sb);
    const r = await cli(args);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("recusa usage-invalid");
    expect(r.stderr).toContain("demerzel dispatch <unit-id> [--rule <id>] [--base <ref>] [--human-approved] [--json]");
  });
});

describe("no contract content leaves the Demerzel (verification 4)", () => {
  const MARKERS = ["MARCADOR-TITULO-7f3a", "MARCADOR-CORPO-91c2", "MARCADOR-OBJETIVO-5b8e", "MARCADOR-PRONTO-c0d1", "MARCADOR-PAPEL-2a6f"];
  const BODY = "Objetivo do contrato: MARCADOR-CORPO-91c2.\n\n## MARCADOR-TITULO-7f3a";
  const units: UnitSpec[] = [{ id: "TC-0042.1", objective: "Implementar MARCADOR-OBJETIVO-5b8e", done_when: "Pronto quando MARCADOR-PRONTO-c0d1" }];
  const clean = (text: string, where: string) => {
    for (const marker of MARKERS) expect(text, `${marker} em ${where}`).not.toContain(marker);
  };

  // Protects: Spec 2.2 and 6, the recorded and sent request carry only the
  // fixed text, IDs, refs and paths. Fails if any contract text reaches the
  // request, the record or the CLI output.
  test("a dispatched unit", async () => {
    consumer(sb, { units, body: BODY });
    const d = await cli(["dispatch", "TC-0042.1", "--json"]);
    expect(d.code).toBe(0);
    clean(d.stdout + d.stderr, "saída do dispatch");
    const r = record("TC-0042.1");
    clean(r.request_text, "pedido gravado");
    clean(JSON.stringify(r), "registro");
    const prompts = fake.calls().filter((c) => c[2] === "agent" && c[3] === "prompt");
    expect(prompts).toHaveLength(1);
    clean(JSON.stringify(prompts), "pedido enviado");
    expect(prompts[0]?.[5]).toBe(r.request_text);
  });

  // Protects: a refusal never prints the contract, including
  // units-invalid with a marker in the field the validator refuses, whose
  // error repeats it. Fails if the errors of `units` reach the output.
  test("refusals, units-invalid with a marker in the role", async () => {
    consumer(sb, { units: [{ ...units[0]!, role: "MARCADOR-PAPEL-2a6f" }], body: BODY });
    for (const args of [["dispatch", "TC-0042.1"], ["dispatch", "TC-0042.1", "--json"]]) {
      const r = await cli(args);
      expect(r.code).toBe(2);
      expect(r.stdout + r.stderr).toContain("units-invalid");
      clean(r.stdout + r.stderr, `recusa ${args.join(" ")}`);
    }
    consumer(sb, { units, body: BODY });
    for (const args of [["dispatch", "TC-0042.9"], ["dispatch", "TC-0042.1", "--rule", "critique"], ["dispatch", "TC-0042.1", "--rule", "nao-existe", "--json"]]) {
      const r = await cli(args);
      expect(r.code).toBe(2);
      clean(r.stdout + r.stderr, `recusa ${args.join(" ")}`);
    }
  });

  test("leaves the Radiant checkout without a new file", () => {
    expect(radiantFiles(root)).toBe(before);
  });
});
