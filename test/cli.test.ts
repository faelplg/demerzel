import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };
import { dispatch } from "../src/core/index.ts";
import type { Env } from "../src/core/env.ts";
import { resolveProject } from "../src/core/project.ts";
import { HerdrBackend } from "../src/herdr/backend.ts";
import { sandbox, task, writeReport, type Sandbox } from "./core/helpers/sandbox.ts";
import { installFakeHerdr, type FakeHerdr } from "./herdr/helpers/fake.ts";

const bin = fileURLToPath(new URL(`../${pkg.bin.demerzel}`, import.meta.url));

async function run(args: string[], env?: Env, cwd?: string) {
  const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe", ...(env ? { env: env as Record<string, string> } : {}), ...(cwd ? { cwd } : {}) });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr };
}

describe("demerzel entrypoint", () => {
  // Protects: the bin declared in package.json runs as an executable and
  // reports the package version. Fails if the shebang, the exec bit or the
  // version source breaks.
  test("--version prints the package version and exits 0", async () => {
    const r = await run(["--version"]);
    expect(r).toEqual({ code: 0, stdout: `${pkg.version}\n`, stderr: "" });
  });

  // Protects: H11, wrong usage is a refusal with exit 2 that shows the
  // usage, and dispatch stays out of the CLI until increment 5. Fails if a
  // bad argument is accepted or the usage disappears.
  test.each([[[]], [["--help"]], [["dispatch", "TC-0001.1"]], [["status", "--bogus"]], [["wait"]], [["resume"]], [["wait", "x", "--timeout", "abc"]], [["close", "a", "b"]]])(
    "refuses %j with exit 2 and the usage",
    async (args) => {
      const r = await run(args);
      expect(r.code).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("recusa usage-invalid");
      expect(r.stderr).toContain("demerzel status");
    },
  );

  test("usage refusal in --json", async () => {
    const r = await run(["dispatch", "TC-0001.1", "--json"]);
    expect(r.code).toBe(2);
    const envelope = JSON.parse(r.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.refusal.code).toBe("usage-invalid");
    expect(envelope.refusal.message).toContain("incremento 5");
  });
});

describe("the five commands over the herdr backend (H11, H12)", () => {
  let sb: Sandbox;
  let fake: FakeHerdr;
  beforeEach(() => {
    sb = sandbox();
    fake = installFakeHerdr(sb.root, sb.env);
    mkdirSync(join(sb.configHome, "demerzel"), { recursive: true });
    writeFileSync(join(sb.configHome, "demerzel", "config.json"), JSON.stringify({ schema: 1, herdr: { session: "dz-test" } }));
  });
  afterEach(() => sb.cleanup());

  const backend = () => new HerdrBackend(fake.env, { session: "dz-test" }, { postconditionWaitMs: 200 });
  const launched = (overrides: Record<string, unknown> = {}) =>
    dispatch({ task: task(overrides), humanApproved: false }, { cwd: sb.repo, env: fake.env, backend: backend(), lockIntervalMs: 10 });
  const cli = (args: string[]) => run(args, fake.env, sb.repo);
  const record = () => JSON.parse(readFileSync(join(resolveProject(sb.repo, sb.env)?.dir ?? "", "tasks", "TC-0099.1.json"), "utf8"));

  // Protects: status, wait, collect and close in text and JSON, with the
  // fields each command adds. Fails if the text drops what matters.
  test("status, wait, collect and close", async () => {
    const d = await launched();
    expect(d.code).toBe(0);
    const worktree = d.envelope.tasks[0]?.worktree ?? "";

    const s = await cli(["status"]);
    expect(s.code).toBe(0);
    expect(s.stdout).toContain("TC-0099.1  lifecycle=launched  agent=working  report=absent");
    const sj = JSON.parse((await cli(["status", "--json"])).stdout);
    expect(sj.command).toBe("status");
    expect(sj.tasks[0].agent).toBe("working");

    writeReport(worktree, ".radiant/reports/TC-0099.1.md", "pronto\n");
    const w = await cli(["wait", "TC-0099.1", "--timeout", "2000"]);
    expect(w.code).toBe(0);
    expect(w.stdout).toContain("report=present");

    const c = await cli(["collect", "TC-0099.1"]);
    expect(c.code).toBe(0);
    expect(c.stdout).toContain("lifecycle=collected");
    expect(c.stdout).toMatch(/digest=[0-9a-f]{64}  digest_changed=false/);
    expect(c.stdout).toContain("\npronto\n");

    const working = await cli(["close", "TC-0099.1"]);
    expect(working.code).toBe(2);
    expect(working.stderr).toContain("recusa task-working");

    fake.setAgentStatus(d.envelope.tasks[0]?.agent_name ?? "", "idle");
    writeFileSync(join(worktree, "solto.txt"), "x\n");
    const x = await cli(["close", "TC-0099.1", "--discard-worktree"]);
    expect(x.code).toBe(1);
    expect(x.stdout).toContain("lifecycle=closed");
    expect(x.stdout).toContain("descarte recusado pelo Git");
    expect(fake.state().workspaces).toEqual([]);
  });

  // Protects: the resume flow of TC-0002: a blocked startup, a resume that
  // sends nothing while blocked, one send of the recorded text after the
  // release, and a refusal after that. Fails if resume sends twice or
  // rebuilds the request.
  test("resume after a blocked startup", async () => {
    fake.script({ start: { claude: "not_ready", codex: "not_ready" } });
    const d = await launched();
    expect(d.code).toBe(1);
    expect(record().request_sent).toBe(false);
    const prompts = () => fake.calls().filter((c) => c[2] === "agent" && c[3] === "prompt");

    const still = await cli(["resume", "TC-0099.1"]);
    expect(still.code).toBe(1);
    expect(still.stdout).toContain("agent=blocked");
    expect(prompts()).toHaveLength(0);

    fake.setAgentStatus(d.envelope.tasks[0]?.agent_name ?? "", "idle");
    const sent = await cli(["resume", "TC-0099.1", "--json"]);
    expect(sent.code).toBe(0);
    expect(JSON.parse(sent.stdout).tasks[0].request_sent).toBe(true);
    expect(prompts()).toHaveLength(1);
    expect(prompts()[0]?.[5]).toBe(record().request_text);

    const again = await cli(["resume", "TC-0099.1"]);
    expect(again.code).toBe(2);
    expect(again.stderr).toContain("recusa request-already-sent");
    expect(prompts()).toHaveLength(1);
  });

  // Protects: H13 and Spec 2.3, revision 0.9, a backend failure after the
  // first effect reaches the envelope and the text with the herdr command,
  // and the agent is unknown (finding F3). Fails if the CLI exits 1 without
  // saying why.
  test("backend errors after the first effect reach the user", async () => {
    fake.script({ start: { claude: "not_ready", codex: "not_ready" } });
    const d = await launched();
    fake.setAgentStatus(d.envelope.tasks[0]?.agent_name ?? "", "idle");
    fake.script({ prompt: "agent_prompt_stalled" });
    const r = await cli(["resume", "TC-0099.1", "--json"]);
    expect(r.code).toBe(1);
    const t = JSON.parse(r.stdout).tasks[0];
    expect(t.request_sent).toBe("unknown");
    expect(t.agent).toBe("unknown");
    expect(t.backend_error).toContain("herdr agent prompt: agent_prompt_stalled");
    expect(record().history.at(-1).detail.backend_error).toContain("agent_prompt_stalled");

    fake.script({ closeFails: true });
    const x = await cli(["close", "TC-0099.1"]);
    expect(x.code).toBe(1);
    expect(x.stdout).toContain("agent=unknown");
    expect(x.stdout).toContain("erro do backend: herdr workspace close: close_failed");
    expect(record().lifecycle).toBe("launched");
  });

  // Protects: H12, a bad herdr block and a stopped herdr are refusals with
  // exit 2 and no effect. Fails if either acts.
  test("configuration and backend refusals", async () => {
    await launched();
    const before = sb.tasksSnapshot();
    writeFileSync(join(sb.configHome, "demerzel", "config.json"), JSON.stringify({ schema: 1, herdr: { session: "-bad" } }));
    const bad = await cli(["status", "--json"]);
    expect(bad.code).toBe(2);
    expect(JSON.parse(bad.stdout).refusal.code).toBe("config-invalid");

    writeFileSync(join(sb.configHome, "demerzel", "config.json"), JSON.stringify({ schema: 1, herdr: { session: "dz-test" } }));
    fake.script({ running: false });
    const down = await cli(["close", "TC-0099.1"]);
    expect(down.code).toBe(2);
    expect(down.stderr).toContain("recusa backend-unavailable");
    expect(down.stderr).toContain("parado");
    expect(sb.tasksSnapshot()).toEqual(before);
  });
});
