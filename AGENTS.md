<!-- radiant:begin -->
# Orientação do projeto

Este projeto usa Radiant. Localize seu checkout pelo bootstrap global do usuário
e leia nele o README do adapter do harness em uso, em `adapters/<harness>/`,
para validar a revisão e carregar o Core. Se o pointer estiver ausente,
configure-o antes de executar sob Radiant. Quem não usa o Radiant segue só
os comandos e as regras locais abaixo. Em harnesses que leem outro arquivo
de instruções, esse arquivo contém apenas um import deste mapa; no Claude Code,
`CLAUDE.md` com a linha `@AGENTS.md`.

O mapa de estado e o commit escolhido estão em `.radiant.json` nesta raiz.
Leia os artefatos necessários à tarefa e o ponteiro de contrato indicado no
mapa. Regras e comandos deste produto pertencem ao contexto local indicado ali.
Quando houver `engineering_profile` no mapa, leia-o junto com o Baseline do
checkout Radiant antes de iniciar um Build.

Stack: Bun 1.4.2 ou acima e TypeScript estrito, sem dependências de runtime.
Comandos, da raiz:

- `bun install --frozen-lockfile`: instala as dependências de desenvolvimento
  fixadas no `bun.lock`.
- `bun run check`: checagem de tipos, a suíte do núcleo sem `python3` e os
  testes do entrypoint. Todo incremento termina com ele passando.
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
- `./src/cli.ts <comando>`: o entrypoint `demerzel` sem instalar; `--version`, `resume`, `status`, `wait`, `collect` e `close`.

Cada teste nomeia o comportamento que protege e a regressão que o faria
falhar, como pede a Spec, seção 7.

A decisão que origina este produto é o ADR-0002 do Radiant
(`docs/adrs/ADR-0002-backend-dispatch-demerzel.md` no checkout indicado pelo
pin), substituído em parte pelo ADR-0003. Papel e fronteiras estão no Frame,
em `docs/project/FRAME.md`.
<!-- radiant:end -->
