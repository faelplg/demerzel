# Codex update prompt probe

Date: 2026-11-17
Issue: [faelplg/demerzel#43](https://github.com/faelplg/demerzel/issues/43)
Run by: the orchestrator, in tab `probe-codex-update` of workspace `demerzel` in herdr session `lab`, closed afterwards. No sign-in and no model use.
Codex: 0.169.0 from the Homebrew cask, the latest release on 2026-11-17 (`brew info --cask codex`).

## Question

TC-0025 saw the Codex update prompt stop every Codex launch. Since then, the
smoke and the prepared worktree probe launched Codex 0.169.0 with no prompt.
Is the prompt gone, or was no update due? And can Demerzel skip it for the
sessions it opens without changing the user's Codex configuration?

## Facts

- The user's `~/.codex/version.json` held `latest_version` `0.169.0`, the
  installed version, so no update was due. That explains the launches with
  no prompt; it does not show the prompt is gone.
- The binary holds the configuration key `check_for_update_on_startup`
  (`strings` on `/opt/homebrew/Caskroom/codex/0.169.0/bin/codex`).
- Two isolated homes were made under `/private/tmp/demerzel-probe-codex-update/`,
  each with only a `version.json` giving `latest_version` `99.0.0` and
  `last_checked_at` at the probe's start, so Codex would not fetch it again.
  Nothing from the user's `~/.codex` was copied.

## Runs

A, control: `CODEX_HOME=<home-a> codex`. Codex showed its update prompt
before any other screen:

```text
  Update available · 0.169.0 → 99.0.0
  Release notes: https://github.com/openai/codex/releases/latest
› 1. Update now (runs `brew upgrade --cask codex`)
  2. Skip
  3. Skip until next version
  enter continue · esc skip
```

It was left with Esc and Ctrl-C, without updating.

B: `CODEX_HOME=<home-b> codex -c check_for_update_on_startup=false`, with
the same `version.json`. Codex showed no update prompt and went straight to
its next screen, which with no credentials is the sign-in choice ("Welcome
to Codex, OpenAI's command-line coding agent").

## Conclusion

The prompt still exists and comes back whenever a newer release is known.
`-c check_for_update_on_startup=false` on the command line skips it for
that session only, with no change to the user's configuration. Spec 0.16
makes it part of every Codex launch.

## Limits

- The probe ran without credentials, so the screen after the skipped prompt
  was sign-in, not an agent at `idle`. A signed-in launch with an update due
  was not run, because it would mean changing the user's real
  `~/.codex/version.json`.
- Only Codex 0.169.0 was checked. A later Codex that renames or drops the key
  would bring the prompt back; the smoke would show it as `blocked`.
