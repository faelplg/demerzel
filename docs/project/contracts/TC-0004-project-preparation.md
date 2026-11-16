# Radiant Task Contract - Demerzel - Increment 7, project preparation

**Contract ID:** `TC-0004`
**Contract revision:** 2, 2026-11-15. Revision 1 received the critique of
Codex in `gpt-6-astra`, role `radiant-grill`: nine objections, all accepted
by the owner and applied in revision 2 and in Spec 0.15, before any Build
([critique](../verification/2026-11-14-tc-0004-grill.md))
**Project:** `demerzel`
**Iteration:** Plan 0.8, increment 7
**Status:** `READY`
**Lifecycle:** `draft` until the critique is applied and the owner approves
the PR; `active` when `ACTIVE.md` points here on `main`
**Owner:** Fael (human); Build by an agent in the `radiant-dev` role;
orchestrator responsible for the independent critique
**Risk tier:** `2`. Demerzel starts running commands declared by the
project, with the user's environment and network, and the change moves
worktree creation and the lock model of `dispatch`, which every task goes
through. Test effects stay in temporary repositories, with the fake backend
or the fake herdr, and the herdr scenario on its own isolated server
**Capability:** `default`
**Engineering Baseline:** `Radiant Engineering Baseline v0.1`
**Engineering Profile:** `none`
**Radiant reference:** `9612a8cd5396a1d77776faf462dc48c8bd9d734a`, the pin
of `.radiant.json`
**Build entry commit:** the `main` commit where `ACTIVE.md` starts pointing
to this contract, recorded in the report before the first edit

## 1. Objective

> **A dispatched task starts in a worktree its project has already
> prepared: the core creates the branch and the worktree with
> `git worktree add` for both harnesses, runs the commands of the project's
> `.demerzel.json` from the base commit in it, without holding the project
> lock, and only then opens the session and starts the agent. A failed
> preparation stops the task in `launch-failed` before any session.**

## 2. Why this task exists

**Source plan/spec:**

- [Plan 0.8](../PLAN.md), increment 7, and
  [faelplg/demerzel#30](https://github.com/faelplg/demerzel/issues/30).
- [Spec 0.15](../SPEC.md): section 2.3 (registry layout, task lock, write
  order, recovery), 2.5 (session and hook), 2.6 (project preparation),
  section 4 (`dispatch` and `status`), section 5 (`project-config-invalid`
  and the `wrong-lifecycle` note), section 6, and section 7, verification
  10.
- The [prepared worktree probe](../verification/2026-11-14-prepared-worktree-probe.md),
  with both harnesses starting in a worktree created and prepared before the
  agent, 0 of 5 dialogs each.
- TC-0025 in faelplg/aikm ([faelplg/aikm#45](https://github.com/faelplg/aikm/pull/45)):
  every unit started without `node_modules` and improvised its own install.

**Issue #30, done when:** a dispatched unit can run its project's check
without preparing dependencies on its own, the Spec says where the
preparation is declared, when it runs (before the first effect or after the
worktree exists) and what a failed preparation does to the task, and a test
proves it with the fake backend.

**Hypothesis or risk reduced:**

- A dispatched unit can run its project's check without preparing anything
  on its own, so the contract's work is the only work the agent does.
- Moving the preparation out of the project lock keeps the parallel
  dispatch of independent units, the product's main flow, whatever the
  preparation takes. The task lock is what keeps recovery correct once the
  project lock is released in the middle of a `dispatch`.

## 3. Inputs

- `docs/project/SPEC.md` (revision 0.15) and `docs/project/PLAN.md` (0.8).
- The core in `src/core/`: `dispatch` in `src/core/commands/dispatch.ts`,
  the lock in `src/core/lock.ts`, the registry in `src/core/registry.ts`,
  the recovery and the status `interrupted` logic, and the fake backend.
- `src/core/git.ts`, which runs Git with the given environment and no
  timeout, and `src/core/commands/common.ts`, where `planRecovery` reads
  every task, plans the recovery in memory and publishes it later.
- The herdr backend in `src/herdr/backend.ts`: today `launch` creates the
  worktree, with `herdr worktree create` for Codex and through the
  `WorktreeCreate` hook running `git worktree add` for Claude Code.
- The herdr scenario in `test/herdr/scenario.ts` and the smoke in
  `test/herdr/smoke.ts`.
- Checked by the orchestrator on 2026-11-14 with herdr server 0.9.0,
  Claude Code 2.1.311 and Codex 0.169.0, in the probe above:
  - a `WorktreeCreate` hook whose command is only
    `printf '%s' '<existing worktree>'` makes Claude Code, launched at the
    trusted root, use that worktree with no dialog, `foreground_cwd` equal
    to it, no lock added, and the worktree kept after the workspace closes;
  - `herdr workspace create --cwd <worktree>` followed by
    `herdr agent start --kind codex` starts Codex in a worktree created by
    `git worktree add`, with no dialog.

Do not infer missing inputs that would materially change the solution. A
gap in the Spec is `HOLD`, not a Build decision.

## 4. Allowed scope

### Paths allowed to change

```text
src/core/
src/herdr/
src/cli/                (only what the new refusal and status need)
test/core/              (see the exception in output 6)
test/herdr/             (see the exception in output 6)
test/cli.test.ts        (see the exception in output 6)
test/radiant/           (only fixtures and assertions that the new order touches)
.demerzel.json          (new, output 5)
README.md               (output 7)
docs/project/verification/
```

### Paths read-only

Read-only for the Build agent. The orchestrator changes `ACTIVE.md` and this
contract's status line, to activate and to close it, outside the Build.

```text
src/radiant/
src/cli.ts
docs/project/SPEC.md
docs/project/PLAN.md
docs/project/FRAME.md
docs/project/contracts/
package.json
tsconfig.json
bun.lock
.gitignore
.radiant.json
.github/
AGENTS.md
```

### External systems allowed

- `git`, and the commands that test fixtures declare in their own
  `.demerzel.json`, all inside temporary folders of the test.
- The real herdr only through `bun run scenario:herdr`, on the isolated
  server the script starts and stops, never in session `lab`.
- No `claude` or `codex`: the smoke is the orchestrator's, with the owner
  present.

### Network

`DENIED` for the Build agent. No fixture preparation may need the network.

### Execution units

A single unit, with no `radiant-units` block.

## 5. Required outputs

1. The project file, by Spec 2.6: the core reads `.demerzel.json` from the
   base commit's tree, validates entry type and content, and refuses with
   `project-config-invalid` before any effect. The commands and their source commit are recorded in
   `recorded`.
2. Worktree creation in the core, by Spec 2.5 and 2.6: `dispatch` runs
   `git -C <project> -c core.hooksPath=<empty folder> worktree add -b <branch> <path> <commit base>`
   for both harnesses after `launching`, and records branch and worktree in
   `created`. The `Backend` interface no longer creates worktrees:
   - Codex opens its session with
     `herdr workspace create --cwd <worktree> --label <label> --no-focus`;
   - the Claude Code `WorktreeCreate` hook only runs
     `printf '%s' '<path>'`, with the path quoted for POSIX `sh`;
   - the fake backend follows the new interface, with every call recorded.
3. The preparation runner, by Spec 2.6: argv with no shell, cwd in the
   worktree, stdin from `/dev/null`, its own process group with its ID
   recorded, the log in `logs/<id>/prepare.log`, a command done only when
   its group is empty, stop at the first failure, the 10 minute limit across
   all commands with `SIGTERM` and `SIGKILL` 5 s later, the identity check
   after the last command, and the outcome recorded. The
   limit and the grace period are fixed for users and injectable only
   through the command context, for tests.
4. The task lock, by the protocol table of Spec 2.3: `locks/<id>.lock`,
   taken and released by each command as the table says, with `task-busy`
   for `resume`, `collect` and `close` when it is held, recovery that reads
   a task only after taking its lock and publishes only past all refusals,
   and a `status` that opens lock files read-only and never creates one.
5. `.demerzel.json` at this repository's root with
   `["bun", "install", "--frozen-lockfile"]`, so Demerzel is its own first
   example.
6. Tests for each requirement of section 7, in `bun run check`. Existing
   tests in `test/core/`, `test/herdr/`, `test/cli.test.ts` and
   `test/radiant/` change only where they assert that the backend creates
   the worktree, the exact sequence of backend calls in `dispatch`, the
   command that holds the project lock during a `dispatch`, how `status`
   decides `interrupted`, or the list of registry files a no-effect check
   compares, which may leave out `locks/` only while still comparing every
   task file, branch, worktree and backend call. Each such change goes in the report with the test
   name and the reason.
7. The README: `.demerzel.json` in Setup, and the item about worktrees
   without dependencies removed from "Not supported yet".
8. The scenario `bun run scenario:herdr` updated so that, for both modes,
   the worktree is created and prepared by a fixture `.demerzel.json`
   before the agent, and run by the Build. The smoke `test/herdr/smoke.ts`
   updated so that each real agent is asked to read a file the preparation
   wrote; it is run by the orchestrator, not the Build.
9. `docs/project/verification/<date>-tc-0004-preparation.md` with the entry
   commit, the Completion report, the evidence of section 11 and the
   traceability table. The orchestrator adds the smoke, the independent
   critique and the CI link.

Do not create additional artifacts without observed need.

## 6. Non-goals

This task **must not**:

- open tabs in the project's herdr workspace instead of a workspace per
  task; that is increment 9,
  [faelplg/demerzel#29](https://github.com/faelplg/demerzel/issues/29);
- change the Codex launch for its update prompt; that is increment 8,
  [faelplg/demerzel#43](https://github.com/faelplg/demerzel/issues/43);
- let the integration add, remove or change preparation commands, or read
  preparation from `.radiant.json`;
- run a preparation through a shell, or pass anything from the contract to
  it;
- print the preparation's output on Demerzel's stdout or stderr, or put it
  in a refusal, a reason or the request;
- make the time limit configurable by the user or the project;
- stop preparation processes left running by a killed `dispatch`;
- change `src/radiant/`, `src/cli.ts`, the stack, `bun.lock`,
  `tsconfig.json`, the CI or `AGENTS.md`;
- launch a real harness or use session `lab`;
- add a runtime or development dependency.

Finding an improvement outside this scope does not authorize implementing
it. Record it as an observation or Learn Back candidate.

## 7. Functional requirements

Each item points to the Spec, which stays the source.

Project file (output 1):

- [ ] F1. `.demerzel.json` is read from the base commit, never from the
  working tree; absent at that commit, nothing is prepared and `dispatch`
  behaves as before apart from worktree creation (Spec 2.6).
- [ ] F2. `schema` other than `1`, an unknown key, `prepare` that is not a
  list, a command that is not a non-empty list of strings, an empty string,
  a string with NUL, or a file that is not JSON is `project-config-invalid`,
  exit `2`, with no effect. The message names the file, the commit and the
  rule, never a value from the file.
- [ ] F3. An empty `prepare` prepares nothing and records an empty list.
- [ ] F4. Absent means the base commit's tree read with no
  `.demerzel.json` entry. A symlink, directory or submodule entry, or a Git
  error reading the tree or the blob, is `project-config-invalid` with no
  effect; a preparation is never skipped because a read failed.
- [ ] F5. The commands and the commit they came from are in `recorded`,
  before the first effect, and a recovery or a later command never reads
  `.demerzel.json` again for that task.

Worktree and backend (output 2):

- [ ] W1. The core creates branch and worktree with `git worktree add` for
  both harnesses, after `launching` and before any backend effect, and each
  enters `created` as soon as it exists.
- [ ] W2. Codex opens its workspace with `--cwd <worktree>`; no
  `herdr worktree create` is left in `src/`.
- [ ] W3. The Claude Code hook runs only `printf '%s' '<path>'`, recorded in
  `recorded`; the launch check of Spec 2.5 is unchanged and still catches a
  hook that prints another path.
- [ ] W4. `close`, `close --discard-worktree`, recovery of `launching` and
  the launch check keep their Spec behavior with the new creation path.
- [ ] W5. Worktree creation runs no Git hook: a `post-checkout` hook in the
  fixture project does not run, in both harness paths.

Preparation (output 3):

- [ ] P1. Commands run in order, with the worktree as cwd, stdin from
  `/dev/null`, Demerzel's environment and no shell: an argument with spaces,
  `$HOME` or `;` reaches the program unchanged.
- [ ] P2. A program with a `/` is found relative to the worktree; one
  without is found on `PATH`.
- [ ] P3. Output of every command goes, in order, to
  `logs/<id>/prepare.log`, with one header line per command giving its
  index; nothing reaches Demerzel's stdout or stderr.
- [ ] P4. The first command that exits non-zero, ends by signal or cannot
  start stops the preparation; later commands do not run.
- [ ] P5. Past the limit, the process group gets `SIGTERM` and, 5 s later,
  `SIGKILL`; a child of the command that ignores `SIGTERM` is gone after
  the grace period.
- [ ] P6. A failed preparation takes the task to `launch-failed`, with
  branch and worktree in `created`, no backend session effect, exit `1`,
  and a reason with the command index, its program, the exit code, signal
  or limit, and the log path, never the log's content.
- [ ] P7. A successful preparation records each command's exit code and
  duration and the log path, and the task goes on to the session.
- [ ] P8. A command whose leader exits `0` while a child keeps running
  fails with "left processes running"; the child is gone after the grace
  period and the next command does not run. The limit counts all commands
  together: two commands that each fit the limit but not together fail it.
- [ ] P9. A preparation that commits, switches the branch or detaches
  `HEAD` in the worktree fails the identity check, for Codex and Claude
  Code alike, before any session effect; untracked and ignored files pass.
  The reason names the broken invariant and the commits involved, not a
  command (Spec 2.6).

Locks (output 4):

- [ ] L1. `dispatch` takes the task lock under the project lock before
  writing `recorded` and holds it until its last record, including
  `launch-failed`.
- [ ] L2. The project lock is free while the preparation runs: another
  `dispatch` of an independent task, in another process, completes while
  the first one is still preparing.
- [ ] L3. If the project lock cannot be taken back within 30 s after the
  preparation, the task goes to `launch-failed` with that reason, recorded
  under the task lock, and `dispatch` exits `1`.
- [ ] L4. Recovery by `dispatch`, `resume` and `close` recovers a
  `recorded` or `launching` task only when it gets that task's lock without
  waiting, reads the task again after taking it, and recovers it only if it
  is still in `recorded` or `launching`; with the lock held, it leaves the
  task and its file untouched. With a barrier, a recovery that saw the task
  as `launching` before its `dispatch` recorded `launch-failed` (L3) does
  not overwrite that record.
- [ ] L5. A `dispatch` killed while a command runs leaves the task in
  `launching` with `prepare_started_at` and the process group's ID. A later
  `dispatch` of an independent task that gets past its refusals takes it to
  `launch-failed` with branch and worktree in `created` and the group named
  in the reason; a `resume` of that task, refused, and a `dispatch` that is
  refused publish no recovery and leave the file unchanged.
- [ ] L6. `status` shows `interrupted: true` for a task in `recorded` or
  `launching` whose task lock is free, and not for one whose `dispatch` is
  alive, including during its preparation; it creates no lock file and
  writes nothing.
- [ ] L7. `resume`, `collect` and `close` of a task whose lock another
  process holds are `task-busy`, exit `2`, with no effect, and none of them
  waits on a task lock while holding the project lock.
- [ ] L8. A task file is only ever written by the holder of its task lock;
  `collect` and `close` of the same task stay serialized between processes.

Boundary:

- [ ] B1. `src/core/` still imports nothing from `src/radiant/` and names no
  Radiant file (verification 2), and `bun run test:core` still runs with
  only `git` and `bun` on `PATH`.

## 8. Engineering Check

| Baseline | Status | Application in this task | Evidence |
| --- | --- | --- | --- |
| EB-01 Deliberate complexity | REQUIRED | One creation path for both harnesses; one lock added, with a single rule for who writes a task | Diff review |
| EB-02 Correctness and contracts | REQUIRED | Refusal before any effect; the preparation read from the base commit; recovery correct while the project lock is released | Refusal tests with proof of no effect; multi-process lock tests |
| EB-03 Verification and tests | REQUIRED | Fake backend and fake herdr in `check`; real herdr in the scenario; real harnesses in the smoke | `bun run check`, scenario log, smoke record |
| EB-04 Security and privacy | REQUIRED | No shell; output only in the registry log; nothing from the log in messages or the request | Tests P1, P3 and P6; marker test of verification 4 still passing |
| EB-05 Maintainability | REQUIRED | The backend no longer knows how worktrees are made | Boundary test; `Backend` interface diff |
| EB-06 Dependencies | REQUIRED | None added | `bun.lock` with no diff |
| EB-07 Diagnostics | REQUIRED | A failed preparation says which command, how it ended and where the log is | Assertions on the `--json` envelope and the text |
| EB-08 Experience and efficiency | APPLICABLE | Parallel dispatch is not serialized by a slow preparation | Test L2 |

## 9. Project-specific constraints

- Bun and strict TypeScript, without loosening `tsconfig.json`.
- Every process under test runs with `HOME`, `XDG_STATE_HOME` and
  `XDG_CONFIG_HOME` in the test's own folders; the owner's real
  configuration and registry are never read or written.
- Isolated Git in tests, as in TC-0001: empty `GIT_CONFIG_GLOBAL`,
  `GIT_CONFIG_NOSYSTEM=1`, fixed identity.
- Fixture preparations are small scripts or `git`, `sh` and `bun` calls
  that need no network; a test that needs a slow preparation waits on a
  file the test controls, not on a long sleep.
- Every multi-process test has a timeout and cleans up its children, so a
  regression fails instead of hanging the suite.
- New user-facing messages are in English, by the owner's rule; existing
  Portuguese messages stay until
  [faelplg/demerzel#41](https://github.com/faelplg/demerzel/issues/41).
- The flock of the task lock uses the same `bun:ffi` path as the project
  lock.

## 10. Dependency policy

### New runtime dependency allowed?

`NO`. No new development dependency either. If one seems necessary, it is
`HOLD`.

## 11. Verification plan

### Automated

```text
bun install --frozen-lockfile
DEMERZEL_RADIANT_ROOT=<checkout at the pin> bun run check
bun run test:core            (still without python3 and Radiant)
bun run scenario:herdr       (isolated herdr server, both modes)
git diff --exit-code <entry commit> -- bun.lock tsconfig.json .gitignore .github package.json AGENTS.md src/radiant src/cli.ts
git status --porcelain       (empty after the final commit)
```

### In the CI

The same `bun run check`, on both systems of the matrix. The report carries
the link to the green run on the Build PR.

### Mutation

The Build breaks each rule below on purpose, shows a test failing and undoes
it, with the commit before the break and the result taken from the exit
code:

- the preparation run under the project lock;
- recovery ignoring the task lock;
- recovery publishing from the copy it read before taking the task lock;
- a child left running by a command that exits `0` accepted;
- worktree creation without `core.hooksPath`;
- the identity check after the preparation removed;
- an unreadable `.demerzel.json` treated as absent;
- `status` deciding `interrupted` by the project lock;
- the preparation run before the worktree exists, or after the session
  opens;
- a failed preparation followed by the session and agent;
- the log's content copied into the reason;
- `.demerzel.json` read from the working tree instead of the base commit;
- the commands joined into one shell string;
- only the command's own pid killed at the limit, instead of its group.

### Readback

- Reopen a task recorded by `dispatch` with a preparation and check the
  commands, the source commit, `prepare_started_at`, the outcome, the log
  path and `created` against Spec 2.3 and 2.6.
- `git diff --stat <entry commit>` and `git status --porcelain`: no change
  outside section 4.

### Smoke, by the orchestrator

With the owner present, `DEMERZEL_SMOKE_REPO=<throwaway repository> bun run smoke:herdr`
with a `.demerzel.json` in the throwaway repository: Claude Code and Codex
each launched through Demerzel, each reading the file the preparation wrote,
recorded in the report.

### Independent critique

`REQUIRED`, done by the orchestrator outside the Build, after the Completion
report and the green CI on the Build PR: a `radiant-verifier` in a harness
other than the Build's, chosen by the owner, run in a named tab of the
`demerzel` workspace in herdr `lab`, reading this contract, the Spec, the
diff against the entry commit and the report. The objections and what was
done with each go in the report. Self-review does not count.

## 12. Acceptance criteria

The task can only be declared `DONE` when:

- [ ] each requirement F1 to F5, W1 to W5, P1 to P9, L1 to L8 and B1 has a
  test or evidence, linked in the traceability table;
- [ ] `bun run check` passes in a clean clone, and `bun run test:core`
  still runs without `python3`;
- [ ] the CI `check` passed on both systems of the matrix;
- [ ] `bun run scenario:herdr` passed with both modes preparing before the
  agent;
- [ ] the smoke passed for both harnesses, with each agent reading the
  prepared file;
- [ ] the mutations of section 11 were shown failing;
- [ ] against the entry commit, the existing tests changed only by the
  exception of output 6, and the read-only paths of section 4 did not
  change;
- [ ] the independent critique was done by the orchestrator and each
  objection was accepted with a fix or declined with a reason;
- [ ] there was no change outside the Allowed scope, against the entry
  commit;
- [ ] the final evidence was read, not just assumed from the exit code.

## 13. HOLD conditions

Stop and ask for a decision when:

- the Spec does not decide a behavior that changes the registry, the
  lifecycle, an exit code, a refusal code, a lock or the request;
- the real herdr or a real harness behaves differently from the probe of
  section 3;
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
- verification shows a regression in the core, the herdr backend, the CLI or
  the Radiant integration;
- a `project-config-invalid` refusal leaves an effect;
- an agent starts after a failed preparation;
- a recovery writes a task whose `dispatch` is alive;
- preparation output reaches a message, a reason or the request.

Do not mask `FAIL` as `DONE WITH NOTES`.

## 15. Change budget

The agent may:

- organize `src/core/`, `src/herdr/` and their tests as the work needs;
- write fixtures and test helpers inside `test/core/` and `test/herdr/`;
- adjust `test/radiant/` fixtures only where the new dispatch order touches
  them.

The agent may not, without HOLD:

- change a read-only path, the Spec, the Plan or this contract;
- change the stack or the CI;
- add features not asked for, such as a configurable time limit or tabs in
  the project's workspace.

## 16. Completion report

Written in the verification report of output 9, with Status (`DONE`,
`HOLD` or `FAIL`), Changed, Verification evidence, Engineering notes,
Remaining limitations and Learn Back candidate, in the format of the Radiant
Task Contract template at the reference above. The Build delivers with the
status its evidence supports; the contract's `DONE` waits for the green CI,
the smoke and the independent critique.

Known limitations, to record in the report:

- preparation processes left running by a killed `dispatch` are not
  stopped, and may keep writing in the worktree after the recovery; the
  recovery's reason names their process group;
- checkout filters, such as a Git LFS smudge, still run inside
  `git worktree add`, under the project lock and without Demerzel's time
  limit or log, as before this contract;
- a process that leaves its group, as with `setsid`, is not seen by the
  rule that a command is done when its group is empty;
- worktree creation runs no Git hook, which changes what a project with a
  `post-checkout` hook got from `herdr worktree create` or the old
  `WorktreeCreate` hook;
- the preparation uses the user's environment and network; a project whose
  preparation needs the network fails offline, and Demerzel does not tell
  the two apart;
- AIKM has no `.demerzel.json` yet; adding it is AIKM's change, after this
  contract.

## 17. Completion rule

> **Do not declare DONE because the code looks correct. Declare DONE only
> when the observable criteria, the applicable engineering and the
> verification evidence converge.**
