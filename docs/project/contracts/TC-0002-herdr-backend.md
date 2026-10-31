# Radiant Task Contract - Demerzel - Incremento 4, backend herdr e smoke

**Contract ID:** `TC-0002`
**Revisão do contrato:** 1, 2026-10-31
**Project:** `demerzel`
**Iteration:** Plan 0.3, incremento 4
**Status:** `READY`
**Lifecycle:** `ready`, não ativo até o owner apontar o `ACTIVE.md` para ele
**Owner:** Fael (humano); Build por um agente no papel `radiant-dev`;
orquestrador responsável pelo smoke com harness real e pela crítica
independente
**Risk tier:** `2`. Primeiro efeito real: sessões do herdr, worktrees e
harnesses lançados com modelos pagos. Os efeitos ficam em repositórios
descartáveis e numa sessão herdr isolada, nunca nos projetos do owner
**Capability:** `default`
**Engineering Baseline:** `Radiant Engineering Baseline v0.1`
**Engineering Profile:** `none`
**Referência Radiant:** `6b129752b6687598e9bc3582c1c89c7ee6d71aee`
**Commit de entrada do Build:** o commit do `main` em que o `ACTIVE.md` passa
a apontar para este contrato, gravado no relatório antes da primeira edição

## 1. Objective

> **O Demerzel lança, observa e encerra tarefas no herdr real: um backend
> herdr implementa a interface do núcleo nos dois modos de worktree da Spec
> 2.5, e o CLI passa a responder `resume`, `status`, `wait`, `collect` e
> `close` com esse backend, provado por testes com um herdr falso, por um
> cenário contra o herdr real numa sessão isolada e por um smoke com Claude
> Code e Codex.**

## 2. Why this task exists

**Source plan/spec:**

- [Plan 0.3](../PLAN.md), incremento 4, e o ponto de parada depois dele.
- [Spec 0.8](../SPEC.md): seção 2.4, a parte `herdr`; seção 2.5 inteira;
  seção 4, os cinco comandos que recebem ID; seção 6; seção 7, verificações
  7 e 8.
- [TC-0001](TC-0001-core.md), non-goals: o incremento 4 liga `resume`,
  `status`, `wait`, `collect` e `close` ao CLI; `dispatch` fica para o 5.

**Hypothesis or risk reduced:**

- A premissa mais frágil do Frame, a de que os harnesses iniciam pelo herdr
  sem intervenção frequente, foi provada no incremento 1 só com comandos do
  herdr. Este incremento repete o critério pelo próprio Demerzel. Se algum
  harness pedir intervenção em mais de um de cinco lançamentos, a hipótese
  cai antes da integração Radiant (ponto de parada do Plan).

## 3. Inputs

- `docs/project/SPEC.md` (revisão 0.8) e `docs/project/PLAN.md`.
- O núcleo do incremento 3 em `src/core/`, em especial `backend.ts`, a
  interface que este contrato implementa, e `config.ts`.
- `docs/project/verification/2026-10-30-launch-probe.md` e
  `2026-10-31-claude-worktree-base-probe.md`: comandos, desfechos e tempos
  conferidos no herdr 0.9.0, Claude Code 2.1.286 e Codex 0.166.0.
- `docs/project/verification/2026-10-31-tc-0001-core.md`: limitações
  herdadas, como o label com espaço ainda não conferido.
- Conferido pelo orquestrador em 2026-10-31, ao preparar este contrato, no
  herdr 0.9.0:
  - `herdr status --json` traz `server.running`, `server.compatible` e
    `server.version`;
  - `herdr api snapshot` traz `result.snapshot` com `agents` (com `name`
    quando o agente foi iniciado por nome, `agent_status`, `pane_id`,
    `tab_id`, `workspace_id`, `foreground_cwd`), `panes`, `tabs` e
    `workspaces` (com `label`);
  - `workspace create --label "TC-0099.1 dz-0123456789abcdef"` guarda o
    label com espaço intacto;
  - `herdr --session <nome> server` sobe um servidor sem interface numa
    sessão própria, vazio, e `herdr --session <nome> server stop` o para sem
    afetar a sessão `lab`. A sessão deixa a pasta
    `~/.config/herdr/sessions/<nome>/`.

Não inferir inputs ausentes que mudariam materialmente a solução. Uma lacuna
da Spec é `HOLD`, não decisão do Build.

## 4. Allowed scope

### Paths allowed to change

```text
src/herdr/
src/cli.ts
src/cli/
test/herdr/
test/cli.test.ts
package.json            (só a seção scripts)
AGENTS.md               (só a lista de comandos dentro do bloco radiant)
docs/project/verification/
```

### Paths read-only

```text
src/core/
test/core/
docs/project/SPEC.md
docs/project/PLAN.md
docs/project/FRAME.md
docs/project/contracts/
tsconfig.json
bun.lock
.gitignore
.radiant.json
```

### External systems allowed

- `git` e o executável `herdr`, este só por sessões herdr isoladas que o
  próprio teste ou script sobe e para, com nome próprio do Demerzel. Nunca a
  sessão `lab` nem outra sessão do owner.
- `claude` e `codex` só pelo smoke da seção 11, rodado pelo orquestrador.
- Nenhum Radiant e nenhum `python3`.

### Network

`DENIED` para o agente do Build. O smoke da seção 11 lança harnesses que
falam com os próprios provedores; isso é egress dos harnesses, autorizado só
para o smoke, com pedidos que levam apenas o texto fixo do Demerzel.

### Execution units

Uma unidade só, sem bloco `radiant-units`: o Demerzel ainda não despacha
unidades.

## 5. Required outputs

1. `src/herdr/` com o backend herdr que implementa `Backend` de
   `src/core/backend.ts`:
   - a leitura e a validação de `herdr` da configuração (Spec 2.4);
   - todo comando ao herdr com `--session <nome>` quando configurado;
   - `probe`, `snapshot`, `prepare`, `launch`, `send` e `closeWorkspace`;
   - a tabela de lançamento, os dois modos de worktree, o hook
     `WorktreeCreate` e a pós-condição do Claude Code (Spec 2.5).
2. `src/cli.ts`, e `src/cli/` se preciso, com `resume`, `status`, `wait`,
   `collect` e `close` (Spec 4) sobre o núcleo e o backend herdr, com
   `--json` e texto curto. `dispatch` continua recusado com `2`.
3. `test/herdr/` com:
   - testes do backend contra um `herdr` falso no `PATH`, que grava os
     argumentos e devolve respostas gravadas, rodando em `bun run check`;
   - o cenário da verificação 7 contra o herdr real, num script próprio fora
     do `bun run check`;
   - o smoke da verificação 8, num script próprio, para o orquestrador rodar.
4. Scripts em `package.json` para o cenário e o smoke, e os comandos novos na
   lista do `AGENTS.md`.
5. `docs/project/verification/<data>-tc-0002-herdr.md` com o commit de
   entrada, o Completion report, a evidência da seção 11, a tabela de
   rastreabilidade, as contagens de intervenção e os recursos que sobraram.
   O orquestrador acrescenta o smoke e a crítica independente.

Não criar artefatos adicionais sem necessidade observada.

## 6. Non-goals

Esta tarefa **não** deve:

- ligar `dispatch` ao CLI nem ler `.radiant.json`, contratos, roteamento ou
  adapters (incremento 5);
- mudar o núcleo em `src/core/`. Se a interface não comportar algo que a
  Spec 2.5 pede, é `HOLD`;
- usar a sessão `lab`, ou qualquer sessão herdr do owner, em teste ou
  script;
- passar flags de permissão ou de bypass a qualquer harness, nem
  `--trust-repository` ao herdr (Spec 2.5 e 6);
- responder diálogos de confiança, permissão ou pergunta em qualquer aba;
- remover worktree ou branch fora dos repositórios descartáveis do cenário e
  do smoke;
- mudar como o Codex recebe o esforço. O `-c model_reasoning_effort` da Spec
  2.5 faz o Codex 0.166 rodar fora do servidor compartilhado, com um aviso;
  trocar por `--profile` é decisão da Spec, registrada como observação;
- adicionar dependência de runtime ou de desenvolvimento.

Encontrar uma melhoria fora deste escopo não autoriza implementá-la.
Registre-a como observação ou Learn Back candidate.

## 7. Functional requirements

Cada item aponta para a Spec, que continua sendo a fonte.

- [ ] H1. Configuração `herdr` (Spec 2.4): `session` opcional no formato
  `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; chave desconhecida ou formato errado é
  `config-invalid`; presente, toda chamada ao herdr leva `--session <nome>`,
  inclusive a leitura de versão.
- [ ] H2. `probe` lê `herdr status --json` e devolve `running`, `compatible` e
  versão igual ou acima de 0.9.0. herdr ausente do `PATH`, saída que não é
  JSON ou servidor parado viram `backend-unavailable`, nunca exceção solta.
- [ ] H3. `snapshot` lê `herdr api snapshot` e devolve, no formato do núcleo,
  os agentes iniciados por nome (com `working`, `blocked`, `idle`, `done` ou
  `unknown` e o pane) e cada workspace com label, aba raiz e pane raiz. Um
  `agent_status` que o núcleo não conhece vira `unknown`.
- [ ] H4. `prepare`, sem efeito: o esforço pela tabela de lançamento, omitido
  com motivo quando o nível não está entre os conferidos no incremento 1
  (Claude Code `low` a `max`; Codex `minimal` a `xhigh`); e, no Claude Code, o
  JSON do `--settings` com o hook `WorktreeCreate`, cada argumento entre aspas
  simples no escape de POSIX `sh`.
- [ ] H5. `launch` no Codex: `herdr worktree create` com branch, base, path e
  label da Spec 2.5, e depois `herdr agent start` no pane raiz, com modelo e
  esforço. Worktree, workspace, aba, pane e agente chegam por `onCreated` na
  ordem em que passam a existir.
- [ ] H6. `launch` no Claude Code: `herdr workspace create` na raiz do
  projeto, e depois `herdr agent start` com `--worktree <nome do agente>`,
  `--settings <json>`, modelo e esforço. Depois do início, a pós-condição da
  Spec 2.5: `foreground_cwd` do agente igual ao path do worktree, branch
  existente e apontando para o commit base. Se não, `failed` com os recursos
  que existem.
- [ ] H7. Startup bloqueado (`agent_not_ready`) devolve `blocked` com os IDs e
  os recursos criados, inclusive um worktree que o hook já tenha criado.
- [ ] H8. `send` com `herdr agent prompt <nome> <texto> --wait --until
  working --until blocked --timeout <ms>`: confirmado é `sent`; agente ainda
  bloqueado antes de receber é `not-ready`; `agent_prompt_stalled`, timeout
  ou resposta inesperada é `unknown`.
- [ ] H9. `closeWorkspace` com `herdr workspace close`; workspace que já não
  existe não é erro.
- [ ] H10. O backend nunca passa flags de permissão, de bypass ou
  `--trust-repository`, e nunca escreve numa aba.
- [ ] H11. CLI (Spec 4): `resume <id>`, `status [<id>...] [--all]`,
  `wait <id>... [--timeout <ms>]`, `collect <id>`, `close <id>
  [--discard-worktree]`, cada um com `--json` (o envelope do núcleo, sem
  mudança) e texto curto com ID, ciclo de vida, `agent`, `report` e, numa
  recusa, código, mensagem e próximo passo. Códigos de saída do núcleo.
  Argumento desconhecido ou faltando é recusa com `2` e diz o uso.
  `dispatch` continua recusado com `2`.
- [ ] H12. Recusa da configuração ou do backend no CLI sai com `2` sem efeito,
  como no núcleo.

## 8. Engineering Check

| Baseline | Status | Aplicação nesta tarefa | Evidência |
| --- | --- | --- | --- |
| EB-01 Complexidade deliberada | REQUIRED | Um módulo de backend que traduz a interface em comandos do herdr; nada de cliente genérico do socket do herdr | Revisão do diff |
| EB-02 Correção e contratos | REQUIRED | Cada desfecho do herdr mapeado para o desfecho do núcleo; recursos comunicados quando passam a existir | Testes com o herdr falso |
| EB-03 Verificação e testes | REQUIRED | Herdr falso no `check`; cenário real isolado; smoke com harness real | `bun run check`, scripts do cenário e do smoke |
| EB-04 Segurança e privacidade | REQUIRED | Escape do hook em POSIX `sh`; nenhuma flag de permissão; nenhum conteúdo de arquivo no pedido; nenhuma sessão do owner tocada | Teste de escape com aspas, espaço e `$`; teste de argumentos |
| EB-05 Manutenibilidade | REQUIRED | `src/herdr/` depende só dos tipos do núcleo; `src/core/` não importa `src/herdr/` | Teste de fronteira |
| EB-06 Dependências | REQUIRED | Nenhuma dependência nova | `bun.lock` sem diff |
| EB-07 Diagnóstico | REQUIRED | Erro do herdr chega com o comando e a saída relevantes na mensagem, sem conteúdo do pedido | Asserções nos testes |
| EB-08 Experiência e eficiência | APPLICABLE | `wait` não chama o herdr mais de uma vez por intervalo; texto curto legível | Revisão e teste do texto |

## 9. Project-specific constraints

- Bun e TypeScript estrito, sem afrouxar o `tsconfig.json`.
- Toda chamada ao herdr passa por um único ponto do backend, com argumentos
  em lista, nunca por shell.
- Testes e scripts sobem a própria sessão herdr com nome `dz-test-<aleatório>`
  ou `dz-smoke-<aleatório>` e a param no fim, inclusive em falha. O cenário
  remove a pasta `~/.config/herdr/sessions/<nome>/` que criou.
- Repositórios do cenário são temporários. O smoke usa um repositório
  descartável num path fixo, dado por variável de ambiente, que o owner
  confia uma vez em cada CLI, como na autenticação inicial.
- Git isolado nos testes, como no TC-0001: `GIT_CONFIG_GLOBAL` vazio,
  `GIT_CONFIG_NOSYSTEM=1`, identidade fixa. O smoke usa o Git do owner, porque
  os harnesses usam.

## 10. Dependency policy

### New runtime dependency allowed?

`NO`. Dependência de desenvolvimento nova também não. Se alguma parecer
necessária, é `HOLD`.

## 11. Verification plan

### Automated

```text
bun install --frozen-lockfile
bun run check                (inclui os testes do backend com o herdr falso)
git diff --exit-code <commit de entrada> -- src/core test/core bun.lock tsconfig.json .gitignore
git status --porcelain       (vazio depois do commit final)
```

### Cenário herdr real (verificação 7), rodado pelo Build

Script próprio, com o herdr 0.9.0 real numa sessão isolada e repositórios
temporários, sem harness de modelo. O herdr só inicia agentes dos tipos que
conhece, então o cenário cobre o que não depende de agente vivo:

- versão e `backend-unavailable` com a sessão parada;
- `herdr worktree create` e `herdr workspace create` pelos comandos que o
  backend monta, com o label com espaço lido de volta no snapshot;
- snapshot com o mapeamento de H3;
- `closeWorkspace`, e de novo sobre um workspace que já não existe;
- `close` sem descarte preservando worktree e branch, e descarte com
  alterações saindo com `1` e mantendo o worktree, sobre tarefas cujo
  lançamento parou depois do workspace.

O que a verificação 7 pede com agente vivo (envio voltando em `working`,
outro `dispatch` sem esperar o turno, `close` em `working` recusado) é
coberto pelo smoke.

### Smoke com harness real (verificação 8), rodado pelo orquestrador

Com o owner presente, porque gasta modelo e pode pedir permissão. Pré-requisitos:
CLIs autenticados, repositório descartável confiado uma vez em cada CLI, e a
permissão de escrita no repositório descartável decidida pelo owner.

- Cinco tarefas por harness, lançadas pela função `dispatch` do núcleo com o
  backend herdr, a partir de uma tarefa escrita à mão num arquivo de fixture
  do smoke, sem Radiant. O pedido aponta para um arquivo do repositório
  descartável que pede só para gravar uma linha no arquivo de retorno.
- Contagem do critério do Plan: intervenção é qualquer ação humana na aba
  antes do pedido chegar, exceto a autenticação inicial. Ações depois da
  chegada, como aprovar a escrita do retorno, são registradas à parte.
- Cada tarefa: envio voltando com o agente em `working`; outro `dispatch` do
  mesmo projeto sem esperar o turno; `wait`, `collect` e `close` pelo CLI.
- Claude Code: worktree com path, branch e commit base da tarefa; e um caso
  em que um hook `WorktreeCreate` do próprio projeto imprime outro path,
  levando a tarefa a `launch-failed`.
- `close` em `working` recusado com um agente real trabalhando.
- Versões de herdr, Claude Code e Codex registradas.

### Cenários com o herdr falso, no `bun run check`

Cada requisito H1 a H12 com pelo menos um teste, e ao menos estes casos:
argumentos exatos de cada comando nos dois modos, com e sem `--session`;
escape do hook com aspas simples, espaço, `$` e quebra de linha recusada;
cada desfecho de `agent start` e `agent prompt`; snapshot com agente sem
nome, status desconhecido e workspace sem aba; herdr ausente e saída que não é
JSON; pós-condição do Claude Code falhando por `foreground_cwd`, por branch
ausente e por commit diferente; e o CLI com `--json`, texto e uso errado.

### Mutação

Para pelo menos três regras críticas (nenhuma flag de permissão,
`--session` em toda chamada, pós-condição do Claude Code), o Build quebra a
regra de propósito, mostra o teste falhando e desfaz.

### Readback

- Reabrir os argumentos gravados pelo herdr falso num lançamento de cada
  modo e conferir contra a Spec 2.5.
- `git diff --stat <commit de entrada>` e `git status --porcelain`: nenhuma
  mudança fora da seção 4.

### Independent critique

`REQUIRED`, feita pelo orquestrador depois do Completion report e do smoke:
um `radiant-verifier` num harness diferente do que fez o Build, escolhido pelo
owner, lançado na sessão herdr `lab`, lendo este contrato, a Spec, o diff
contra o commit de entrada e o relatório. As objeções e o que foi feito com
cada uma entram no relatório. Releitura própria não conta.

## 12. Acceptance criteria

A tarefa só pode ser declarada `DONE` quando:

- [ ] cada requisito H1 a H12 e cada cenário da seção 11 têm teste ou
  evidência, ligados na tabela de rastreabilidade;
- [ ] `bun run check` passa num clone limpo;
- [ ] o cenário herdr real passou, com a versão do herdr registrada e a
  sessão isolada parada no fim;
- [ ] o smoke registrou, para cada harness, as intervenções antes da chegada
  do pedido em cinco lançamentos, e nenhum harness passou de uma; se passou,
  o contrato fecha em `HOLD` pelo ponto de parada do Plan;
- [ ] as mutações da seção 11 foram mostradas falhando;
- [ ] `src/core/`, `test/core/`, `bun.lock`, `tsconfig.json` e `.gitignore`
  não mudaram contra o commit de entrada;
- [ ] a crítica independente foi feita pelo orquestrador e cada objeção foi
  aceita com correção ou recusada com motivo;
- [ ] os recursos que sobraram, worktrees, branches e pastas de sessão, estão
  listados no relatório;
- [ ] não houve mudança fora do Allowed scope, contra o commit de entrada;
- [ ] a evidência final foi lida, não apenas presumida pelo exit code.

Referentes: os critérios valem para `src/herdr/`, `src/cli.ts`, `src/cli/` e
seus testes. O comportamento dos harnesses e dos modelos fica fora; o smoke
registra o que eles fizeram, sem julgar a qualidade da resposta.

## 13. HOLD conditions

Interromper e pedir decisão quando:

- a Spec não decide um comportamento que muda o registro, o ciclo de vida, um
  código de saída ou um argumento passado a harness;
- a interface do núcleo não comporta algo que a Spec 2.5 pede;
- o herdr real se comporta diferente do que o incremento 1 e a seção 3
  registraram;
- um teste ou script precisaria tocar a sessão `lab` ou um projeto do owner;
- um harness pede intervenção antes do pedido chegar em mais de um de cinco
  lançamentos (ponto de parada do Plan);
- uma dependência nova parecer necessária;
- a solução mínima deixou de caber neste contrato.

`HOLD` é resultado válido.

## 14. FAIL conditions

Marcar `FAIL` quando:

- os critérios da seção 12 não podem ser satisfeitos;
- a verificação mostra regressão no núcleo ou no entrypoint;
- uma flag de permissão, de bypass ou `--trust-repository` chega a um
  harness ou ao herdr;
- o pedido enviado leva conteúdo de arquivo apontado.

Não mascarar `FAIL` como `DONE WITH NOTES`.

## 15. Change budget

O agente pode:

- organizar `src/herdr/`, `src/cli/` e `test/herdr/` como o trabalho pedir;
- escrever o herdr falso e helpers de teste dentro de `test/herdr/`;
- atualizar os scripts do `package.json` e a lista de comandos do
  `AGENTS.md`.

O agente não pode, sem HOLD:

- mudar o núcleo, a Spec, o Plan ou este contrato;
- mudar a stack ou o `tsconfig.json`;
- antecipar a integração Radiant ou o `dispatch` no CLI;
- adicionar features não pedidas.

## 16. Completion report

Gravado no relatório de verificação do output 5, com Status (`DONE`, `HOLD`
ou `FAIL`), Changed, Verification evidence, Engineering notes, Remaining
limitations e Learn Back candidate, no formato do template de Task Contract
do Radiant na referência acima. O Build entrega com o status que a evidência
dele sustenta; o `DONE` do contrato espera o smoke e a crítica independente.

## 17. Completion rule

> **Não declarar DONE porque o código parece correto. Declarar DONE apenas
> quando os critérios observáveis, a engenharia aplicável e a evidência de
> verificação convergirem.**
