# Engineering Profile: Demerzel

- Project: `faelplg/demerzel`
- Radiant revision: `93d61c0e1f39025e55cc10049cc82c9854c04434`
- Baseline version: `0.1`
- Stack pack: `typescript-bun`

The coordinated M3 decision in [Spec section 9](SPEC.md#9-decisões-do-owner)
moves the pin after Radiant PR #73 to adopt the practice catalog, lifecycle
map, Spec and Profile templates, stack pack and opt-in contract validator.
Past contracts and verification reports retain their execution revisions.

## Pack overrides

| Pack section | Override | Reason |
| --- | --- | --- |
| Lint and format | No Biome, lint or format gate; use the existing typecheck and test aggregate. | [package.json](../../package.json) declares no lint or format script. Adding one requires a separate project decision. |

## Commands

Run from the repository root. Sources: [AGENTS.md](../../AGENTS.md),
[package.json](../../package.json) and [README](../../README.md#development).

| Command | Prerequisites | Evidence produced |
| --- | --- | --- |
| `bun install --frozen-lockfile` | Bun 1.4.2 or newer; committed `bun.lock`. | Development dependencies installed from the lockfile. |
| `DEMERZEL_RADIANT_ROOT=<clean-checkout-at-pin> bun run check` | Python 3.9+, Git and a clean Radiant checkout at the map's pin. | Typecheck, core isolation, herdr backend, CLI and Radiant integration tests. Required at the end of every increment. |
| `bun run test:core` | Git and Bun; the script builds a PATH without Python. | Core isolation suite. |
| `bun run scenario:herdr` | Real herdr 0.9.0 or newer; the script starts and stops an isolated server. | Real backend scenario, outside `check`. |
| `DEMERZEL_SMOKE_REPO=<disposable-repository> bun run smoke:herdr` | Orchestrator and owner present; real authenticated Claude Code and Codex harnesses. Uses model resources. | Real harness smoke, outside `check`. |

## Test strategy beyond the pack

[Spec section 7](SPEC.md#7-verificação) requires import-boundary checks for
`src/core/`, refusals without effects, persistence and interruption proofs,
lock contention and marker-based egress checks. Tests live in `test/`, grouped
by subsystem. The herdr backend tests use a fake herdr on PATH; real herdr
and harness scenarios require separate evidence beyond the aggregate gate.

## Dependency policy

No runtime dependencies, as required by [AGENTS.md](../../AGENTS.md).
Development dependencies are pinned in [package.json](../../package.json)
and [bun.lock](../../bun.lock).

## Compatibility

Bun 1.4.2 or newer, strict TypeScript and macOS or Linux, as documented in
[README](../../README.md#requirements) and [tsconfig.json](../../tsconfig.json).
[CI](../../.github/workflows/check.yml) runs the aggregate check on macOS and
Ubuntu with Bun 1.4.2 and a Radiant checkout at the map's pin.
