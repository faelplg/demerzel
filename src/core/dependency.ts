import type { Env } from "./env.ts";
import { git, gitOk } from "./git.ts";
import type { TaskRecord } from "./types.ts";

// Spec 5: completion is collection followed by closure, with the current
// branch tip already in the proposed base. A report alone is insufficient.
export function dependencyPending(other: TaskRecord | undefined, mainCheckout: string, commit: string, env: Env): string | null {
  if (other === undefined) return "não há tarefa com esse ID no registro";
  const events = other.history.map((h) => h.event);
  const collectedAt = events.indexOf("collected");
  if (other.lifecycle !== "closed" || collectedAt === -1 || events.lastIndexOf("closed") < collectedAt) {
    return "ela precisa estar fechada depois de coletada";
  }
  const tip = git(mainCheckout, ["rev-parse", "--verify", "--quiet", `refs/heads/${other.branch}`], env);
  if (tip.code !== 0 || !gitOk(mainCheckout, ["merge-base", "--is-ancestor", tip.stdout, commit], env)) {
    return `o branch ${other.branch} não está na base ${commit}`;
  }
  return null;
}
