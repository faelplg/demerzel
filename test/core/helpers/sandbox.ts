import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "../../../src/core/commands/common.ts";
import type { Env } from "../../../src/core/env.ts";
import { FakeBackend, type FakeScript } from "../../../src/core/fake-backend.ts";
import { git } from "../../../src/core/git.ts";

// A temporary HOME, XDG dirs and an isolated Git: an empty global config, no
// system config, no templates (so no hooks), fixed identity. Nothing here
// touches the owner's registry, configuration or Git.
export type Sandbox = {
  root: string;
  repo: string;
  env: Env;
  stateHome: string;
  configHome: string;
  cleanup: () => void;
  commit: (file: string, content: string, message: string) => string;
  tasksSnapshot: () => Record<string, string>;
  gitState: () => string;
};

export function sandbox(): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dz-core-")));
  const home = join(root, "home");
  const stateHome = join(root, "state");
  const configHome = join(root, "config");
  const templates = join(root, "git-templates");
  for (const dir of [home, stateHome, configHome, templates]) mkdirSync(dir, { recursive: true });
  const globalConfig = join(root, "gitconfig");
  writeFileSync(globalConfig, "");
  const env: Env = {
    PATH: process.env["PATH"],
    HOME: home,
    XDG_STATE_HOME: stateHome,
    XDG_CONFIG_HOME: configHome,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TEMPLATE_DIR: templates,
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Demerzel Test",
    GIT_AUTHOR_EMAIL: "test@demerzel.invalid",
    GIT_COMMITTER_NAME: "Demerzel Test",
    GIT_COMMITTER_EMAIL: "test@demerzel.invalid",
    TZ: "UTC",
  };
  const repo = join(root, "project");
  mkdirSync(repo);
  const run = (args: string[]) => {
    const r = git(repo, args, env);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  run(["init", "-q", "-b", "main"]);
  run(["config", "commit.gpgsign", "false"]);
  const commit = (file: string, content: string, message: string): string => {
    const path = join(repo, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
    run(["add", file]);
    run(["commit", "-q", "-m", message]);
    return run(["rev-parse", "HEAD"]);
  };
  commit("README.md", "projeto de teste\n", "init");
  commit("docs/contract.md", "contrato de teste\n", "add contract");

  const tasksDir = () => {
    const projects = join(stateHome, "demerzel", "projects");
    if (!existsSync(projects)) return null;
    const [key] = readdirSync(projects);
    return key === undefined ? null : join(projects, key, "tasks");
  };
  return {
    root,
    repo,
    env,
    stateHome,
    configHome,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    commit,
    tasksSnapshot: () => {
      const dir = tasksDir();
      if (dir === null || !existsSync(dir)) return {};
      return Object.fromEntries(readdirSync(dir).map((name) => [name, readFileSync(join(dir, name), "utf8")]));
    },
    gitState: () => [run(["for-each-ref", "--format=%(refname) %(objectname)"]), run(["worktree", "list", "--porcelain"])].join("\n--\n"),
  };
}

export function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = (overrides["id"] as string | undefined) ?? "TC-0099.1";
  return {
    id,
    harness: "codex",
    model: "gpt-6.1-sol",
    effort: "medium",
    branch: `radiant/${id}`,
    writes: [`src/${id}/`],
    dependsOn: [],
    request: { role: "radiant-dev", pointers: [{ label: "contract", path: "docs/contract.md" }] },
    returnPath: `.radiant/reports/${id}.md`,
    provenance: { rule: "default" },
    ...overrides,
  };
}

export function backend(sb: Sandbox, script: Partial<FakeScript> = {}, stateFile?: string): FakeBackend {
  return new FakeBackend(sb.env, stateFile === undefined ? { script } : { script, stateFile });
}

export function context(sb: Sandbox, be: FakeBackend, extra: Partial<Context> = {}): Context {
  return { cwd: sb.repo, env: sb.env, backend: be, waitIntervalMs: 5, lockIntervalMs: 10, ...extra };
}

export function writeReport(worktree: string, returnPath: string, content = "# Completion report\n"): void {
  const path = join(worktree, returnPath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}
