# Demerzel

Demerzel runs each task as its own coding agent session, in its own branch
and worktree, and tracks it until its report is in. An orchestrator, the agent
session that talks to the human, hands it a task instead of using its harness's
native subagent. Demerzel creates the branch and worktree, starts the agent,
and sends a request that carries only the task's ID and role and pointers to
what it needs. The orchestrator then follows the task with `status` and `wait`
and reads its report with `collect`.

Today the tasks come from the units of a
[Radiant](https://github.com/faelplg/radiant) Task Contract, the agents are
Claude Code and Codex, and each session runs in [herdr](https://herdr.dev).
The core in `src/core/` knows none of Radiant; the Radiant integration in
`src/radiant/` turns a unit into a task, and herdr sits behind Demerzel's own
backend interface.

Demerzel has no judgment. It does not split the work, choose the routing rule,
or accept what a task delivers. It validates and runs what the orchestrator
asked for, and the acceptance stays with the orchestrator and the verifier. It
never merges, pushes, opens a PR, deletes a branch, edits a contract, or
answers a permission prompt.

The [Frame](docs/project/FRAME.md) has the intent and the boundaries, the
[Spec](docs/project/SPEC.md) the behavior, and the
[Plan](docs/project/PLAN.md) what comes next. They are in Portuguese for now
([#40](https://github.com/faelplg/demerzel/issues/40)).

## Requirements

- macOS or Linux
- Bun 1.4.2 or newer, and git
- herdr 0.9.0 or newer, with its server running
- Claude Code and Codex installed and signed in, with the project's main
  checkout trusted once in each
- python3 3.9 or newer, for the Radiant validators
- A Radiant checkout at the same commit as the consumer's pin in
  `.radiant.json`

## Setup

```sh
bun install --frozen-lockfile
```

Run the CLI with `bun <demerzel-checkout>/src/cli.ts <command>`, or put
`src/cli.ts` on your PATH as `demerzel`. Run it from the consumer project, the
repository with `.radiant.json`.

Two user files configure it, both under `$XDG_CONFIG_HOME` (else `~/.config`):

`demerzel/config.json`:

```json
{
  "schema": 1,
  "herdr": { "session": "lab" },
  "radiant": {
    "root": "/absolute/path/to/radiant",
    "branch_prefix": "radiant/"
  }
}
```

`radiant.root` is required to dispatch. `herdr.session` is optional; without
it, herdr uses its default session. `branch_prefix` defaults to `radiant/`.

`radiant/routing.json` holds the routing rules, in the format of Radiant's
[routing](https://github.com/faelplg/radiant/blob/main/docs/routing.md). A rule
names harness candidates in order and can require `--human-approved`.

The consumer must ignore `.radiant/` in Git, since each unit writes its report
to `.radiant/reports/<unit-id>.md` in its worktree.

A project can declare how a fresh worktree is prepared, such as installing
its dependencies, in `.demerzel.json` at its root:

```json
{
  "schema": 1,
  "prepare": [
    ["bun", "install", "--frozen-lockfile"]
  ]
}
```

Each command is an argv, run with no shell, in the task's worktree, in order,
before the session opens. Demerzel reads the file from the base commit, so it
must be committed there. The output goes to `logs/<id>/prepare.log` in the
project's registry, never to Demerzel's own output. A command that fails,
leaves processes running, or passes the 10 minute limit for the whole
preparation stops the task in `launch-failed`, with the branch and worktree
kept and no agent started. Without the file, nothing is prepared. This
repository's own `.demerzel.json` is the example above.

## Commands

```sh
demerzel dispatch <unit-id> [--rule <id>] [--base <ref>] [--human-approved]
demerzel resume <id>
demerzel status [<id>...] [--all]
demerzel wait <id>... [--timeout <ms>]
demerzel collect <id>
demerzel close <id> [--discard-worktree]
demerzel --version
```

Every command but `--version` takes `--json` and returns an envelope with
`ok`, `command`, `tasks` and `refusal`.

A typical run: the orchestrator dispatches the independent units of the
active contract, waits for them, collects each report, and closes each task
after accepting it. `dispatch` reads the contract from the base commit, which
is the current branch unless `--base` names another ref, so the contract must
be committed there.

- `dispatch` checks everything first: the Radiant pin, the unit, its
  dependencies, overlapping `writes`, the routing rule, the herdr server, and
  that the branch and worktree do not exist yet, and the project's
  `.demerzel.json`. Then it creates the branch `<branch_prefix><unit-id>` and
  its worktree from the base, runs the project's preparation there, opens the
  session, starts the harness and sends the request.
- `resume` sends the recorded request after a human cleared a startup prompt
  in the unit's tab. Demerzel reports such a prompt as `blocked` and never
  answers it.
- `status` reads without waiting for any lock. `wait` returns when each task
  has a report or has stopped. `resume`, `collect` and `close` refuse with
  `task-busy` a task whose `dispatch` is still running, for example during
  its preparation.
- `collect` returns the report with its sha256 digest, without interpreting
  it.
- `close` closes the herdr workspace and keeps the branch. Only the human
  passes `--discard-worktree`, and the worktree is removed without `--force`.

The tasks of each project live in `$XDG_STATE_HOME/demerzel/` (else
`~/.local/state/demerzel/`), with the worktrees under the same folder. A
worktree of the project sees the same tasks as its main checkout.

## Guarantees

- Refusals have no effect. A refusal exits with code 2 and creates nothing:
  no task, branch, worktree, herdr workspace or harness call. Its message says
  what to do next. The codes are in the [Spec, section 5](docs/project/SPEC.md#5-recusas).
- Exit code 1 means something needs attention: a failed launch, a blocked
  agent, a missing report, or a timeout.
- The request carries only Demerzel's fixed text, the task's ID and role, the
  report path, refs and paths, all checked against fixed formats, never
  contract content or secrets. The launched harness reads the contract and
  sends it to its model provider, as it would in a session opened by hand, so
  choosing a rule is also choosing where the contract goes.
- No downgrade. When no candidate meets the unit's capability, the refusal
  carries `hold: true` instead of picking a weaker model.
- The core in `src/core/` does not know Radiant. Its suite runs with only
  `git` and `bun` on PATH.
- Worktree creation runs no Git hook; `.demerzel.json` is the one place for
  setup. The preparation runs the project's own commands with your
  environment and network.
- No telemetry.

## Not supported yet

- Each unit opens its own herdr workspace instead of a tab in the project's
  workspace ([#29](https://github.com/faelplg/demerzel/issues/29)).
- Codex stops at its update prompt on launch
  ([#43](https://github.com/faelplg/demerzel/issues/43)).
- Follow-ups to a running session, and backends other than herdr.
- CLI messages are in Portuguese
  ([#41](https://github.com/faelplg/demerzel/issues/41)).

## Development

```sh
DEMERZEL_RADIANT_ROOT=<radiant-checkout-at-the-pin> bun run check
bun run test:core          # the core suite with only git and bun on PATH
bun run scenario:herdr     # against a real herdr server it starts and stops
```

`bun run check` runs the typecheck, the core suite without python3, and the
herdr backend, CLI and Radiant integration tests. The integration tests need
a clean Radiant checkout at the `radiant_revision` of `.radiant.json` and fail
with what to do when it is missing. CI runs the same check on macOS and Linux.

`DEMERZEL_SMOKE_REPO=<throwaway-repository> bun run smoke:herdr` launches real
Claude Code and Codex sessions and spends model usage, so it stays out of the
check.

This repository is developed under Radiant: [AGENTS.md](AGENTS.md) has the
local rules for agents, and the Task Contracts are in
[docs/project/contracts/](docs/project/contracts/).

## License

[MIT](LICENSE)
