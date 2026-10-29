# Plan: Demerzel

Revisão do Plan: 0.1, 2026-10-29
Spec: [revisão 0.2](SPEC.md)
Referência Radiant: 6b129752b6687598e9bc3582c1c89c7ee6d71aee

O comportamento está na Spec; este Plan só ordena os incrementos e diz que
evidência fecha cada um. Ele olha para frente: um incremento terminado vira
uma linha com o link do PR. A ordem segue o risco. A premissa mais frágil do
Frame, a de que Claude Code e Codex iniciam pelo herdr sem intervenção
frequente, é testada no incremento 3, antes da integração Radiant, para que a
hipótese possa cair cedo.

## Feito

- Frame 0.3 ([faelplg/demerzel#1](https://github.com/faelplg/demerzel/pull/1))
- Spec 0.2 ([faelplg/demerzel#2](https://github.com/faelplg/demerzel/pull/2), [faelplg/demerzel#3](https://github.com/faelplg/demerzel/pull/3))

## Próximos

Cada incremento termina com `bun run check` passando e a evidência listada.
"Contrato" marca incrementos com risco real, que precisam de um Task Contract
em `docs/project/contracts/` antes do Build.

1. **Stack.** Sem contrato. Bun e TypeScript estrito, `bun test`, checagem de
   tipos e `bun run check` reunindo os dois; entrypoint `demerzel` que só
   responde `--version` e recusa o resto com código `2`. Os comandos entram no
   `AGENTS.md`. Evidência: `bun run check` passando num checkout limpo.
2. **Núcleo.** Contrato. `src/core/` com `Task`, `Request`, montador do
   pedido, configuração, registro com lock, ciclo de vida, recusas do núcleo e
   os seis comandos sobre uma interface de backend, com o backend falso em
   memória. Evidência: verificações 1 a 5 da Spec, seção 7, na parte do
   núcleo; a suíte 1 roda sem `python3` no `PATH`.
3. **Backend herdr e smoke.** Contrato. Implementação herdr da interface,
   tabela de lançamento de Claude Code e Codex, `resume` para startup
   bloqueado. A entrada é uma tarefa já resolvida, escrita à mão num arquivo
   de fixture, sem Radiant. Evidência: verificações 7 e 8, com versões do
   herdr e dos dois CLIs registradas, e uma contagem de quantos lançamentos
   pediram intervenção humana.
4. **Integração Radiant.** Contrato. `src/radiant/` com projeto, gate de pin,
   base, contrato do commit base, `check_dispatch.py`, roteamento e recusas da
   integração. Evidência: verificação 6 contra o Radiant no pin e o teste de
   fronteira por import (verificação 2) ainda passando.
5. **Menor experimento.** Contrato no AIKM, não aqui. Um contrato real do
   AIKM com duas unidades independentes, uma para Claude Code e outra para
   Codex, despachadas pelo Demerzel e aceitas pelo orquestrador. Evidência:
   verificação 9 e uma avaliação explícita de cada condição de refutação do
   Frame. O resultado volta ao Radiant como Learn Back.

## Pontos de parada

- Depois do 3: se o lançamento travar com frequência em prompts de confiança
  ou autenticação, ou se a sessão precisar de contexto colado, a hipótese cai
  antes da integração. O que fica é um Learn Back ao Radiant e a alternativa
  menor, o subagente nativo de cada harness.
- Depois do 5: as condições de refutação do Frame decidem se o Demerzel segue
  para um segundo incremento ou para.

## Pré-requisitos fora do Demerzel

Nenhum deles é trabalho deste repositório; o incremento que precisa de cada
um o lista no contrato como blocker externo.

| Pré-requisito | Dono | Antes do |
| --- | --- | --- |
| `~/.config/demerzel/config.json` com `radiant.root` | Owner, pelo dotfiles | 4 |
| `~/.config/radiant/routing.json` com Claude Code e Codex | Owner, pelo dotfiles | 4 |
| Servidor do herdr rodando | Owner | 3 |
| Claude Code e Codex autenticados no terminal | Owner | 3 |
| Pin do AIKM numa revisão com `check_dispatch.py` | Sessão no AIKM | 5 |
| Pin do Demerzel igual ao checkout Radiant da máquina | Este repositório | cada Build |

## Conferido para a Spec

A Spec deixa para o Plan conferir a superfície externa. Em 2026-10-29:

- herdr 0.9.0: `worktree create` aceita `--cwd`, `--branch`, `--base`,
  `--path`, `--label`, `--no-focus` e `--trust-repository`; `agent start`
  aceita `--kind claude` e `--kind codex` com argumentos do agente depois de
  `--`; `agent prompt` aceita `--wait`, `--until` e `--timeout`. Bate com a
  tabela da Spec, seção 2.5.
- Claude Code 2.1.286: `--model` aceita o ID completo e `--effort` aceita
  `low`, `medium`, `high`, `xhigh` e `max`.
- Codex 0.163.0: `--model` e `-c <chave>=<valor>` existem, e a configuração
  do usuário já usa `model_reasoning_effort`. O `--help` não lista os níveis
  aceitos. O incremento 3 confere os níveis no smoke; até lá, o Demerzel não
  valida o nível do Codex e, se o CLI recusar, segue a regra do
  [roteamento](https://github.com/faelplg/radiant/blob/6b129752b6687598e9bc3582c1c89c7ee6d71aee/docs/routing.md):
  registra e omite o esforço.
- Bun 1.4.2 instalado.
