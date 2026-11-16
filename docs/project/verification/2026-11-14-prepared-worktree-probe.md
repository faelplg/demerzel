# Prepared worktree probe

Date: 2026-11-14
Plan: [revision 0.8](../PLAN.md), increment 7
Issue: [faelplg/demerzel#30](https://github.com/faelplg/demerzel/issues/30)
Spec: [revision 0.14](../SPEC.md), before the change
State: **PASS**. Both harnesses start in a worktree that Demerzel created
and prepared before the agent, with no dialog, in 5 of 5 launches each.

## Question

For #30 the owner chose, on 2026-11-14, that Demerzel creates the worktree
itself with `git worktree add` for both harnesses, runs the project's
preparation in it, and only then opens the session and starts the agent. Two
things had to hold before the Spec could say so:

- Claude Code, launched at the trusted project root with `--worktree` and a
  `WorktreeCreate` hook that only prints the path of a worktree that already
  exists, uses that worktree with no trust dialog;
- Codex, launched in a workspace whose cwd is a worktree created by
  `git worktree add` instead of `herdr worktree create`, starts with no
  trust dialog.

## Environment

- herdr server 0.9.0 in session `lab` (client 0.9.5).
- Claude Code 2.1.311 with `claude-sonnet-5-5`, effort `low`.
- Codex 0.169.0 with `gpt-6-astra`, `model_reasoning_effort=low`.
- The owner's throwaway repository `~/workspaces/demerzel-smoke`, trusted
  once in each CLI for the TC-0002 smoke, at commit `8a8b885`.
- Worktrees under a scratchpad folder outside any repository, never trusted, written `<scratchpad>` in the data.

No dialog was answered by the orchestrator.

## Method

Each launch:

1. `git -C <repo> worktree add -b probe/<id> <wt>/<name> <commit>`;
2. wrote a file `PREPARED` in the worktree, standing in for the preparation;
3. Claude Code: `herdr workspace create --cwd <repo> --no-focus` and
   `herdr agent start <name> --kind claude -- --worktree <name> --settings <hook> --model claude-sonnet-5-5 --effort low`,
   where the hook command is only `printf '%s' '<worktree path>'`;
   Codex: `herdr workspace create --cwd <worktree> --no-focus` and
   `herdr agent start <name> --kind codex -- --model gpt-6-astra -c model_reasoning_effort=low`;
4. read the agent status and `foreground_cwd` with `herdr agent get`;
5. sent a short prompt asking for `pwd` and the content of `PREPARED`, with
   `--wait --until working --until blocked`, and waited for the end of the
   turn (the first Codex launch, `c1`, stopped at step 4);
6. read `git worktree list --porcelain` and closed the workspace.

Data, without pane contents, in
[2026-11-14-prepared-worktree-probe.jsonl](2026-11-14-prepared-worktree-probe.jsonl).

## Result

| Harness | Launches | Dialog | Status after start | `foreground_cwd` | Agent read `PREPARED` | Lock on the worktree |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | `p1` to `p5` | 0 of 5 | `idle` | the worktree | 5 of 5 | none |
| Codex | `c1` to `c5` | 0 of 5 | `idle` | the worktree | 4 of 4 prompted | none |

- `agent start` took between 4.9 s and 5.4 s, as in the earlier probes. The
  prompt returned in 0.5 s to 0.6 s with the agent `working`. Claude Code
  turns ended in `done` in about 4 s; Codex turns in `done` or `idle` in 7 s
  to 9 s.
- Claude Code created nothing in the repository or the worktree beyond what
  was already there, and the worktree kept its branch and commit after the
  workspace closed.
- Codex 0.169.0 showed neither a trust dialog nor its update prompt. The
  update prompt is the subject of
  [faelplg/demerzel#43](https://github.com/faelplg/demerzel/issues/43); this
  probe does not say whether it is gone or only not due.

## Reading

- The `WorktreeCreate` hook does not have to create the worktree. A hook
  that prints the path of an existing worktree is enough, so Demerzel can
  create and prepare the worktree before Claude Code starts, with the same
  launch postcondition as today.
- Codex trust covers a worktree created by `git worktree add`, as it covered
  the ones from `herdr worktree create`, so both harnesses can share one
  creation path.

## What this probe does not say

- How long a real preparation takes, or what a failing one leaves behind.
- Whether Claude Code behaves the same when the project has its own
  `WorktreeCreate` hook or `disableAllHooks`; the launch postcondition still
  covers that, as in Spec 2.5.

## Leftover resources

In `~/workspaces/demerzel-smoke`: ten branches `probe/pre-p1` to
`probe/pre-p5` and `probe/cx-c1` to `probe/cx-c5`, with their worktrees in
the session scratchpad. Disposal stays with the owner, with the resources of
the earlier probes.
