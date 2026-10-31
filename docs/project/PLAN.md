# Plan: Demerzel

Revisão do Plan: 0.3, 2026-10-31
Spec: [revisão 0.4](SPEC.md)
Referência Radiant: 6b129752b6687598e9bc3582c1c89c7ee6d71aee

O comportamento está na Spec; este Plan só ordena os incrementos e diz que
evidência fecha cada um. Ele olha para frente: um incremento terminado vira
uma linha com o link do PR. A ordem segue o risco. A premissa mais frágil do
Frame, a de que Claude Code e Codex iniciam pelo herdr sem intervenção
frequente, é provada primeiro, sem código do Demerzel, para que a hipótese
possa cair antes de qualquer Build.

A revisão 0.2 incorpora a crítica adversarial do Plan 0.1, feita pelo Codex
em `gpt-6-astra` no papel `radiant-grill`, em 2026-10-30: sete objeções, todas
aceitas pelo owner. Duas delas corrigiram a Spec, que foi para a revisão 0.3.
A revisão 0.3 do Plan fecha o incremento 1 e acompanha a Spec 0.4, que mudou
a criação do worktree do Claude Code e tirou a confiança do Demerzel.

## Feito

- Frame 0.3 ([faelplg/demerzel#1](https://github.com/faelplg/demerzel/pull/1))
- Spec 0.2 ([faelplg/demerzel#2](https://github.com/faelplg/demerzel/pull/2), [faelplg/demerzel#3](https://github.com/faelplg/demerzel/pull/3))
- Plan 0.2 e Spec 0.3 ([faelplg/demerzel#5](https://github.com/faelplg/demerzel/pull/5))
- 1, prova de lançamento ([faelplg/demerzel#6](https://github.com/faelplg/demerzel/pull/6) e o PR desta revisão): passou com um modo de worktree por harness. Codex com `herdr worktree create`, 0 de 5 intervenções; Claude Code com `--worktree` e hook `WorktreeCreate`, 0 de 5. Com o worktree do herdr, o Claude Code pedia confiança em 5 de 5, e isso levou à Spec 0.4.

## Próximos

Do incremento 2 em diante, cada um termina com `bun run check` passando e a
evidência listada. "Contrato" marca incrementos com risco real, que precisam
de um Task Contract em `docs/project/contracts/` antes do Build. Toda
verificação da Spec, seção 7, tem um incremento dono, inclusive quando a
mesma verificação é dividida entre núcleo e integração.

2. **Stack.** Sem contrato. Bun e TypeScript estrito, `bun test`, checagem de
   tipos e `bun run check` reunindo os dois; entrypoint `demerzel` que só
   responde `--version` e recusa o resto com código `2`. Os comandos entram no
   `AGENTS.md`. Evidência: `bun run check` passando num checkout limpo.
3. **Núcleo.** Contrato. `src/core/` com `Task`, `Request`, montador do
   pedido, configuração, registro com lock, ciclo de vida, recusas do núcleo e
   os seis comandos sobre uma interface de backend, com o backend falso em
   memória. Evidência: verificações 1, 2 e 5, e a parte do núcleo das
   verificações 3 e 4. A suíte 1 roda sem `python3` no `PATH`.
4. **Backend herdr e smoke.** Contrato. Implementação herdr da interface,
   sessão pela configuração, tabela de lançamento de Claude Code e Codex,
   `resume` para startup bloqueado. A entrada é uma tarefa já resolvida,
   escrita à mão num arquivo de fixture interno aos testes, sem Radiant.
   Os dois modos de worktree da Spec 0.4, seção 2.5, com a pós-condição do
   Claude Code. Evidência: verificações 7 e 8, e o critério do incremento 1
   agora pelo Demerzel: cinco `dispatch` por harness num projeto confiado,
   contando como intervenção qualquer ação humana na aba antes do pedido
   chegar, exceto a autenticação inicial. O contrato reserva o descarte real
   ao owner e lista os recursos que sobram se o incremento parar.
5. **Integração Radiant.** Contrato. `src/radiant/` com projeto, gate de pin,
   base, contrato do commit base, `check_dispatch.py`, roteamento e recusas da
   integração. Evidência: verificação 6, a parte da integração das
   verificações 3 e 4 (cada recusa da integração, inclusive
   `reports-not-ignored` e `approval-required`, com prova de nenhum efeito, e
   nenhum marcador do contrato no pedido montado), e a verificação 2 ainda
   passando.
6. **Menor experimento.** Contrato no AIKM, não aqui. Um contrato real do
   AIKM com duas unidades independentes, uma para Claude Code e outra para
   Codex, despachadas pelo Demerzel e aceitas pelo orquestrador. Evidência:
   verificação 9, mais o tempo e as ações do owner em preparo, intervenção e
   recuperação, comparados com montar as mesmas duas sessões à mão. Cada
   condição de refutação do Frame sai como sustentada, refutada ou
   inconclusiva; um contrato só não decide "a maioria dos contratos". O
   resultado volta ao Radiant como Learn Back.

## Pontos de parada

- Depois do 4: se algum harness pedir intervenção em mais de um dos cinco
  lançamentos pelo Demerzel, a hipótese cai antes da integração. O que fica é
  um Learn Back ao Radiant e a alternativa menor, o subagente nativo de cada
  harness.
- Depois do 6: a suficiência do contexto é julgada com o pacote Radiant real.
  Com as demais condições de refutação, ela decide se o Demerzel segue para um
  segundo incremento, para ou repete o experimento com mais contratos.

## Pré-requisitos fora do Demerzel

Nenhum deles é trabalho deste repositório; o incremento que precisa de cada
um o lista no contrato como blocker externo.

| Pré-requisito | Dono | Antes do |
| --- | --- | --- |
| Servidor do herdr rodando na sessão `lab` | Owner | 4 |
| Claude Code e Codex autenticados no terminal, conferido antes de cada prova | Owner | 4 |
| Checkout principal do projeto confiado uma vez no Claude Code e no Codex | Owner | 4 |
| `~/.config/demerzel/config.json` com `herdr.session` e `radiant.root` | Owner, pelo dotfiles | 4 |
| `~/.config/radiant/routing.json` com Claude Code e Codex | Owner, pelo dotfiles | 5 |
| Pin do AIKM numa revisão com `check_dispatch.py` | Sessão no AIKM | 6 |
| Pin do Demerzel igual ao checkout Radiant da máquina | Este repositório | cada Build |

## Conferido para a Spec

A Spec deixa para o Plan conferir a superfície externa. Entre 2026-10-29 e
2026-10-31:

- herdr 0.9.0: `worktree create` aceita `--cwd`, `--branch`, `--base`,
  `--path`, `--label`, `--no-focus` e `--trust-repository`; `agent start`
  aceita `--kind claude` e `--kind codex` com argumentos do agente depois de
  `--`. Bate com a tabela da Spec, seção 2.5.
- herdr 0.9.0, semântica: `agent prompt --wait` sem `--until` só volta em
  `idle`, `done` ou `blocked`. Com `--until working --until blocked`, o
  envio voltou em cerca de 0,6 s com o agente em `working`, nos dois
  harnesses (incremento 1).
- herdr 0.9.0, confiança: `--trust-repository` não mudou a decisão de
  nenhum dos dois CLIs. A Spec 0.4 deixou de usar a flag.
- herdr 0.9.0, sessão: só a flag `--session <nome>` escolhe a sessão. Nesta
  máquina o servidor roda na sessão `lab` e a padrão está parada. A Spec 0.3
  acrescentou `herdr.session` à configuração.
- Claude Code 2.1.286: `--model` aceita o ID completo e `--effort` aceita
  `low`, `medium`, `high`, `xhigh` e `max`; os cinco iniciaram no
  incremento 1. A confiança é por path exato. `--worktree` com
  `--settings` e um hook `WorktreeCreate` de comando cria o worktree no path,
  branch e commit escolhidos, sem lock e sem diálogo, partindo de uma raiz
  confiável. Sem hook, a base é `origin/HEAD` ou o `HEAD` local.
- Codex 0.166.0, atualizado da 0.163.0 durante o incremento 1: `--model` e
  `-c model_reasoning_effort=<nível>` com `minimal`, `low`, `medium`, `high` e
  `xhigh` iniciaram sem erro. A confiança vale para a raiz do repositório e
  cobre worktrees novos. O Demerzel não valida o nível do Codex e, se o CLI
  recusar, segue a regra do
  [roteamento](https://github.com/faelplg/radiant/blob/6b129752b6687598e9bc3582c1c89c7ee6d71aee/docs/routing.md):
  registra e omite o esforço.
- Bun 1.4.2 instalado.
