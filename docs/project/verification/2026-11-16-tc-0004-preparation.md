# TC-0004 verification, project preparation

Date: 2026-11-16
Contract: [TC-0004](../contracts/TC-0004-project-preparation.md), revision 2
Spec: [revision 0.15](../SPEC.md)
Issue: [faelplg/demerzel#30](https://github.com/faelplg/demerzel/issues/30)
Radiant reference: `9612a8cd5396a1d77776faf462dc48c8bd9d734a`, the pin of
`.radiant.json`.
Procedure: the Build was done by the orchestrator, Claude Code with
`claude-opus-5-5`, in the `radiant-dev` role, by the owner's decision on
2026-11-15 and rule 5 of the `radiant-delegation` skill, as in TC-0003. The
contract is risk tier 2 with the network denied.
Build entry commit: `d85f0fe`, the merge of
[faelplg/demerzel#48](https://github.com/faelplg/demerzel/pull/48), where
`ACTIVE.md` starts pointing to TC-0004, recorded before the first edit.

## Completion report

### Status

`DONE` for the Build's own part: every requirement of section 7 has a test
or evidence, `bun run check` and `bun run test:core` pass, the scenario
passed in both modes, and every mutation of section 11 was shown failing.
One change to an existing test falls outside the exception of output 6:
the boundary test's list of files that may spawn processes (see "Existing
tests changed"). The owner accepted it on 2026-11-16. The contract's `DONE` still
waits for the green CI on the Build PR, the smoke with the owner present,
and the independent critique, which the orchestrator adds here.

### Changed

Three commits on the entry commit:

- `cf8c075`, outputs 1 to 6:
  - `src/core/project-config.ts` (new): reads `.demerzel.json` from the base
    commit with `git ls-tree -z --full-tree` and `git cat-file blob`.
    Absent means the tree was read and has no entry. A symlink, directory or
    submodule entry, a Git error on the tree or the blob, a file that is not
    JSON or one that breaks a rule is `project-config-invalid`. The message
    names the file, the commit and the rule, never a value from the file.
  - `src/core/prepare.ts` (new): the runner and the identity check. Each
    command is spawned with no shell, cwd in the worktree, stdin from
    `/dev/null`, Demerzel's environment and `detached: true`, so it leads
    its own process group. Output goes to `logs/<id>/prepare.log` with a
    header line per command. A command is done when its leader exits and
    `kill(-pgid, 0)` finds the group empty; survivors get `SIGTERM` and then
    `SIGKILL` after the grace period. The limit is one deadline across all
    commands. The limit (10 min) and the grace (5 s) come from the command
    context only when a test injects them.
  - `src/core/commands/dispatch.ts`:
    - reads the project file after the other refusals;
    - takes the task lock without waiting before publishing the recovery and
      writing `recorded`, which now carries `project_preparation`;
    - after `launching`, creates the worktree with
      `git -c core.hooksPath=<registry>/no-hooks worktree add` and records
      it in `created`;
    - with commands, records `prepare_started_at`, releases the project
      lock, runs the preparation, checks the identity, takes the project
      lock back with the 30 s wait and records the outcome, or
      `launch-failed` under the task lock alone;
    - only then calls `backend.launch`.
  - `src/core/commands/common.ts`:
    - `taskLock` gives `task-busy`;
    - `planRecovery` takes each half-done task's lock without waiting,
      rereads the task and recovers it only if still half done, names an
      interrupted preparation's process group, and returns `release`;
    - `TaskView` gains `launch_error` and `preparation`;
    - `Context` gains the two test-only limits.
  - `src/core/commands/resume.ts`, `collect.ts` and `close.ts`: the
    target's task lock after the project lock and the not-found check, and
    the task read after it.
  - `src/core/commands/status.ts`: each half-done task's lock is probed
    read-only, never created or stamped, with the task reread while the
    lock is held.
  - `src/core/lock.ts`: `ProjectLock.probe`. `src/core/registry.ts`: the
    `locks/`, `logs/` and `no-hooks/` paths. `src/core/types.ts`:
    `ProjectPreparation`.
  - `src/core/backend.ts` and `src/core/fake-backend.ts`: the backend no
    longer creates worktrees. The fake keeps its two modes only for where
    the agent starts and for the launch check.
  - `src/herdr/backend.ts`:
    - Codex opens its workspace with
      `herdr workspace create --cwd <worktree> --label <label> --no-focus`;
    - the Claude Code hook is only `printf '%s' <path quoted for sh>`;
    - the failure reconciliation no longer looks for a worktree.
  - `src/cli/text.ts`: `launch failed: <reason>` for a launch error.
  - `.demerzel.json` (new) with `["bun", "install", "--frozen-lockfile"]`.
  - Tests: new `test/core/preparation.test.ts`, `test/core/task-lock.test.ts`
    and `test/core/helpers/prepare-fixture.ts`; new cases in
    `test/herdr/backend.test.ts` and `test/cli.test.ts`; the existing
    changes below.
- `ef322e1`, output 8: the scenario and the smoke.
- `ca2f7a4`, output 7: the README.

### Existing tests changed

Each by the exception of output 6, except the last.

| Test | Change | Reason |
| --- | --- | --- |
| `test/core/interface.test.ts` > `claude-code: hook data recorded before launching` | The fake's hook data is the path alone | The hook no longer creates the worktree |
| `test/core/interface.test.ts` > `claude-code: failure after ...` | The order is worktree, workspace, agent for both harnesses | The core creates the worktree before any backend call |
| `test/core/interface.test.ts` > `claude-code: postcondition failure` | `created` starts with the worktree | Same |
| `test/core/interface.test.ts` > `write order: ...` | `wrote:created:worktree@0` instead of `@1` | The worktree is no longer a backend effect |
| `test/core/interrupt.test.ts`, the Claude Code cases of `killed after ...` | The same kill points as Codex | The worktree comes first in both modes |
| `test/herdr/backend.test.ts`, the `launch` helper | Creates the branch and worktree before calling `launch`, as `dispatch` does | The backend no longer creates them |
| `test/herdr/backend.test.ts` > `codex`, `claude-code`, `blocked startup`, `unconfirmed or broken agent start`, `claude-code agent start error after the hook`, `a creation that answers badly after creating`, `an agent that started but answered badly`, and the Claude Code cases of `a creation answer without the tab` and `... without the workspace object ...` | No `worktree` among the kinds the backend reports; the Codex call is `workspace create --cwd <worktree>` | The backend no longer creates the worktree |
| `test/herdr/backend.test.ts` > `claude-code postcondition failures` | The missing-branch case calls `launch` directly with no worktree; the base-commit case creates its worktree first | The hook no longer creates one, so each case sets up the state it checks |
| `test/herdr/helpers/fake-herdr.ts` | `worktree create` is no longer served | A call that comes back fails as `unknown_command` (W2) |
| `test/herdr/boundary.test.ts` > `processes run only from ...` | `src/core/prepare.ts` added to the allowed files | **Outside the exception.** Spec 2.6 makes the core run the project's commands, and this test allows only `run.ts`, `git.ts` and `python.ts` to spawn. The test keeps its purpose, with one more allowed file named in its comment. Accepted by the owner on 2026-11-16 |

No test of `test/radiant/` changed, and no no-effect check changed its file
list: `tasksSnapshot` still compares only `tasks/`.

### Verification evidence

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | no change |
| `DEMERZEL_RADIANT_ROOT=<checkout at the pin> bun run check` | exit 0: typecheck, core 214 pass, herdr, CLI and Radiant 201 pass |
| `bun run test:core` | 214 pass, with `PATH` holding only `git` and `bun`, no `python3` |
| `bun run scenario:herdr` | 22/22, isolated server, herdr 0.9.5, `ownerSessionsTouched: false` |
| `git diff --exit-code d85f0fe -- bun.lock tsconfig.json .gitignore .github package.json AGENTS.md src/radiant src/cli.ts` | no diff |
| `check_project.py .` at the pin | PASS |
| `git status --porcelain` after the last commit | empty |

The owner's Radiant checkout had moved to `510a2ce` during the Build, and the
Radiant tests refuse a checkout off the pin. The check ran against a local
clone of that checkout at the pin, in the session scratchpad, without
touching the owner's checkout.

Scenario, both modes from a base commit with a fixture `.demerzel.json`:

- the worktree was prepared before the session (the `prepared` event before
  the first `created` workspace);
- Codex opened its workspace with `--cwd` in the worktree, and Claude Code
  at the project root;
- a failing preparation ended in `launch-failed` with only the worktree in
  `created` and no herdr call naming its agent;
- the interposed herdr saw no `worktree create` call.

The first scenario run failed one check, the discard after `close`: the
fixture preparation had written an untracked file that Git did not ignore,
so `git worktree remove` without `--force` refused, as Spec 4 says it
should. The fixture now ignores its output, as projects ignore installed
dependencies, and the run passed. The behavior is recorded under the
limitations.

#### Mutations

Each mutation was applied on `ca2f7a4`, the test named below was run, the
result was taken from its exit code, and `src/` was restored with
`git checkout -- src`, leaving `git status` empty each time.

| Mutation | Test that failed | Exit |
| --- | --- | --- |
| The preparation run under the project lock | `an independent dispatch completes during a preparation` | 1 |
| Recovery ignoring the task lock | `a live dispatch in its preparation is not recovered` | 1 |
| Recovery publishing from the copy read before the task lock | `a recovery that read the task before its last record` | 1 |
| A child left running by a command that exits 0 accepted | `a child left running` | 1 |
| Worktree creation without `core.hooksPath` | `no post-checkout hook, codex` and `, claude-code` | 1 |
| The identity check removed | the six `identity: ...` cases | 1 |
| An unreadable `.demerzel.json` treated as absent | `an unreadable blob and an unreadable tree` | 1 |
| `status` deciding `interrupted` by the project lock | `a task in its preparation is not interrupted` | 1 |
| The preparation run before the worktree exists | `order of effects, codex` and `, claude-code` | 1 |
| The preparation run after the session opens | `order of effects, codex` and `, claude-code` | 1 |
| A failed preparation followed by the session and agent | the six `... stops the preparation, ...` cases | 1 |
| The log's content copied into the reason | the six `... stops the preparation, ...` cases | 1 |
| `.demerzel.json` read from the working tree | `read from the base commit, not the working tree` | 1 |
| The commands joined into one shell string | `argv, cwd, stdin, environment, log and results` | 1 |
| Only the command's own pid killed at the limit | `the time limit with a child that ignores SIGTERM` | 1 |

The first run of the identity mutation broke the syntax of `dispatch.ts`, so
its failure proved nothing. It was rewritten as `outcome.ok && false ? ...`
and run again, with the six identity cases failing.

#### Readback

A dispatch with two preparation commands, reopened from its task file:

- `project_preparation` has the file, the base commit, the two commands,
  `prepare_started_at`, a numeric process group, the log path, one result
  per command with exit code 0 and its duration, and `outcome: succeeded`;
- `created` is worktree, workspace, tab, pane, agent;
- the history is `recorded`, `launching`, `created` worktree,
  `prepare-started`, two `prepare-command`, `prepared`, the three session
  resources, the agent, `send-started`, `launched`, the order of Spec 2.3
  and 2.6.

### Traceability

| Requirement | Evidence |
| --- | --- |
| F1 | `preparation.test.ts` > `read from the base commit, not the working tree`, `absent, without prepare, and empty`; mutation |
| F2 | `preparation.test.ts` > the 13 `project-config-invalid: ...` cases, each with no task file, Git change or backend effect |
| F3 | `preparation.test.ts` > `absent, without prepare, and empty` |
| F4 | `preparation.test.ts` > `a symlink, a directory and a submodule entry`, `an unreadable blob and an unreadable tree`; mutation |
| F5 | `preparation.test.ts` > `recorded before the first effect and never read again`; readback |
| W1 | `preparation.test.ts` > `order of effects, codex` and `, claude-code`; `backend.test.ts` > `prepared before the session, ...`; scenario; mutations |
| W2 | `backend.test.ts` > `codex`, `no herdr worktree create in src`; fake herdr without `worktree create`; scenario |
| W3 | `backend.test.ts` > `the hook only prints the path`, `hook quoting through /bin/sh`, `claude-code postcondition failures` (`wrong-path`) |
| W4 | The existing suites of `close`, `close --discard-worktree`, recovery and the launch check pass unchanged apart from the order (`interrupt.test.ts`, `launch-check.test.ts`, `close-by-label.test.ts`, `matrix.test.ts`, `herdr/launch-check.test.ts`); scenario close and discard checks |
| W5 | `preparation.test.ts` > `no post-checkout hook, codex` and `, claude-code`, with the hook in `.git/hooks` and in a configured `core.hooksPath`; `backend.test.ts` > `prepared before the session, ...`; mutation |
| P1 | `preparation.test.ts` > `argv, cwd, stdin, environment, log and results`; mutation |
| P2 | Same test: `./prep/relative.sh` exists only at the base commit, not in the main checkout; `bun` found on `PATH` |
| P3 | Same test, for the log order and headers; `no output on Demerzel's own streams` |
| P4 | `preparation.test.ts` > `a non-zero exit`, `a signal`, `a program that cannot start` `stops the preparation`, both harnesses |
| P5 | `preparation.test.ts` > `the time limit with a child that ignores SIGTERM`; mutation |
| P6 | The `stops the preparation` cases: exit 1, `launch-failed`, only the worktree in `created`, no backend effect, reason with index, program, outcome and log path, no log content; `cli.test.ts` > `a failed preparation and task-busy`; mutations |
| P7 | `argv, cwd, ...`: results with exit code and duration, outcome, log path; readback |
| P8 | `preparation.test.ts` > `a child left running`, `the limit across commands`; mutation |
| P9 | `preparation.test.ts` > the six `identity: ...` cases, `untracked and ignored files keep the identity`; mutation |
| L0 | Code: after `recorded`, the only writes without the project lock are the dispatch's own task file (`prepare-command` and the `launch-failed` of L3); `task-lock.test.ts` > `the project lock cannot be taken back` |
| L1 | `task-lock.test.ts` > `held from recorded to the last record` |
| L2 | `task-lock.test.ts` > `an independent dispatch completes during a preparation`; mutation |
| L3 | `task-lock.test.ts` > `the project lock cannot be taken back` |
| L4 | `task-lock.test.ts` > `a live dispatch in its preparation is not recovered`, `a recovery that read the task before its last record`; mutations |
| L5 | `task-lock.test.ts` > `a dispatch killed during its preparation` |
| L6 | `task-lock.test.ts` > `a task in its preparation is not interrupted`, `an interrupted task, with and without its lock file`, `a dispatch that finishes between the read and the probe`; mutation |
| L7 | `task-lock.test.ts` > `against a dispatch in its preparation`; `cli.test.ts` > `a failed preparation and task-busy` |
| L8 | `task-lock.test.ts` > `collect and close of a launched task whose lock is held`; the existing `lock.test.ts` > `collect against close loses no update` |
| B1 | `test/core/boundary.test.ts` unchanged and passing; `bun run test:core` without `python3` |

### Engineering notes

- The process group ID is recorded synchronously right after `spawn`
  returns, before any `await`, not literally before the command starts. A
  `dispatch` killed in that window leaves a running command whose group is
  not recorded: for the first command the recovery says no process group
  was recorded, and for a later one it names the previous command's group.
  Recording it before the start would need a wrapper process, which Spec
  2.6 rules out by running each argv with no shell.
- A command whose leader has exited gets up to 200 ms for its group to
  empty before what is left counts as left running. That covers children
  on their way out when the leader's exit is seen.
- `dispatch` releases the task locks it took for a recovery right after
  publishing it, not at the end of the command. The recovered tasks are
  already in a final lifecycle, and holding their locks through a long
  preparation would only make a `resume` or `close` of them `task-busy`.
- The envelope gained two fields per task: `launch_error`, for a launch that
  failed in the core (worktree creation, preparation, identity check, the
  project lock taken back), and `preparation`, with the outcome and the log
  path when the task had commands. `backend_error` stays for the backend's
  own failures. Spec 4 lists the task fields loosely; both are additive.
- New messages are in English. Existing Portuguese messages stay until
  [faelplg/demerzel#41](https://github.com/faelplg/demerzel/issues/41).
- The core test fixtures use only `bun` scripts, `git`, and one `/bin/sh`
  script with shell builtins, since `test:core` puts only `git` and `bun` on
  `PATH`. Slow preparations wait on a file the test creates.
- No dependency was added; `bun.lock` has no diff.

### Remaining limitations

- Preparation processes left running by a killed `dispatch` are not
  stopped and may keep writing in the worktree after the recovery; the
  recovery's history names their process group.
- Checkout filters, such as a Git LFS smudge, still run inside
  `git worktree add`, under the project lock, without Demerzel's time limit
  or log.
- A process that leaves its group, as with `setsid`, is not seen by the
  rule that a command is done when its group is empty.
- Worktree creation runs no Git hook, which changes what a project with a
  `post-checkout` hook got from `herdr worktree create` or the old hook.
- The preparation uses the user's environment and network; offline, a
  preparation that needs the network fails, and Demerzel does not tell the
  two apart.
- A preparation that leaves untracked files Git does not ignore makes
  `close --discard-worktree` refuse, since the worktree is removed without
  `--force`. Projects usually ignore what they install.
- AIKM has no `.demerzel.json` yet; adding it is AIKM's change.

### Learn Back candidate

When a contract adds a new place that runs processes, its exception for
existing tests should name the boundary test that lists those places. Here
the test had to change for a requirement of the same contract, and the
exception did not cover it.

## Pending, by the orchestrator

- The CI link on the Build PR.
- The smoke, with the owner present.
- The independent critique by a `radiant-verifier` in another harness.
