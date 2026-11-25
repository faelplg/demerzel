# Radiant Task Contract - Demerzel - Increment 9, tabs in the project's herdr workspace

**Contract ID:** `TC-0005`\
**Template version:** `0.4`\
**Contract revision:** 3, 2026-11-24. Revision 1 received the cross-vendor
critique of `agy` in `gemini-4-argon-high`, role `radiant-grill`: verdict
PASS, with no blocker or major, three minors and two nits, all applied in
revision 2 before any Build. Revision 3 applies the owner's decision of
2026-11-24 to accept the two High findings of the Copilot review on
[PR #66](https://github.com/faelplg/demerzel/pull/66) and fix them in the
contract before any Build: the label fallback is scoped to the recorded
project workspace and checks who owns the tab (requirements F1 to F4,
section 18, decision 9)
([critique and review record](../verification/2026-11-23-tc-0005-grill.md))\
**Project:** `demerzel`\
**Iteration:** Plan 0.12, increment 9\
**Status:** `DONE`\
**Lifecycle:** `done` on 2026-11-25, with the Build in
[faelplg/demerzel#67](https://github.com/faelplg/demerzel/pull/67), the
evidence in `docs/project/verification/2026-11-24-tc-0005-herdr-tabs.md`,
and the confirmation verdict in
`docs/project/verification/2026-11-25-tc-0005-critique-confirm.md`\
**Owner:** Fael (human); contract authored by an agent (`claude-code`,
model `claude-opus-5-5`, effort `high`); Build by an agent in the
`radiant-dev` role; orchestrator responsible for the independent critique\
**Risk tier:** `2`. Every `dispatch` and every `close` changes what it opens
and closes in herdr, and `snapshot()`, which every command that talks to the
backend reads, changes shape. A wrong lookup could start a unit in another
project's workspace, and a wrong close could end a human's tab or another
unit's working agent. No new process is run from the project and no new
egress is opened. Test effects stay in temporary repositories, with the fake
backend or the fake herdr, and the herdr scenario on its own isolated server\
**Capability:** `default`\
**Engineering Baseline:** `Radiant Engineering Baseline v0.1`\
**Engineering Profile:** `docs/project/ENGINEERING-PROFILE.md`\
**Radiant reference:** `93d61c0e1f39025e55cc10049cc82c9854c04434`, the pin
of `.radiant.json`\
**Build entry commit:** the `main` commit where `ACTIVE.md` starts pointing
to this contract, recorded in the report before the first edit; not the
commit that adds this file

## 1. Objective

> **A dispatched unit opens as a tab labeled `<task id> <agent name>` in
> its project's existing herdr workspace, found by the project label in the
> configured session, for both Claude Code and Codex. `dispatch` refuses,
> with no effect, when that workspace is missing or ambiguous, and never
> creates one. `close` closes only the unit's tab and never the workspace.
> Several Demerzel units live side by side as tabs of one workspace, and
> `snapshot()`, recovery and `close` track each one by its own tab.**

## 2. Why this task exists

**Source plan/spec:**

- [Plan 0.12](../PLAN.md), increment 9, and
  [faelplg/demerzel#29](https://github.com/faelplg/demerzel/issues/29).
- [Spec 0.18](../SPEC.md): section 2.3 (what a task records, recovery of
  `launching`), 2.4 (`herdr` block), 2.5 (herdr operations, labels, launch
  table, postcondition), 2.6 (worktree created by the core), section 4
  (`dispatch` and `close`), section 5 (refusals), section 7, item 7 (herdr
  scenario).
- The Learn Back of TC-0025 in faelplg/aikm, recorded in Plan increment 6:
  the owner keeps one herdr workspace per project in session `lab` and
  wants each unit there as a tab.

**Issue #29, done when:** a dispatched unit opens as a labeled tab in the
project's herdr workspace for both Claude Code and Codex, `close` closes
only that tab, the Spec (section 2.5) says how the workspace is found, and
the herdr scenario proves it.

The issue's comment of 2026-11-06 is partly stale: since Spec 0.15
([faelplg/demerzel#30](https://github.com/faelplg/demerzel/issues/30),
TC-0004) the core already creates and prepares the worktree for both
harnesses, and the Claude Code `WorktreeCreate` hook only prints the
prepared path. What is left is only where the backend opens the session and
what it closes.

**Hypothesis or risk reduced:**

- The owner sees every unit of a project in the workspace already open for
  that project, instead of one new workspace per unit, which is the herdr
  layout the owner works in.
- Several units in one workspace is the product's main flow (parallel
  dispatch of independent units). Today `snapshot()` refuses a workspace
  with two Demerzel agents in different panes, so moving to tabs without
  per-tab tracking would break every command as soon as the second unit
  starts. This contract removes that limit before any real use.

## 3. Inputs

- `docs/project/SPEC.md` (revision 0.18) and `docs/project/PLAN.md` (0.12).
- The core: `Backend` and `Snapshot` in `src/core/backend.ts` (one
  `{ id, label, tab, pane }` per workspace, `closeWorkspace` as the only
  close); `TaskRecord` and `BackendIds` in `src/core/types.ts`; `dispatch`
  in `src/core/commands/dispatch.ts`, where probe, snapshot, recovery
  planning and every refusal run under the project lock before the task lock
  and `recorded`, and the backend's first effect comes after worktree
  creation and preparation; `close` in `src/core/commands/close.ts` and
  `planRecovery`, `agentState` and `workspaceLabel` in
  `src/core/commands/common.ts`, which find a workspace by recorded ID or by
  the task label `${id} ${agent_name}`; the fake backend in
  `src/core/fake-backend.ts`.
- The herdr backend in `src/herdr/backend.ts`: `launch` runs
  `herdr workspace create` (Codex with `--cwd <worktree>`, Claude Code with
  `--cwd <main checkout>`); `snapshot()` checks every relation, refuses two
  workspaces under one task label (`TASK_LABEL = /^\S+ dz-[0-9a-f]{16}$/`)
  and refuses a workspace with Demerzel agents in two panes; `closeWorkspace`
  treats `workspace_not_found` as closed.
- `src/herdr/config.ts` (only `session` allowed, unknown keys refused) and
  `src/core/config.ts` (the `herdr` block passes through to the backend);
  `src/cli/run.ts`, which parses the `herdr` block before any command and
  refuses with `config-invalid`.
- `src/core/project.ts`: the main checkout is the real path of the parent of
  `git rev-parse --git-common-dir`, the same from a linked worktree.
- The fake herdr in `test/herdr/helpers/fake-herdr.ts` and `fake.ts`, the
  backend tests in `test/herdr/backend.test.ts`, the scenario in
  `test/herdr/scenario.ts` and the smoke in `test/herdr/smoke.ts`, both on
  their own `dz-test-*` and `dz-smoke-*` servers.
- Issue #29 and its comment: on herdr 0.9.0,
  `herdr tab create --workspace <id> --cwd <worktree> --label <text>` opened
  a tab inside an existing workspace.
- Checked by the contract author on 2026-11-23 with herdr 0.9.5 (client and
  server), on an isolated server in session `dz-probe-<pid>` with its own
  `XDG_CONFIG_HOME` under `/tmp`, removed afterwards, never session `lab`:
  - `herdr tab create --workspace w1 --cwd /tmp --label "T-1 dz-0123456789abcdef" --no-focus`
    answers `{"type":"tab_created","tab":{...},"root_pane":{...}}` with no
    `workspace` object; `tab.workspace_id`, `root_pane.workspace_id` and
    `root_pane.tab_id` name the workspace and the new tab, and `tab.label`
    is the label given;
  - `herdr api snapshot` lists every tab with `tab_id`, `workspace_id`,
    `number` and `label`; a tab created by `workspace create` is labeled
    `"1"`;
  - herdr accepts two tabs with the same label in one workspace and two
    workspaces with the same label;
  - `herdr tab close <tab_id>` answers `{"type":"ok"}`; on a tab that no
    longer exists it answers `tab_not_found`, exit `1`;
  - closing the last tab of a workspace removes the workspace: after
    `tab close` of its only tab, `workspace list` no longer shows it.

Do not infer missing inputs that would materially change the solution. A
gap in the Spec, once revision 0.19 of output 1 is written, is `HOLD`, not a
Build decision.

## 4. Allowed scope

### Paths allowed to change

```text
docs/project/SPEC.md    (output 1 only)
docs/project/PLAN.md    (output 1 only)
src/core/
src/herdr/
src/cli/                (only what the new refusals or view fields need, and the English next of output 6)
test/core/              (outputs 7 and 8)
test/herdr/             (outputs 7, 8 and 10)
test/cli.test.ts        (outputs 7 and 8)
test/radiant/           (only fixtures and assertions that the project workspace touches)
README.md               (output 9)
AGENTS.md               (only if a command or rule it states changes; none is expected)
docs/project/verification/
```

### Paths read-only

Read-only for the Build agent. The orchestrator changes `ACTIVE.md` and this
contract's status and lifecycle lines, to activate and to close it, outside
the Build.

```text
src/radiant/
src/cli.ts
src/core/project-config.ts
src/core/prepare.ts
src/core/lock.ts
docs/project/FRAME.md
docs/project/ENGINEERING-PROFILE.md
docs/project/contracts/
.demerzel.json
package.json
tsconfig.json
bun.lock
.gitignore
.radiant.json
.github/
```

### External systems allowed

- `git`, inside temporary folders of the tests.
- The real herdr only through `bun run scenario:herdr`, on the isolated
  `dz-test-*` server the script starts and stops, never in session `lab`.
- No `claude` or `codex`: the smoke is the orchestrator's, with the owner
  present.

### Network

`DENIED` for the Build agent.

### Execution units

A single unit, with no `radiant-units` block. The change is one interface
move: the `Snapshot` shape, the `Backend` close operation and the new
workspace lookup are used together by the herdr backend, the fake backend,
`dispatch`, `close` and recovery, and every test layer asserts on both
sides. A split would leave each unit with a half-migrated interface and
`bun run check` failing between them.

## 5. Required outputs

1. Spec 0.19 and Plan 0.13, written in the Build's first commit and before
   any code, with exactly this content, in English:
   - Spec header: revision 0.19, 2026-11-23 or the Build date, and one
     sentence saying it launches units as tabs in the project's herdr
     workspace, for faelplg/demerzel#29.
   - Spec 2.3: a task records the project workspace it was dispatched to
     (`project_workspace`, output 4) and its tab and pane IDs; since 0.19
     `created` never lists a workspace, because Demerzel creates none;
     recovery of `launching` finds the tab by recorded ID or, without it,
     through the label fallback, only in the recorded project workspace and
     only for a tab that passes the ownership check (requirements F1 to F4
     and V1 to V3).
   - Spec 2.4: `herdr.workspace_labels` in the example and its rules
     (requirements C1 to C3).
   - Spec 2.5: the table rows "Criar sessão" for both harnesses become
     `herdr tab create --workspace <project workspace> --cwd <path> --label <label> --no-focus`,
     with the cwd of requirement T1 and T2; "Encerrar" becomes
     `herdr tab close <tab>`, with the discard unchanged; the bullet "No
     herdr 0.9.0, `workspace create` abre um workspace próprio" is replaced
     by the project workspace lookup (requirements R1 to R6) and the
     last-tab behavior (X4); the label bullet says the task label is the
     tab's label and the project workspace keeps its own; a bullet states
     the per-tab snapshot rules (S1 to S5); a bullet states the label
     fallback, its scope to the recorded project workspace and its
     ownership check (F1 to F4). The minimum version stays 0.9.0,
     with the note of section 18, refinement 6.
   - Spec 4: `dispatch` lists the workspace lookup among the core refusals
     under the project lock; `close` closes the unit's tab, not the
     workspace, and its row of the command matrix gains `tab-not-owned`
     (requirement F3).
   - Spec 5: the three refusals of requirements R2, R3 and F3 in the table
     of refusals this Spec adds.
   - Spec 7: item 7 rewritten for requirement Z1 to Z9, and a new item 12,
     "Tabs in the project workspace (Plan increment 9, faelplg/demerzel#29)",
     listing the fake herdr and fake backend proofs of section 7.
   - Spec 9: a "Revision 0.19" table with the owner decisions of section 18
     and the refinements of section 18 the owner approved with this
     contract, each with its discarded alternative.
   - Plan 0.13: the header line and "Revision 0.13 gives increment 9 its
     Spec change and its Task Contract", and increment 9 linking this
     contract. Closing the increment in "Feito" is the orchestrator's, after
     `DONE`.
2. The project workspace lookup, by requirements R1 to R6: a pure `Backend`
   operation over the snapshot the command already read, called by
   `dispatch` among its refusals, with the two new refusal codes.
3. Tabs instead of workspaces in the herdr backend and in the fake backend,
   by requirements T1 to T5, F1 to F4 and X1 to X6, with the core refusal
   `tab-not-owned` of F3: `launch` opens a tab in the
   recorded project workspace; `closeWorkspace` is replaced by
   `closeTab(tabId)` in the `Backend` interface; no `herdr workspace create`,
   `workspace close` or `worktree create` is left in `src/`.
4. The registry change: `TaskRecord.project_workspace`,
   `{ id: string; label: string; source: "directory" | "config" }`, written
   in `recorded` before the first effect and absent on tasks recorded before
   revision 0.19; `backend_ids.workspace` holds the same ID from `recorded`
   on; `created` lists `worktree`, `tab`, `pane` and `agent`, never
   `workspace`, for tasks recorded since 0.19.
5. The per-tab snapshot, by requirements S1 to S5, in `Snapshot`, the herdr
   backend and the fake backend, and the recovery and observation that read
   it, by V1 to V3.
6. The configuration field `herdr.workspace_labels`, by requirements C1 to
   C3, in `src/herdr/config.ts`, and an English `next` for every
   `parseHerdrConfig` refusal in `src/cli/run.ts`, such as "Fix the herdr
   block of the Demerzel configuration and run again.", replacing the
   Portuguese one, so a `herdr.workspace_labels` refusal is English in both
   its message and its `next` (requirement E1).
7. Tests for each requirement of section 7, in `bun run check`, with the
   fake herdr serving `tab create`, `tab close`, labeled tabs, several tabs
   per workspace and agents per tab, and the fake backend providing, by
   default, one project workspace for the sandbox's project so that the
   existing core tests keep their meaning.
8. Tests that exist at the entry commit in `test/core/`, `test/herdr/`
   (other than `scenario.ts` and `smoke.ts`, which output 10 rewrites),
   `test/cli.test.ts` and `test/radiant/` change only where they assert a
   per-task workspace (its creation, its label, its close, `workspace` in
   `created`, the old `Snapshot` shape or the old
   one-Demerzel-agent-per-workspace refusal), the herdr minimum version
   reported by a fake, or need a project workspace in the fake's initial
   state. This includes the partial-confirmation tests of
   `test/herdr/backend.test.ts` (findings K2, L1 and L2 of the TC-0002
   verifications: a creation answer without the tab, without the root pane,
   without the workspace object, with an empty workspace ID, naming another
   workspace, or with a tab that contradicts the root pane, alone or with a
   lost reconciliation snapshot). They are rewritten against `tab create`
   by requirement T4: a partial or contradictory answer records nothing
   from itself; with a working reconciliation snapshot, the tab and pane
   found by the label fallback of F1 and F2 are recorded; with a lost one,
   or a candidate that fails F2, the task
   ends `launch-failed` with `backend_ids.tab` and `backend_ids.pane` null,
   and a later `close` uses the label fallback (X1). The case "without the
   workspace object" is the normal `tab create` answer of herdr 0.9.5, so
   its test becomes "without `tab.workspace_id`". Each such change goes in
   the report with the test name and the reason.
9. The README: Setup says to create, in the configured herdr session, one
   workspace labeled with the project's directory name, or to map it in
   `herdr.workspace_labels`; the configuration example and its paragraph
   gain the field; the `close` line says it closes the unit's tab; the item
   about a workspace per unit is removed from "Not supported yet".
10. The scenario `bun run scenario:herdr` updated by requirements Z1 to Z9
    and run by the Build. The smoke `test/herdr/smoke.ts` updated so that
    its isolated server first gets a workspace labeled with the throwaway
    repository's directory name, and both harnesses run at the same time as
    two tabs of it; it is run by the orchestrator, not the Build.
11. `docs/project/verification/<date>-tc-0005-herdr-tabs.md` with the entry
    commit, the Completion report, the evidence of section 11 and the
    traceability table. The orchestrator adds the smoke, the independent
    critique and the CI link.

Do not create additional artifacts without observed need.

## 6. Non-goals

This task **must not**:

- create, rename, close or focus a herdr workspace, in any case, including
  when the project workspace is missing, ambiguous or would be removed by
  herdr with its last tab;
- close, rename or focus any tab other than the unit's own, or move a
  unit's tab between workspaces;
- look for the project workspace in any session other than the configured
  one, or in any way other than the exact label match of requirement R1;
- read the workspace label from `.demerzel.json`, `.radiant.json` or the
  Radiant integration; the override is the user's `herdr` block only;
- change the worktree creation, the preparation, the locks, the request,
  the launch postcondition, the Codex update override or the effort table;
- re-resolve the project workspace after `recorded`, or relaunch, resend or
  move a unit by itself;
- migrate the registry files of tasks recorded before revision 0.19;
- translate existing Portuguese messages; that is
  [faelplg/demerzel#41](https://github.com/faelplg/demerzel/issues/41);
- change `src/radiant/`, `src/cli.ts`, the stack, `bun.lock`,
  `tsconfig.json` or the CI;
- launch a real harness or use session `lab`;
- add a runtime or development dependency.

Finding an improvement outside this scope does not authorize implementing
it. Record it as an observation or Learn Back candidate.

## 7. Functional requirements

Each item points to the Spec 0.19 section that output 1 writes, which stays
the source once written.

Configuration (output 6, Spec 2.4):

- [ ] C1. `herdr.workspace_labels` is optional. When present it is a JSON
  object, not `null` or an array. Each key is an absolute path, `/`
  separated, with no empty, `.` or `..` segment, no trailing `/` and no
  control character (U+0000 to U+001F and U+007F), and is compared byte for
  byte with the project's main checkout real path (Spec 2.3), without
  resolving symlinks in the key. A key whose path does not exist on this
  machine is accepted and never matches. Each value is a string of 1 to 128
  characters, with no control character and no leading or trailing
  whitespace. Anything else is `config-invalid`, exit `2`, for every
  command, before any effect, with a message in English that names
  `herdr.workspace_labels`, the offending key written with
  `JSON.stringify`, so a key holding a line break cannot break the
  line-oriented text output, and the rule, never the value; its `next` is
  the English one of output 6.
- [ ] C2. The `herdr` block still refuses unknown keys; `session` keeps its
  rules and its `--session` on every call.
- [ ] C3. Without a matching key, the project label is the main checkout's
  directory name (`basename` of the real path), so a dispatch from a linked
  worktree of the project, such as `.claude/worktrees/<name>`, looks for the
  same label as one from the main checkout.

Workspace lookup (output 2, Spec 2.5 and 4):

- [ ] R1. `dispatch` resolves the project workspace from the snapshot it
  already read under the project lock, among the core refusals, after
  `agent-name-taken` and before the task lock, `recorded` and the recovery
  publication. A workspace matches when its herdr label is exactly the
  project label: same bytes, same case, no trimming, no prefix match. The
  lookup makes no herdr call of its own.
- [ ] R2. No match is the refusal `project-workspace-missing`, exit `2`. The
  message names the label, its source (the main checkout's directory name,
  or `herdr.workspace_labels` for that path) and the main checkout; `next`
  says to create a herdr workspace with that label in the configured
  session, or to map the path in `herdr.workspace_labels`. Demerzel never
  creates the workspace.
- [ ] R3. Two or more matches is the refusal `project-workspace-ambiguous`,
  exit `2`, with the label and every matching workspace ID in the message;
  none is chosen. `next` says to rename or close the extra workspaces, or to
  map the path to a unique label.
- [ ] R4. Both refusals have no effect, by Spec 5: no task file, branch,
  worktree, tab, preparation, backend effect call or published recovery.
  The project lock file may exist, as before.
- [ ] R5. The resolved workspace ID, label and source are written in
  `recorded` (output 4) and never resolved again for that task. If the
  workspace is gone when the tab is created, for example closed by the human
  during the preparation, `tab create` fails and the task goes to
  `launch-failed` with branch and worktree in `created`, exit `1`, and the
  herdr error in `backend_error`.
- [ ] R6. Only `dispatch` resolves the workspace. `resume`, `status`,
  `wait`, `collect`, `close` and `units` never refuse because the project
  workspace is missing or ambiguous.

Tabs (output 3, Spec 2.5):

- [ ] T1. Codex: `herdr tab create --workspace <recorded workspace> --cwd <worktree> --label "<task id> <agent name>" --no-focus`.
- [ ] T2. Claude Code: the same with `--cwd <main checkout>`, so Claude Code
  still starts at the trusted root and enters the worktree through the
  `WorktreeCreate` hook, which still only prints the prepared path; the
  launch postcondition of Spec 2.5 is unchanged and still catches a hook
  that prints another path.
- [ ] T3. `agent start`, `agent prompt`, `agent get` and the wait keep their
  Spec 2.5 argv apart from the pane ID; every Codex launch still passes
  `-c check_for_update_on_startup=false` before `--model`; no permission or
  trust flag appears.
- [ ] T4. The `tab create` answer is all or nothing. It confirms the tab
  and the pane only when `tab.tab_id`, `root_pane.tab_id`,
  `root_pane.pane_id`, `tab.workspace_id` and `root_pane.workspace_id` are
  all present as non-empty strings, `tab.tab_id` equals `root_pane.tab_id`,
  and both workspace IDs equal the recorded workspace. A `workspace` object
  is not expected, since herdr 0.9.5 sends none, and is ignored if present.
  Any other answer, partial or contradictory, records nothing from itself:
  the launch fails, and the failure path looks for the tab in a fresh
  snapshot through the label fallback of F1 and F2, recording that tab and
  its pane only when the candidate passes; with that snapshot lost too, or
  a candidate that fails F2 (F3), nothing is recorded, and a later `close`
  uses the label fallback again (X1). This replaces today's
  rule that lists each resource a partial answer confirms (findings K2 and
  L2 of the TC-0002 verifications), so that `close` and recovery never act
  on a tab or pane the answer did not fully confirm; the tests of output 8
  change with it. Each confirmed resource enters `created` once: `tab`,
  `pane`, then `agent`; never `workspace`.
- [ ] T5. No `herdr workspace create`, `herdr workspace close` or
  `herdr worktree create` call is left in `src/`.

Snapshot (output 5, Spec 2.5):

- [ ] S1. `Snapshot` exposes `workspaces: { id, label }[]`,
  `tabs: { id, workspace, label, pane }[]` and
  `agents: { name, status, pane, tab }[]`, where an agent's `tab` is the
  tab of its pane, as herdr's snapshot gives it and S4 checks; the
  ownership check of F2 reads it. A tab's
  `pane` is the pane of the Demerzel agent in it; without one, the first
  pane holding a named agent; without agents, the tab's first listed pane;
  `null` for a tab with no pane.
- [ ] S2. Two Demerzel agents in different tabs of one workspace are a
  valid snapshot, and each is observed in its own tab; two Demerzel agents
  in different panes of one tab are refused as a broken snapshot.
- [ ] S3. Among the tabs of one workspace whose label matches the task
  label pattern (`^\S+ dz-[0-9a-f]{16}$`), labels are unique; two such tabs
  in one workspace with one label refuse the snapshot (`BackendError`, so
  `backend-unavailable` before a command's first effect) rather than one
  being chosen. The same task label on tabs of different workspaces is a
  valid snapshot: it is never a duplicate, and only the tab in the task's
  recorded project workspace can be a candidate (F1). Tabs with other
  labels, such as the human's `"1"`, and workspace labels may repeat
  freely.
- [ ] S4. A tab without `label`, `number`, `tab_id` or `workspace_id`, a tab
  of a workspace outside the snapshot, and every relation already checked
  today, refuse the snapshot as a broken answer, never as an absent tab.
- [ ] S5. An agent is `lost` when its name is not in the snapshot or its
  pane is not the pane of any tab; non-Demerzel tabs, panes and agents in
  the project workspace change no Demerzel task's observed state.

Label fallback (outputs 3 and 5, Spec 2.3, 2.5, 4 and 5):

- [ ] F1. The label fallback finds a task's tab when its `backend_ids.tab`
  is `null` and the task records `project_workspace`. It is used only by
  the failure path of T4, by recovery (V1) and by `close` (X1). Its only
  candidates are the snapshot's tabs whose `workspace` equals
  `project_workspace.id` and whose label is exactly the task label; by S3
  there is at most one. A tab with the task label in any other workspace
  is ignored: it is never recorded, written to `backend_ids` or `created`,
  or closed, and it never makes the snapshot fail as a duplicate. A task
  with no `project_workspace`, recorded before revision 0.19, has no label
  fallback; it is observed, recovered and closed by its recorded IDs only
  (V3, X6), and no workspace is looked up by label for it.
- [ ] F2. Ownership check. The agents of a candidate are the snapshot's
  agents whose `tab` is the candidate (S1). The candidate passes when it
  has no agent, or when its only agent is the task's recorded
  `agent_name`. Any other agent in it, Demerzel's (a `dz-` name of another
  task) or any other named agent, alone or beside the task's own agent,
  fails the check. A candidate that fails is never recorded, written to
  `backend_ids` or `created`, or closed.
- [ ] F3. A candidate that fails F2:
  - in the failure path of T4, records nothing; the task ends
    `launch-failed` with `backend_ids.tab` and `backend_ids.pane` `null`,
    and its failure reason names the candidate tab and its agents;
  - in recovery (V1), is not adopted: the task is recovered as if no tab
    had been found, and its recovery history entry's detail gains exactly
    `tab_not_owned: { tab: <candidate tab ID>, agents: [<its agent names, sorted>] }`;
  - in `close` (X1), is the core refusal `tab-not-owned`, exit `2`, with no
    effect by Spec 5: checked after `task-working` and before the recovery
    is published, so no task file is written, no `tab-found` entry is
    added, no recovery is published and no backend effect call is made.
    The message, in English, names the task, the candidate tab, its
    workspace, its agents and the task's own agent name; `next` is "Check
    that tab in herdr. If it is not this unit's, rename or close it
    yourself, then run close again." Renaming it leaves no candidate, so
    the next `close` closes no tab and records `tab_closed: null` (X2).
- [ ] F4. A candidate with no agent passes F2 on purpose: it is the tab of
  a task whose dispatch stopped between `tab create` and `agent start`, or
  whose `tab create` answer and reconciliation snapshot were lost, and
  recovery and `close` must still record and close it. herdr 0.9.5's
  snapshot does not tell it apart from an empty tab a human labeled
  `<task id> <agent name>` in the project workspace, and no heuristic on
  the cwd, pane title, tab number or process is added to try, since any of
  them could refuse that real pre-start tab. The residual risk is a known
  limitation (section 16).

Recovery (output 5, Spec 2.3):

- [ ] V1. Recovery of `launching` finds the tab by recorded
  `backend_ids.tab`, or, without it, through the label fallback of F1 in
  the recorded project workspace; records the tab and its pane in
  `created` and `backend_ids` only when it passes the ownership check of
  F2, and otherwise follows F3; finds the agent by name; never adds a
  workspace to `created`.
- [ ] V2. With two tabs under the task label in the recorded project
  workspace, the snapshot is refused (S3), so the recovery is not planned
  and nothing is published. A tab with the task label in another workspace
  changes nothing (F1).
- [ ] V3. A task recorded before revision 0.19, with no
  `project_workspace`, is recovered and observed by its recorded IDs and
  agent name; its per-task workspace is not looked up by label.

Close (output 3, Spec 4):

- [ ] X1. `close` finds the unit's tab by recorded `backend_ids.tab`, or,
  without it, through the label fallback of F1 in the recorded project
  workspace, with the ownership check of F2; a candidate that fails F2 is
  the refusal `tab-not-owned` of F3. A tab found by label and passing F2
  is written to `backend_ids.tab` with the history entry `tab-found`,
  detail exactly
  `{ tab: <found tab ID>, by: "label" }`, before the close.
  `backend_ids.pane` is left as it is, also when `null`, and `created` is
  not changed by `close`. When the tab is in the snapshot, `close` runs
  `herdr tab close <tab>`; it never calls `workspace close`.
- [ ] X2. `tab_not_found` counts as closed. Any other failure writes the
  history entry `close-failed`, detail exactly
  `{ tab: <tab ID>, backend_error: <the backend error> }`, keeps the
  lifecycle and exits `1`, as with the workspace today. A successful close
  writes `closed` with detail exactly
  `{ tab_closed: <tab ID>, last_tab_in_workspace: <boolean> }`, where
  `tab_closed` is the ID `tab close` ran on, including one answered
  `tab_not_found`, or `null` when no tab of the task was in the snapshot
  and no call was made, and `last_tab_in_workspace` follows X4.
- [ ] X3. The project workspace, the human's tabs and other units' tabs,
  working or not, stay open after a `close`; proven with another unit's
  live agent in the same workspace.
- [ ] X4. When the unit's tab is the only tab of its workspace in the
  snapshot read by `close`, Demerzel still closes only the tab, records
  `last_tab_in_workspace: true` in the `closed` history entry, and does not
  prevent, undo or report as an error that herdr 0.9.5 then removes the
  emptied workspace; the next `dispatch` refuses with
  `project-workspace-missing` until the human recreates it. While the
  human's own tab or any other tab is in the workspace, this never happens.
  `last_tab_in_workspace` is `false` when any other tab, of any kind,
  remains in that workspace in the snapshot, and when the task's tab was
  not in the snapshot at all.
- [ ] X5. `task-working` still refuses a working agent, with or without the
  return; `--discard-worktree` still runs `git worktree remove` without
  `--force`, exits `1` and keeps the worktree when Git refuses, and on a task
  already `closed` repeats the discard with no backend call.
- [ ] X6. A task recorded before revision 0.19 closes its recorded tab with
  `tab close`; herdr removes its per-task workspace with that last tab, and
  a legacy workspace with extra tabs stays open for the human. Without a
  recorded tab it has no label fallback (F1): no tab is closed, and
  `closed` records `tab_closed: null`.

Messages and boundary:

- [ ] E1. Every new or changed user-facing message, refusal `next` and
  history reason is in English, including the `next` that `src/cli/run.ts`
  gives every `parseHerdrConfig` refusal (output 6); untouched Portuguese
  messages stay until #41.
- [ ] B1. `src/core/` still imports nothing from `src/radiant/` or
  `src/herdr/`, names no Radiant file (Spec 7, item 2), and never reads the
  `herdr` configuration block; `bun run test:core` still runs with only
  `git` and `bun` on `PATH`.

Real herdr scenario (output 10, Spec 7, item 7), on the isolated
`dz-test-*` server with `agent start` refused by the shim:

- [ ] Z1. It never reads or writes session `lab` or the owner's
  `~/.config/herdr`, and still prints `ownerSessionsTouched: false`.
- [ ] Z2. Before any workspace has the project label, a Codex `dispatch` is
  `project-workspace-missing` with no branch, no worktree, no task file and
  no herdr effect call in the shim log.
- [ ] Z3. It creates, through the real herdr, one workspace labeled with the
  sandbox repository's directory name; a Codex and a Claude Code `dispatch`
  each open a tab in it with the task label, `--cwd` the worktree for Codex
  and the main checkout for Claude Code, and end in `launch-failed` with
  `created` exactly `worktree`, `tab`, `pane`.
- [ ] Z4. Both units' tabs are listed at once in that workspace, with their
  labels, and `backend.snapshot()` and `status` succeed.
- [ ] Z5. `close` of one unit removes its tab only; the workspace, its
  first tab and the other unit's tab remain; the shim log has `tab close`
  and no `workspace close`.
- [ ] Z6. A second workspace with the project label makes `dispatch`
  `project-workspace-ambiguous` with no effect; after it is closed by the
  scenario, dispatch works again.
- [ ] Z7. With `herdr.workspace_labels` mapping the sandbox's main checkout
  real path to another label, and a workspace with that label, the tab
  opens there and not in the directory-named workspace.
- [ ] Z8. A unit whose tab is left as the only tab of its workspace (the
  scenario closes the workspace's first tab through herdr) is closed with
  `last_tab_in_workspace: true` recorded and no `workspace close` call; the
  scenario prints whether herdr removed the workspace, as evidence for the
  report.
- [ ] Z9. The checks the scenario has today still pass: the preparation
  before the session in both modes, a failed preparation with no herdr
  session, `close` without discard keeping worktree and branch, the discard
  with changes exiting `1`, the repeated discard, and the server dropping
  between probe and snapshot.

## 8. Engineering Check

| Baseline | Status | Application in this task | Evidence |
| --- | --- | --- | --- |
| EB-01 Deliberate complexity | REQUIRED | One lookup, pure over the snapshot already read; one close operation; no workspace creation path and no placeholder tab | Diff review; `Backend` interface diff |
| EB-02 Correctness and contracts | REQUIRED | Refusals before any effect; the workspace decision recorded and never re-read; per-tab identity in snapshot, recovery and close; the label fallback limited to the recorded project workspace and to a tab with no agent or only the task's own; no other tab ever recorded or closed | Refusal tests with proof of no effect; close tests with neighbor tabs and a working neighbor agent; fallback tests with the task label in another workspace and on a tab hosting a foreign agent |
| EB-03 Verification and tests | REQUIRED | Fake backend and fake herdr in `check`; real herdr in the scenario; real harnesses in the smoke | `bun run check`, scenario log, smoke record |
| EB-04 Security and privacy | APPLICABLE | No new egress, process or flag; config messages never echo a label value; the request is unchanged | Marker test of Spec 7, item 4, still passing; C1 message test |
| EB-05 Maintainability | REQUIRED | The core knows a "project workspace" only through the `Backend` port and never reads the `herdr` block | Boundary test B1 |
| EB-06 Dependencies | REQUIRED | None added | `bun.lock` and `package.json` with no diff |
| EB-07 Diagnosis | REQUIRED | Missing and ambiguous say which label, from where, and which IDs; `tab-not-owned` names the tab, its workspace, its agents and the task's agent; a config key is quoted with `JSON.stringify`; `tab-found`, `close-failed`, `closed` and the recovery's `tab_not_owned` carry the exact details of X1, X2 and F3, including the tab and whether it was the workspace's last tab | Assertions on the `--json` envelope, the text and the history details, compared whole |
| EB-08 Experience and efficiency | APPLICABLE | Units appear in the workspace the owner already uses; `--no-focus` keeps the owner's focus | Scenario Z3 and Z4; smoke |

### Practices

| Practice | Serves | Why it applies here | Evidence |
| --- | --- | --- | --- |
| `ports-and-adapters` | EB-03, EB-05 | `Backend` is the port through which the core drives herdr, and this task changes the port, not only an adapter | `Backend` diff; boundary test B1 |
| `solid-lsp` | EB-02 | The fake backend substitutes the herdr backend in the core suite; both must honor the same lookup, snapshot and close rules or the core tests prove nothing | The same requirement tests run against the fake backend and, through the fake herdr, the herdr backend |
| `test-strategy` | EB-03 | Behavior to prove at three layers: unit and command tests with fakes, the real herdr scenario, the real harness smoke | Section 11 |

## 9. Project-specific constraints

- Bun and strict TypeScript, without loosening `tsconfig.json`.
- Every process under test runs with `HOME`, `XDG_STATE_HOME` and
  `XDG_CONFIG_HOME` in the test's own folders; the owner's real
  configuration, registry and herdr sessions are never read or written.
- Isolated Git in tests, as in TC-0001: empty `GIT_CONFIG_GLOBAL`,
  `GIT_CONFIG_NOSYSTEM=1`, fixed identity.
- A fake used as evidence for a herdr property, such as a duplicate tab
  label, the same tab label in two workspaces, an agent's `tab_id` in the
  snapshot, a tab answer naming another workspace, or the workspace removed
  with its last tab, has that property checked against the probe answers of
  section 3 or the scenario, so the fake cannot agree with a wrong backend.
- New user-facing messages are in English, by the owner's rule; existing
  Portuguese messages stay until #41.
- Each test names the behavior it protects and the regression that would
  make it fail (Spec 7).

## 10. Dependency policy

### New runtime dependency allowed?

`NO`. No new development dependency either. If one seems necessary, it is
`HOLD`.

## 11. Verification plan

### Automated

```text
bun install --frozen-lockfile
DEMERZEL_RADIANT_ROOT=/tmp/radiant-pin-93d61c0 bun run check
bun run test:core            (still without python3 and Radiant)
bun run scenario:herdr       (isolated herdr server, never lab)
PYTHONDONTWRITEBYTECODE=1 python3 /tmp/radiant-pin-93d61c0/validators/check_project.py .
PYTHONDONTWRITEBYTECODE=1 python3 /tmp/radiant-pin-93d61c0/validators/check_contract.py docs/project/contracts/TC-0005-herdr-tabs.md --profile docs/project/ENGINEERING-PROFILE.md
git diff --check <entry commit>
git diff --exit-code <entry commit> -- bun.lock package.json tsconfig.json .gitignore .github .radiant.json .demerzel.json src/radiant src/cli.ts src/core/project-config.ts src/core/prepare.ts src/core/lock.ts docs/project/FRAME.md docs/project/ENGINEERING-PROFILE.md docs/project/contracts
git status --porcelain       (empty after the final commit)
grep -rn -e '"workspace", "create"' -e '"workspace", "close"' -e '"worktree", "create"' src/   (no match)
```

`/tmp/radiant-pin-93d61c0` is a clean checkout of `faelplg/radiant` at the
pin; any clean checkout at the pin may stand in for it.

### In the CI

The same `bun run check`, on both systems of the matrix. The report carries
the link to the green run on the Build PR.

### Focused verification

- Each refusal of R2, R3, C1 and F3 with exit `2`, its code in the JSON,
  and no effect: no task file written, no branch, worktree, fake backend
  effect call or fake herdr effect call, and no published recovery of an
  interrupted task that was waiting.
- Two units dispatched into one workspace, both agents alive in the fake
  herdr; `status`, `wait`, `resume` and `close` of each see its own agent and
  tab; `close` of one leaves the other working.
- A human tab and a human agent in the project workspace, with labels and
  panes of their own, ignored by uniqueness and never closed.
- Recovery of an interrupted `launching` task whose tab was created but not
  recorded, found by label, and refused when two tabs of the recorded
  project workspace share the label.
- The label fallback (F1 to F4), each case through recovery (V1), `close`
  (X1) and, in the herdr backend, the failure path of T4:
  - (a) a tab with the same task label in another workspace, alone or
    beside the task's real tab, is ignored: not recorded, not closed, and
    `snapshot()` does not fail as a duplicate;
  - (b) a tab in the project workspace with the task label hosting a
    foreign agent, once another Demerzel unit's agent and once a non-`dz-`
    named agent, and once beside the task's own agent, is not adopted by
    recovery (with the `tab_not_owned` detail), records nothing in the T4
    failure path, and makes `close` refuse with `tab-not-owned`, exit `2`,
    with no task file written, no `tab-found` entry and no `tab close`
    call;
  - (c) the pre-`agent start` case: tab created, agent not started, no tab
    or pane ID recorded, no agent in the tab, label matching and workspace
    equal to the recorded `project_workspace`; recovery records that tab
    and its pane, and `close` writes `tab-found` and closes it;
  - a task recorded before 0.19, with no `project_workspace` and no
    recorded tab, beside a tab with its task label: nothing is found by
    label and nothing is closed.
- A task file recorded before 0.19, from a fixture, observed, recovered and
  closed by its recorded tab.

### Mutation

The Build breaks each rule below on purpose, shows a test failing and undoes
it, with the commit before the break and the result taken from the exit
code:

- the workspace lookup moved after `recorded` or after the worktree;
- the first of several matching workspaces chosen;
- a missing workspace created by `dispatch`;
- the label matched case-insensitively, trimmed or by prefix;
- `herdr.workspace_labels` ignored, or its key matched after `realpath`;
- the Claude Code tab opened with `--cwd <worktree>`, or the Codex tab with
  `--cwd <main checkout>`;
- `-c check_for_update_on_startup=false` dropped from the Codex launch;
- `close` calling `workspace close`, or closing the first tab with the task
  label when two exist;
- `close` treating `tab_not_found` as a failure;
- a `tab create` answer that names another workspace accepted;
- the tab, or the tab and pane, of a partial `tab create` answer recorded
  (T4);
- a `herdr.workspace_labels` key with a control character accepted, or
  named in a message without `JSON.stringify`;
- `workspace` added to `created`;
- the old refusal of two Demerzel agents in one workspace kept;
- duplicate task tab labels in one workspace accepted, duplicate non-task
  tab labels refused, or the same task label in two workspaces refused as
  a duplicate (S3);
- the label fallback searching every workspace instead of the recorded
  project workspace (F1, case a);
- the ownership check skipped, or passing a tab whose agents include one
  other than the task's own (F2, case b);
- `close` writing `tab-found`, publishing the recovery or calling
  `tab close` before refusing `tab-not-owned` (F3);
- a candidate with no agent refused (F4, case c);
- the label fallback used for a task with no `project_workspace` (F1);
- the project workspace re-resolved after the preparation.

### Readback

- Reopen a task recorded by `dispatch` and check `project_workspace`,
  `backend_ids` and `created` against Spec 2.3 and 2.5 at revision 0.19.
- Reopen Spec 0.19 and Plan 0.13 and check each item of output 1.
- `git diff --stat <entry commit>` and `git status --porcelain`: no change
  outside section 4, including committed, staged, unstaged and untracked
  changes.

### Smoke, by the orchestrator

With the owner present, `DEMERZEL_SMOKE_REPO=<throwaway repository> bun run smoke:herdr`,
on its own `dz-smoke-*` server with a workspace labeled with the throwaway
repository's directory name: Claude Code and Codex launched through
Demerzel at the same time as two tabs of that workspace, each reading the
prepared file and writing its return, both collected, and each `close`
leaving the workspace and the other tab open. Recorded in the report.

### Independent critique

`REQUIRED`, done by the orchestrator outside the Build, after the Completion
report and the green CI on the Build PR: a `radiant-verifier` in a vendor
other than the Build's (the Build is expected on Codex), chosen by the
owner, run in a named tab of the `demerzel` workspace in herdr `lab`,
reading this contract, Spec 0.19, the diff against the entry commit and the
report. The objections and what was done with each go in the report.
Self-review does not count. External prerequisites: the herdr server in
session `lab` and the chosen harness authenticated.

## 12. Acceptance criteria

The task can only be declared `DONE` when:

- [x] Spec 0.19 and Plan 0.13 carry every item of output 1, written before
  the first code commit of the Build;
- [x] each requirement C1 to C3, R1 to R6, T1 to T5, S1 to S5, F1 to F4,
  V1 to V3, X1 to X6, E1, B1 and Z1 to Z9 has a test or evidence, linked in
  the traceability table;
- [x] a `dispatch` with no workspace labeled with the project label, and one
  with two, each exit `2` with `project-workspace-missing` and
  `project-workspace-ambiguous`, with no task file, branch, worktree, tab or
  backend effect call;
- [x] in the fake herdr and in the real herdr scenario, both harnesses open
  a tab labeled `<task id> <agent name>` in the project workspace, Codex
  with `--cwd` the worktree and Claude Code with `--cwd` the main checkout;
- [x] two Demerzel units with live agents in one workspace are observed,
  resumed, waited on and closed independently in the fake herdr, and
  `snapshot()` never refuses that layout;
- [x] `close` runs `herdr tab close` on the unit's tab only, never
  `workspace close`, and the project workspace and every other tab remain,
  in the fake herdr and in the scenario;
- [x] (a) a tab with the task label in a workspace other than the task's
  recorded `project_workspace` is never recorded by recovery or by the T4
  failure path, never closed by `close`, and does not make `snapshot()`
  fail as a duplicate, in the fake backend and in the fake herdr;
- [x] (b) a tab in the recorded project workspace with the task label that
  hosts a foreign agent (another Demerzel unit's agent, or any other named
  agent, alone or beside the task's own) is never recorded or closed:
  recovery leaves it with the `tab_not_owned` detail, the T4 failure path
  records nothing, and `close` refuses with `tab-not-owned`, exit `2`, with
  no task file written, no `tab-found` entry, no published recovery and no
  backend effect call;
- [x] (c) a tab in the recorded project workspace with the task label and
  no agent, left by a dispatch that stopped before `agent start` with no
  tab or pane ID recorded, is recorded by recovery and closed by `close`
  with `tab-found`;
- [x] `grep` finds no `workspace create`, `workspace close` or
  `worktree create` herdr call in `src/`;
- [x] `bun run check` passes in a clean clone, and `bun run test:core` still
  runs without `python3`;
- [x] the CI `check` passed on both systems of the matrix;
- [x] `bun run scenario:herdr` passed every check, with
  `ownerSessionsTouched: false`, and the version of herdr it ran on is in the
  report;
- [x] the smoke passed for both harnesses as two concurrent tabs of one
  workspace;
- [x] the mutations of section 11 were shown failing;
- [x] against the entry commit, the tests that existed there in
  `test/core/`, `test/herdr/` (other than `scenario.ts` and `smoke.ts`),
  `test/cli.test.ts` and `test/radiant/` changed only by the exception of
  output 8, and the read-only paths of section 4 did not change;
- [x] the independent critique was done by the orchestrator in a vendor
  other than the Build's, and each objection was accepted with a fix or
  declined with a reason;
- [x] all applicable checks in section 11 pass;
- [x] there was no change outside the Allowed scope;
- [x] relevant limitations are recorded;
- [x] the final evidence was read, not just presumed from the exit code.

## 13. HOLD conditions

Stop and ask for a decision when:

- the real herdr behaves differently from the probe of section 3, such as a
  `tab create` answer of another shape, a snapshot without tab labels, a
  `tab close` that closes more than the tab, or a refusal to close a
  workspace's last tab;
- the Spec 0.19 text of output 1 does not decide a behavior that changes
  the registry, the lifecycle, an exit code, a refusal code, a lock or the
  request;
- keeping the minimum herdr version at 0.9.0 turns out to be unsafe, for
  example a 0.9.x server that accepts `tab create` but places the tab
  elsewhere;
- the change would need `src/radiant/`, `src/cli.ts` or another read-only
  path;
- a test would need the network, the owner's real configuration or session
  `lab`;
- a new dependency seems necessary;
- the minimal solution no longer fits this contract.

`HOLD` is a valid result.

## 14. FAIL conditions

Mark `FAIL` when:

- the criteria of section 12 cannot be met;
- verification shows a regression in the core, the herdr backend, the CLI,
  the preparation or the Radiant integration;
- a `project-workspace-missing`, `project-workspace-ambiguous`,
  `tab-not-owned` or `config-invalid` refusal leaves an effect;
- Demerzel creates or closes a workspace, or closes a tab that is not the
  unit's own;
- the label fallback records or closes a tab outside the task's recorded
  project workspace, or a tab hosting an agent other than the task's own;
- a working agent's tab is closed by `close` of another task;
- `snapshot()` refuses two Demerzel units in one workspace.

Do not disguise `FAIL` as `DONE WITH NOTES`.

## 15. Change budget

The agent may:

- organize `src/core/`, `src/herdr/` and their tests as the work needs,
  including renaming `workspaceLabel` to a task label helper;
- extend the fake herdr and the fake backend with tabs, per-tab agents and
  scripts for the new cases;
- adjust `test/radiant/` and `test/cli.test.ts` fixtures so that the fake
  herdr starts with a project workspace;
- write Spec 0.19 and Plan 0.13 exactly as output 1 says.

The agent may not, without HOLD:

- change a read-only path or this contract;
- change the Spec or the Plan beyond output 1;
- change the stack or the CI;
- add features not asked for, such as creating the project workspace,
  focusing tabs, a per-project override in `.demerzel.json`, or a migration
  of old task files.

## 16. Completion report

Written in the verification report of output 11, with Status (`DONE`,
`HOLD` or `FAIL`), Changed, Verification evidence, Engineering notes,
Remaining limitations and Learn Back candidate, in the format of the Radiant
Task Contract template at the reference above. The Build delivers with the
status its evidence supports; the contract's `DONE` waits for the green CI,
the smoke and the independent critique.

Known limitations, to record in the report:

- if the human closes every tab of the project workspace except a unit's,
  closing that unit removes the workspace, because herdr removes an emptied
  workspace; Demerzel records it and the next `dispatch` refuses until the
  human recreates it;
- the workspace is decided at `dispatch` and recorded; one removed during
  the preparation makes that task `launch-failed` after its worktree exists;
- a `herdr.workspace_labels` key written through a symlink never matches,
  since it is compared with the main checkout's real path; the missing
  refusal names that real path;
- two tabs under one task label in one workspace refuse every snapshot, and
  so every command that talks to the backend, until the human closes one,
  as with duplicate workspace labels before this contract; the same label
  in two workspaces does not;
- an empty tab that a human labels exactly `<task id> <agent name>` in the
  project workspace, while that task has no recorded tab, cannot be told
  apart from the task's own tab left before `agent start`, so that task's
  recovery records it and its `close` closes it (F4); a tab hosting any
  other agent is refused instead (F3);
- tasks recorded before revision 0.19 keep their per-task workspace; their
  `close` closes the recorded tab, which removes a workspace with no other
  tab, and a half-done legacy task is not found by workspace label;
- the tab operations were checked on herdr 0.9.5; on 0.9.0 only
  `tab create` was seen working (issue #29), and a 0.9.0 snapshot without
  tab labels would fail safe as `backend-unavailable`.

## 17. Completion rule

> **Do not declare DONE because the code looks right. Declare DONE only when
> the observable criteria, the applicable engineering and the verification
> evidence converge.**

## 18. Owner decisions

Decided by the owner (America/Sao_Paulo): decisions 1 to 7 on 2026-11-23,
in the message that asked for this contract; decision 8 on 2026-11-23, in
the message that asked for revision 2; and decision 9 on 2026-11-24, in
the message that asked for revision 3. They are not reopened by the Build.

1. **2026-11-23:** Write this Task Contract before the Build. The contract
   is authored by `claude-code`, model `claude-opus-5-5`, effort `high`, and
   critiqued cross-vendor by `agy`, model `gemini-4-argon-high`. **Contract
   impact:** the lifecycle line; activation waits for the critique and the
   owner's approval; the Build is a later phase, expected on Codex, so the
   independent verification of section 11 runs in another vendor.
2. **2026-11-23:** In the configured herdr session, the project's workspace
   is found by matching the project label. The default label is the project
   name, the directory name of the main checkout (for example `demerzel`,
   `aikm`), with an optional configuration override. No match refuses
   `dispatch` cleanly; several matches refuse it cleanly; Demerzel never
   creates a workspace. **Contract impact:** requirements C1 to C3 and R1 to
   R6, the refusals of output 2, non-goals 1 and 3, FAIL condition 4.
3. **2026-11-23:** The tab label is `"<taskId> <agentName>"`; the project
   workspace keeps its project name as its label. **Contract impact:**
   requirements T1, T2, S3 and V1; the Spec 2.5 label bullet of output 1.
4. **2026-11-23:** `close` closes only the unit's tab with
   `herdr tab close <tab_id>` and leaves the project workspace open even if
   this was the last Demerzel tab. The refusal of a `working` agent stays,
   and `--discard-worktree` keeps its behavior: `git worktree remove`
   without `--force`, repeatable on a task already closed, with no backend
   call on a closed task except that discard. **Contract impact:**
   requirements X1 to X6, T5, FAIL conditions 4 and 5.
5. **2026-11-23:** The tab keeps `--cwd <project root>` for Claude Code, to
   preserve the trust-dialog avoidance of Spec 0.15 and 0.18, with the hook
   still only printing the prepared worktree path, and uses
   `--cwd <worktree>` for Codex. **Contract impact:** requirements T1 to T3
   and their mutations.
6. **2026-11-23:** `snapshot()`, recovery, `close`, the `Backend` interface,
   the fake herdr, the unit tests and the real herdr scenario move from one
   Demerzel agent per workspace to per-tab tracking, so several Demerzel
   units coexist as tabs of one project workspace without breaking
   `snapshot()`. **Contract impact:** outputs 3, 5, 7 and 10, requirements
   S1 to S5, V1 to V3 and Z4, FAIL condition 6, and the single execution
   unit of section 4.
7. **2026-11-23:** English only for this increment: the contract, the later
   Spec and Plan text, code, tests, new CLI messages until #41, commits and
   the PR. **Contract impact:** requirement E1 and section 9.
8. **2026-11-23:** Apply all five findings of the cross-vendor critique of
   revision 1 (verdict PASS, three minors and two nits) in revision 2,
   before any Build, without reopening the decisions above. For the first
   finding, prefer the option that stays safest for `close` and recovery,
   never recording a resource that is not confirmed, and that matches
   herdr 0.9.5 answering `tab create` with the tab and the root pane and no
   workspace object. **Contract impact:** revision 2 takes the all-or-nothing
   option for T4 and lists the partial-confirmation tests in output 8; fixes
   the history details of X1, X2 and X4 and the EB-07 row; adds the English
   `next` of output 6 and E1; forbids control characters in C1 keys and
   quotes them with `JSON.stringify`; annotates `test/` in section 4 with
   outputs 7, 8 and 10 and narrows acceptance criterion 13 to the tests that
   exist at the entry commit
   ([critique](../verification/2026-11-23-tc-0005-grill.md)).
9. **2026-11-24:** Accept the two High findings of the Copilot review on
   [PR #66](https://github.com/faelplg/demerzel/pull/66)
   ([first](https://github.com/faelplg/demerzel/pull/66#discussion_r4674741148),
   [second](https://github.com/faelplg/demerzel/pull/66#discussion_r4674741194))
   and fix them in revision 3, before any Build, without reopening the
   decisions above. The label fallback only considers tabs of the task's
   recorded `project_workspace`; a tab with the task label in another
   workspace is ignored and is not a duplicate. A label-matched candidate
   is accepted when it hosts no agent or exactly the task's recorded agent,
   and refused with no effect when it hosts any other agent; the no-agent
   tab of a dispatch stopped before `agent start` stays recoverable, with
   no extra heuristic. A task recorded before 0.19 keeps V3 and X6.
   **Contract impact:** requirements F1 to F4; S1 (agents carry their
   tab), S3 (uniqueness per workspace), T4, V1, V2, X1 and X6; outputs 1,
   3 and 8; the refusal `tab-not-owned`; the EB-02 and EB-07 rows; section
   9; the focused verification, mutations and acceptance criteria for
   cases (a), (b) and (c); a FAIL condition; two known limitations; and
   refinements 2 and 8
   ([record](../verification/2026-11-23-tc-0005-grill.md)).

### Contract-level refinements

Not owner decisions. The owner asked the contract author to settle
implementation details consistently with Spec 0.18 and the code, and to
record them here; they take effect when the owner approves this contract,
and output 1 copies them into Spec section 9 with their discarded
alternatives.

1. **The override is `herdr.workspace_labels` in the user's
   `config.json`**, an object from the main checkout's real path to a label
   (requirement C1), for example
   `"herdr": { "session": "lab", "workspace_labels": { "/Users/fael/workspaces/github/faelplg/radiant": "radiant-core" } }`.
   The label of a herdr workspace is a machine-local fact about the owner's
   herdr layout, like `herdr.session`, not a fact about the project's code:
   another machine or contributor arranges herdr differently. Discarded: a
   key in `.demerzel.json`, which is read by the core from each base commit,
   so two dispatches from different bases could look for different
   workspaces and the core would carry a herdr fact that Spec 2.4 gives to
   the backend alone; the Spec 0.15 reason for versioning the preparation
   (what a worktree needs is part of the project) does not hold for a
   window layout. Discarded: a single string `herdr.workspace_label`, which
   would apply to every project because the file is global. Keys are
   compared with the real path, the same one the registry key hashes (Spec
   2.3), so one project always maps to one entry.
2. **Two new refusal codes**, `project-workspace-missing` and
   `project-workspace-ambiguous`, both core refusals with exit `2` and no
   effect (Spec 5). Discarded: reusing `backend-unavailable`, which tells
   the owner to start the herdr server, the wrong action. Revision 3 adds a
   third, `tab-not-owned` (refinement 8).
3. **The lookup is a pure `Backend` operation over the snapshot `dispatch`
   already read**, placed after `agent-name-taken` and before the task
   lock, so refusals stay before the first effect and recovery is published
   only past it, as Spec 2.3 requires. Discarded: resolving inside `launch`,
   after the worktree and the preparation exist, which would turn a missing
   workspace into `launch-failed` with effects.
4. **The last tab.** herdr 0.9.5 removes a workspace when its last tab
   closes (section 3). Demerzel still closes only the tab, records
   `last_tab_in_workspace`, and does not undo it (requirement X4). In the
   owner's layout the workspace has its own first tab, so a unit is never
   its last tab unless the human closed the rest. Discarded: refusing
   `close`, which would keep a finished agent's tab open with no way out;
   opening a placeholder tab first, which is creating herdr state the owner
   did not ask for.
5. **Tasks recorded before revision 0.19** are not migrated; they are
   observed and closed by their recorded tab (requirements V3 and X6).
   Discarded: keeping `workspace close` for them, which decision 4 rules
   out.
6. **The minimum herdr version stays 0.9.0**, the owner's decision of
   2026-10-17 in Spec section 9; the scenario records 0.9.5 as the version
   on which the tab operations were checked, and a 0.9.x server without tab
   labels in its snapshot fails safe (S4). Raising the minimum would reopen
   an owner decision and is left to a HOLD (section 13).
7. **Spec 0.19 and Plan 0.13 are written by the Build**, in its first
   commit, from output 1, and `ACTIVE.md` is set by the orchestrator in the
   activation PR, following the TC-0003 split of proposal and activation.
8. **The label fallback and its ownership check** (requirements F1 to F4),
   from decision 9. The candidate is limited to the recorded
   `project_workspace` because that is the only workspace the task was
   ever launched into, and the agents of a tab come from each agent's
   `tab_id` in herdr's snapshot, already parsed today. `close` refuses a
   foreign-agent candidate with the new core refusal `tab-not-owned`, exit
   `2`, no effect, because only the human can tell what that tab is;
   recovery and the T4 failure path, which close nothing and may run
   inside another task's command, only decline to adopt it, so another
   task's `dispatch` is not blocked by it. Discarded: reusing
   `task-lost`, which says the agent is gone, or `task-working`, which
   says to wait, neither the right action; `backend-unavailable` and the
   project workspace codes, which name another problem. Discarded: keeping
   S3's uniqueness across the whole snapshot, which would let one project's
   tab block every command of another. Discarded: refusing a candidate
   with no agent, or tying it to the task by cwd, pane title, tab number
   or process, which would break the recovery of a dispatch stopped before
   `agent start`; the Claude Code tab's cwd is the main checkout, which a
   human tab may share.
