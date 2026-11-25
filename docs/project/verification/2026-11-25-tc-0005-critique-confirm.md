# TC-0005 confirmation critique

- **Date:** 2026-11-25
- **Contract:** [TC-0005 revision 3](../contracts/TC-0005-herdr-tabs.md)
- **Reviewed commit:** `47276061a77c254de2e7f5783566bb5bd3257d60` (`test(herdr): close workspace-tab verification gaps`, head of PR #67)
- **Reviewer:** `agy`, Gemini 4 Neon High (read-only, headless run with a command allow-list for `git`, `grep`, `cat`, `ls`, `sed`, `nl`, `head`, `tail`, `wc`, `awk`, in a detached checkout in `/tmp` made non-writable; refs and worktree status of the repository were unchanged afterwards)

VERDICT: PASS

- **resolved** (Major 1, Z6): Default-workspace recovery after duplicate removal is now proved against real herdr 0.9.5. After closing the duplicate workspace, `AFTER-DUPLICATE` dispatches with default `ctx()`, asserts `created` is `["worktree", "tab", "pane"]` with non-null `backend_ids.tab`, verifies the labeled tab in the project workspace via a fresh `backend.snapshot()`, and closes that retry tab before Z8 (`test/herdr/scenario.ts:139-155`). Confirmed live in a 30/30 `bun run scenario:herdr` run.
- **resolved** (Major 1, Z7): Mapped-workspace placement is now observed directly in real herdr rather than trusting recorded routing alone. `MAPPED` asserts `project_workspace.id`, `source: "config"`, exact `created` kinds, non-null `backend_ids.tab`, presence of the labeled tab in the mapped workspace snapshot, and absence of that tab ID or label from the directory-named workspace (`test/herdr/scenario.ts:157-171`). Confirmed live in the 30/30 scenario run.
- **resolved** (minor, stale comments - S1, S2, S3, S4, T4, F1, X1, X2): Contradictory historical workspace-centric and pre-T4 partial-confirmation comments and test names in the backend suite were updated to reflect per-tab pane selection, atomic T4 confirmation, scoped F1 fallback, and tab close (`test/herdr/backend.test.ts:177-337`, `test/herdr/backend.test.ts:665-862`, `test/herdr/backend.test.ts:925-926`).
- **resolved** (minor, new-test annotations - Spec 7, TC-0005 section 9): Every test in both new tabs suites now has explicit `Protects:` and `Fails if` annotations (`test/core/tabs.test.ts:33-215`, `test/herdr/tabs.test.ts:36-347`), and the Z6/Z7 additions in the scenario are annotated as well (`test/herdr/scenario.ts:144-161`).
- **resolved** (minor, V3/X6): Both fake layers now observe a pre-0.19 task with `{ kind: "workspace", id }` in `created` and no `project_workspace`, verify `status` leaves the record unmodified while reporting the idle agent, and verify `close` closes only the recorded tab while preserving the legacy workspace, its extra human tab, and the legacy `created` list (`test/core/tabs.test.ts:214-239`, `test/herdr/tabs.test.ts:303-328`).
- **resolved** (minor, R2 config-source missing): Added a dedicated test for a missing workspace sourced from `herdr.workspace_labels`, asserting exit `2`, `project-workspace-missing`, exact message with label, config source, and main checkout path, and zero effects or published waiting recovery (`test/herdr/tabs.test.ts:330-344`).
- **resolved** (minor, C1 redaction and EB-04): Added a dedicated invalid-label test using a key with quotes and a backslash and a secret value, asserting `herdr.workspace_labels`, `JSON.stringify(key)`, and omission of the secret value (`test/herdr/tabs.test.ts:346-359`).
- **resolved** (minor, Z1 `ownerSessionsTouched` env): The scenario isolation summary now checks both `serverEnv["XDG_CONFIG_HOME"] !== configHome` and `env["XDG_CONFIG_HOME"] !== configHome` alongside the `dz-test-` session prefix (`test/herdr/scenario.ts:211`).
- **resolved** (nits, output 9 and verification report): The paragraph under the `demerzel/config.json` example now documents `herdr.workspace_labels` (`README.md:68-71`), and the verification report fixes the contract path typo, records the independent FAIL verdict and follow-up honestly, updates test and scenario counts, and leaves the pre-follow-up clean-clone and mutation rows accurately labeled (`docs/project/verification/2026-11-24-tc-0005-herdr-tabs.md:5-145`, `docs/project/verification/2026-11-24-tc-0005-herdr-tabs.md:293`).
- **nit** (output 10, smoke timing): `bothWorking` in the optional smoke script remains unchanged and is explicitly documented as a timing limitation for the owner-present authenticated smoke (`test/herdr/smoke.ts:222-225`, `docs/project/verification/2026-11-24-tc-0005-herdr-tabs.md:139-145`). Acceptable for Build acceptance; no new blocker or major was introduced.
- **nit** (R2 `next` assertion): The new config-source missing test checks the exact refusal `message` without asserting `refusal.next` (`test/herdr/tabs.test.ts:340-343`); `refusal.next` itself matches R2 in `src/core/workspace.ts:12`.

Verification run on commit `4727606` (read-only):
- All 6 files modified in `4727606` are within TC-0005 section 4 Allowed scope; read-only paths against entry `c08d493` have zero diff; `git diff --check` is clean; forbidden herdr call grep in `src/` has zero matches.
- `check_project.py` and `check_contract.py` at pin `93d61c0` pass.
- `bun run test:core` (no `python3` on PATH): 245 pass, 0 fail.
- `bun test test/herdr test/cli.test.ts test/radiant`: 341 pass, 0 fail.
- `bun run scenario:herdr` (real herdr 0.9.5, isolated `dz-test-*` server): 30/30 checks passed, `ownerSessionsTouched: false`, `sessionDirRemoved: true`.
- `tsc --noEmit` was not executed here because `node_modules` is not present in this detached read-only checkout; CI `bun run check` will cover it alongside the green matrix run.

READ-ONLY CONFIRMED: no files modified

## Limits

`tsc --noEmit` was not run in that detached checkout because `node_modules` was absent; it is covered by `bun run check` in CI. The two nits (smoke `bothWorking` timing and no `refusal.next` assertion in the new R2 config-source test) are accepted and are not blockers.
