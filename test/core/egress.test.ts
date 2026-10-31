import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collect, close, dispatch, status, wait, type Outcome } from "../../src/core/index.ts";
import { backend, context, sandbox, task, writeReport, type Sandbox } from "./helpers/sandbox.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

const MARKERS = ["MARCADOR-CONTRATO-7f3a91", "MARCADOR-ABSOLUTO-c04e22"];

describe("verification 4, core part: no pointed content leaves the core (R17)", () => {
  // Protects: Spec 6 egress. Fails if the content of a pointed file reaches
  // the request, the backend, an envelope or a refusal message.
  test("markers never appear in request, sends, envelopes or refusals", async () => {
    sb.commit("docs/contract.md", `contrato ${MARKERS[0]}\n`, "contract with marker");
    const absolute = join(sb.root, "absolute.md");
    writeFileSync(absolute, `fora do repo ${MARKERS[1]}\n`);
    const be = backend(sb, { statusAfterSend: "idle" });
    const ctx = context(sb, be);
    const pointers = [{ label: "contract", path: "docs/contract.md" }, { label: "notes", path: absolute }];
    const outcomes: Outcome[] = [];

    const d = await dispatch({ task: task({ request: { role: "radiant-dev", pointers } }), humanApproved: false }, ctx);
    outcomes.push(d);
    outcomes.push(await dispatch({ task: task({ id: "TC-0099.2", writes: ["x/"], request: { role: "radiant-dev", pointers: [...pointers, { label: "gone", path: "docs/missing.md" }] } }), humanApproved: false }, ctx));
    outcomes.push(await dispatch({ task: task(), humanApproved: false }, ctx));
    outcomes.push(await status({ ids: [], all: true }, ctx));
    writeReport(d.envelope.tasks[0]?.worktree ?? "", ".radiant/reports/TC-0099.1.md", "relatório sem marcador\n");
    outcomes.push(await wait({ ids: ["TC-0099.1"], timeoutMs: 100 }, ctx));
    outcomes.push(await collect("TC-0099.1", ctx));
    outcomes.push(await close({ id: "TC-0099.1", discardWorktree: false }, ctx));

    const surfaces = [
      ...outcomes.map((o) => JSON.stringify(o)),
      ...be.calls.map((c) => JSON.stringify(c)),
      ...readdirSync(join(sb.stateHome, "demerzel", "projects")).flatMap((key) => {
        const dir = join(sb.stateHome, "demerzel", "projects", key, "tasks");
        return readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8"));
      }),
    ];
    expect(outcomes[1]?.envelope.refusal?.code).toBe("task-invalid");
    expect(outcomes[2]?.envelope.refusal?.code).toBe("task-exists");
    expect(be.effectCalls().some((c) => c.op === "send")).toBe(true);
    for (const surface of surfaces) for (const marker of MARKERS) expect(surface).not.toContain(marker);
  });
});
