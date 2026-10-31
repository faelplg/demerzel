import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Env } from "../../../src/core/env.ts";

// Puts the fake herdr first on PATH for one sandbox and gives the tests its
// call log and state.

export type FakeHerdrScript = {
  running: boolean;
  version: string;
  snapshot: "ok" | "garbage" | "no-lists";
  start: Record<string, "ready" | "not_ready" | "error">;
  hook: "run" | "skip" | "wrong-path";
  cwd: "worktree" | "root";
  prompt: "ok" | "agent_blocked" | "agent_not_ready" | "agent_prompt_stalled";
  statusAfterPrompt: string;
  extraAgents: Array<{ name?: string; agent_status: string; pane_id: string }>;
  paneBusy: number;
};

export const defaultScript: FakeHerdrScript = {
  running: true,
  version: "0.9.0",
  snapshot: "ok",
  start: { claude: "ready", codex: "ready" },
  hook: "run",
  cwd: "worktree",
  prompt: "ok",
  statusAfterPrompt: "working",
  extraAgents: [],
  paneBusy: 0,
};

export type FakeHerdr = {
  env: Env;
  calls: () => string[][];
  state: () => { workspaces: Array<{ id: string; label: string }>; agents: Array<{ name: string; status: string; cwd: string }>; script: FakeHerdrScript };
  script: (patch: Partial<FakeHerdrScript>) => void;
  setAgentStatus: (name: string, status: string) => void;
};

export function installFakeHerdr(root: string, baseEnv: Env, patch: Partial<FakeHerdrScript> = {}): FakeHerdr {
  const bin = join(root, "fake-bin");
  mkdirSync(bin, { recursive: true });
  const statePath = join(root, "fake-herdr-state.json");
  const logPath = join(root, "fake-herdr-calls.jsonl");
  const script = join(import.meta.dir, "fake-herdr.ts");
  writeFileSync(join(bin, "herdr"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`);
  chmodSync(join(bin, "herdr"), 0o755);
  writeFileSync(statePath, JSON.stringify({ next: 1, workspaces: [], agents: [], script: { ...defaultScript, ...patch } }));
  writeFileSync(logPath, "");
  const env: Env = { ...baseEnv, PATH: `${bin}:${baseEnv["PATH"] ?? ""}`, FAKE_HERDR_STATE: statePath, FAKE_HERDR_LOG: logPath };
  const read = () => JSON.parse(readFileSync(statePath, "utf8"));
  const write = (s: unknown) => writeFileSync(statePath, JSON.stringify(s));
  return {
    env,
    calls: () => (existsSync(logPath) ? readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]) : []),
    state: read,
    script: (p) => {
      const s = read();
      s.script = { ...s.script, ...p };
      write(s);
    },
    setAgentStatus: (name, status) => {
      const s = read();
      const agent = s.agents.find((a: { name: string }) => a.name === name);
      if (agent === undefined) throw new Error(`no fake herdr agent ${name}`);
      agent.status = status;
      write(s);
    },
  };
}
