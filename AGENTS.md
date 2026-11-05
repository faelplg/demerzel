<!-- radiant:begin -->
# Project guidance

This project uses Radiant. Locate its checkout through the user's global
bootstrap and read there the README of the adapter for the harness in use, in
`adapters/<harness>/`, to validate the revision and load the Core. If the
pointer is missing, set it up before running under Radiant. Anyone who does
not use Radiant follows only the local commands and rules below. In harnesses
that read another instructions file, that file holds only an import of this
map; in Claude Code, `CLAUDE.md` with the line `@AGENTS.md`.

The state map and the chosen commit are in `.radiant.json` at this root. Read
the artifacts the task needs and the contract pointer given in the map. This
product's rules and commands belong to the local context indicated there.
When the map has an `engineering_profile`, read it together with the Baseline
in the Radiant checkout before starting a Build.

Stack: Bun 1.4.2 ou acima e TypeScript estrito, sem dependências de runtime.
Comandos, da raiz:

- `bun install --frozen-lockfile`: instala as dependências de desenvolvimento
  fixadas no `bun.lock`.
- `DEMERZEL_RADIANT_ROOT=<checkout Radiant no pin> bun run check`: checagem
  de tipos, a suíte do núcleo sem `python3`, os testes do backend herdr, os do
  CLI e os da integração Radiant. Precisa de `python3` 3.9 ou acima e de um
  checkout limpo de `faelplg/radiant` no `radiant_revision` do
  `.radiant.json`; sem ele, os testes da integração falham com a instrução.
  Todo incremento termina com ele passando.
- `bun run test:core`: a suíte de `test/core/` num `PATH` só com `git` e
  `bun`, sem `python3`.
- `bun run typecheck` e `bun test`: a checagem de tipos e todos os testes com
  o `PATH` normal. Os testes do backend herdr usam um `herdr` falso no `PATH`.
- `bun run scenario:herdr`: o cenário contra o herdr real, num servidor
  isolado que o próprio script sobe e para, sem harness de modelo. Fora do
  `check`.
- `DEMERZEL_SMOKE_REPO=<repositório descartável> bun run smoke:herdr`: o smoke
  com Claude Code e Codex reais, rodado pelo orquestrador com o owner
  presente. Gasta modelo. Fora do `check`.
- `./src/cli.ts <comando>`: o entrypoint `demerzel` sem instalar; `--version`, `dispatch`, `resume`, `status`, `wait`, `collect` e `close`.

Cada teste nomeia o comportamento que protege e a regressão que o faria
falhar, como pede a Spec, seção 7.

A decisão que origina este produto é o ADR-0002 do Radiant
(`docs/adrs/ADR-0002-backend-dispatch-demerzel.md` no checkout indicado pelo
pin), substituído em parte pelo ADR-0003. Papel e fronteiras estão no Frame,
em `docs/project/FRAME.md`.
<!-- radiant:end -->
