import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { stateRoot, type Env } from "./env.ts";
import { git } from "./git.ts";

export type Project = {
  // Root of the checkout the command was called from; may be a linked worktree.
  callerRoot: string;
  // Main checkout, from git rev-parse --git-common-dir.
  mainCheckout: string;
  key: string;
  dir: string;
};

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// Spec 2.3: projects/<repo name>-<12 hex of sha256 of the real path of the
// main checkout>/. Null outside a Git repository (not-a-project).
export function resolveProject(cwd: string, env: Env): Project | null {
  const top = git(cwd, ["rev-parse", "--show-toplevel"], env);
  const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"], env);
  if (top.code !== 0 || common.code !== 0 || top.stdout === "" || common.stdout === "") return null;
  const commonDir = realpathSync(common.stdout);
  if (basename(commonDir) !== ".git") return null;
  const mainCheckout = dirname(commonDir);
  const key = `${basename(mainCheckout)}-${sha256(mainCheckout).slice(0, 12)}`;
  return {
    callerRoot: realpathSync(top.stdout),
    mainCheckout,
    key,
    dir: join(stateRoot(env), "projects", key),
  };
}

// Spec 2.5: "dz-" plus the first 16 hex of sha256("<project key>:<id>").
export function agentName(projectKey: string, id: string): string {
  return `dz-${sha256(`${projectKey}:${id}`).slice(0, 16)}`;
}
