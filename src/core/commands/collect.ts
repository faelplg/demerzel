import { readFileSync } from "node:fs";
import { sha256 } from "../project.ts";
import { done, isLock, isOutcome, lock, notFound, open, reportFile, reportPath, transition, view, wrongLifecycle, type Context, type Outcome } from "./common.ts";

const C = "collect";

// Spec 4: reads <worktree>/<returnPath> and records `collected` with the
// digest. It holds the lock because it writes, but it does not talk to the
// backend and does not recover other tasks (Spec 2.3, revision 0.7).
export async function collect(id: string, ctx: Context): Promise<Outcome> {
  const session = open(C, ctx);
  if (isOutcome(session)) return session;
  const { registry } = session;
  const held = await lock(C, ctx, registry);
  if (!isLock(held)) return held;
  try {
    const record = registry.read(id);
    if (record === null) return notFound(C, id);
    if (record.lifecycle !== "launched" && record.lifecycle !== "collected") return wrongLifecycle(C, record, "launched ou collected");
    const file = reportFile(record);
    if (file === null) return done(C, 1, [view(record, null)]);
    const path = reportPath(record);
    const content = readFileSync(file, "utf8");
    const digest = sha256(content);
    const changed = record.collected !== null && record.collected.digest !== digest;
    record.collected = { digest, at: new Date().toISOString() };
    transition(registry, record, "collected", { digest, digest_changed: changed }, ctx.trace);
    const v = view(record, null);
    v.collected = { content, path, digest, digest_changed: changed };
    return done(C, 0, [v]);
  } finally {
    held.release();
  }
}
