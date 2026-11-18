import type { Env } from "./env.ts";
import { git, gitOk } from "./git.ts";
import type { TaskRecord } from "./types.ts";

// Spec 5: completion is collection followed by closure, with the current
// branch tip already in the proposed base. A report alone is insufficient.
export function dependencyPending(other: TaskRecord | undefined, mainCheckout: string, commit: string, env: Env): string | null {
  if (other === undefined) return "there is no task with this ID in the registry";
  const events = other.history.map((h) => h.event);
  const collectedAt = events.indexOf("collected");
  if (other.lifecycle !== "closed" || collectedAt === -1 || events.lastIndexOf("closed") < collectedAt) {
    return "it must be closed after collection";
  }
  const tip = git(mainCheckout, ["rev-parse", "--verify", "--quiet", `refs/heads/${other.branch}`], env);
  if (tip.code !== 0 || !gitOk(mainCheckout, ["merge-base", "--is-ancestor", tip.stdout, commit], env)) {
    return `branch ${other.branch} is not in base ${commit}`;
  }
  return null;
}
