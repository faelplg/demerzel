# Plan: Demerzel

Revisão do Plan: 0.5, 2026-11-06
Spec: [revisão 0.14](SPEC.md)
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
a criação do worktree do Claude Code e tirou a confiança do Demerzel. A
revisão 0.4 acompanha a Spec 0.10, que resolve o achado P1 do review do
PR #16 antes do incremento 5.
Revision 0.5 drops the manual baseline from increment 6, by owner decision.

## Feito

- Frame 0.3 ([faelplg/demerzel#1](https://github.com/faelplg/demerzel/pull/1))
- Spec 0.2 ([faelplg/demerzel#2](https://github.com/faelplg/demerzel/pull/2), [faelplg/demerzel#3](https://github.com/faelplg/demerzel/pull/3))
- Plan 0.2 e Spec 0.3 ([faelplg/demerzel#5](https://github.com/faelplg/demerzel/pull/5))
- 1, prova de lançamento ([faelplg/demerzel#6](https://github.com/faelplg/demerzel/pull/6), [faelplg/demerzel#7](https://github.com/faelplg/demerzel/pull/7)): passou com um modo de worktree por harness. Codex com `herdr worktree create`, 0 de 5 intervenções; Claude Code com `--worktree` e hook `WorktreeCreate`, 0 de 5. Com o worktree do herdr, o Claude Code pedia confiança em 5 de 5, e isso levou à Spec 0.4.
- 2, stack ([faelplg/demerzel#8](https://github.com/faelplg/demerzel/pull/8)): Bun 1.4.2, TypeScript 7.0.2 estrito, `bun run check` e o entrypoint que só responde `--version`.
- 3, núcleo ([faelplg/demerzel#9](https://github.com/faelplg/demerzel/pull/9), [faelplg/demerzel#10](https://github.com/faelplg/demerzel/pull/10), [faelplg/demerzel#11](https://github.com/faelplg/demerzel/pull/11), [faelplg/demerzel#12](https://github.com/faelplg/demerzel/pull/12)): TC-0001 em DONE, com 142 testes do núcleo e quatro verificações independentes, três no Codex e a última, com PASS, no Antigravity.
- 4, backend herdr e smoke ([faelplg/demerzel#13](https://github.com/faelplg/demerzel/pull/13), [faelplg/demerzel#14](https://github.com/faelplg/demerzel/pull/14), [faelplg/demerzel#15](https://github.com/faelplg/demerzel/pull/15), [faelplg/demerzel#16](https://github.com/faelplg/demerzel/pull/16)): TC-0002 em DONE, com o backend herdr, `resume`, `status`, `wait`, `collect` e `close` no CLI, o cenário contra o herdr real em 16/16 e o smoke com 0 de 5 intervenções no Claude Code e no Codex. Treze verificações independentes, doze no Codex com FAIL e a última, com PASS, no Antigravity; uma emenda do owner ao contrato mudou o `close` do núcleo.
- 5, integração Radiant ([faelplg/demerzel#22](https://github.com/faelplg/demerzel/pull/22), [faelplg/demerzel#23](https://github.com/faelplg/demerzel/pull/23), [faelplg/demerzel#24](https://github.com/faelplg/demerzel/pull/24)): TC-0003 em DONE, com a correção do achado P1 no `resume`, `src/radiant/` e o `dispatch` no CLI, testados contra o Radiant real no pin, local e no CI. Duas verificações independentes no Codex: a primeira com FAIL e dois achados corrigidos, a segunda confirmando as correções; quatro decisões do owner sobre códigos de recusa entraram na Spec 0.14, e uma emenda do owner ao contrato aceitou `src/radiant/python.ts` no teste de fronteira de processos.

## Próximos

Do incremento 4 em diante, cada um termina com `bun run check` passando e a
evidência listada. "Contrato" marca incrementos com risco real, que precisam
de um Task Contract em `docs/project/contracts/` antes do Build. Toda
verificação da Spec, seção 7, tem um incremento dono, inclusive quando a
mesma verificação é dividida entre núcleo e integração.

6. **Smallest experiment.** Contract in AIKM, not here: TC-0025 in
   `faelplg/aikm`. A real AIKM contract with two independent units, one for
   Claude Code and one for Codex, dispatched by Demerzel and accepted by the
   orchestrator. Evidence: verification 9, plus the owner's time and actions
   in preparation, intervention, and recovery. There is no manual baseline:
   on 2026-11-06 the owner decided that setting up the sessions by hand is
   tedious whatever its productivity, so the Frame condition on owner time
   and attention is marked by owner decision, not by measurement. Each other
   refutation condition of the Frame comes out sustained, refuted, or
   inconclusive; one contract alone does not decide "most contracts". The
   result returns to Radiant as a Learn Back.

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
| Servidor do herdr rodando na sessão `lab`, para a crítica independente | Owner | 3 |
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
  cobre worktrees novos. Desde a Spec 0.9, o Demerzel só passa os níveis
  conferidos aqui e omite os outros com o motivo, antes do primeiro efeito,
  no espírito da regra do
  [roteamento](https://github.com/faelplg/radiant/blob/6b129752b6687598e9bc3582c1c89c7ee6d71aee/docs/routing.md):
  registra e omite o esforço. Um nível novo entra conferindo a versão
  instalada do CLI e atualizando esta lista e a Spec 2.5.
- Bun 1.4.2 instalado.
