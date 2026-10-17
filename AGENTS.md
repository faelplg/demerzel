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

Ainda não há comandos: o repositório não tem manifest nem CI. Eles entram
aqui quando o Plan introduzir a stack.

A decisão que origina este produto é o ADR-0002 do Radiant
(`docs/adrs/ADR-0002-backend-dispatch-demerzel.md` no checkout indicado pelo
pin), substituído em parte pelo ADR-0003. Papel e fronteiras estão no Frame,
em `docs/project/FRAME.md`.
<!-- radiant:end -->
