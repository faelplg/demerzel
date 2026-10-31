# Radiant Task Contract - Demerzel - Incremento 3, núcleo

**Contract ID:** `TC-0001`
**Revisão do contrato:** 2, 2026-10-31. A revisão 1 recebeu a crítica do
Codex em `gpt-6-astra`, papel `radiant-grill`: doze objeções, todas aceitas
pelo owner e aplicadas aqui e na Spec 0.6, antes de qualquer execução
**Project:** `demerzel`
**Iteration:** Plan 0.3, incremento 3
**Status:** `READY`
**Lifecycle:** `active` desde 2026-10-31, por decisão do owner; o `ACTIVE.md` aponta para ele
**Owner:** Fael (humano); Build por um agente no papel `radiant-dev`;
orquestrador responsável pela crítica independente
**Risk tier:** `2`. Registro durável, lock e o contrato que os incrementos 4 e
5 implementam; nenhum efeito externo real, porque o backend é falso
**Capability:** `default`
**Engineering Baseline:** `Radiant Engineering Baseline v0.1`
**Engineering Profile:** `none`
**Referência Radiant:** `6b129752b6687598e9bc3582c1c89c7ee6d71aee`
**Commit de entrada do Build:** o commit de merge, no `main`, do PR que traz
a emenda 1, gravado no relatório antes da primeira edição

## 1. Objective

> **O núcleo do Demerzel existe em `src/core/`: recebe uma `Task` já
> resolvida, aplica as recusas do núcleo sem efeito, grava e reconcilia o
> registro sob lock, recupera `dispatch` interrompido, e executa `dispatch`,
> `resume`, `status`, `wait`, `collect` e `close` contra uma interface de
> backend, provado com um backend falso em memória e sem nada do Radiant.**

## 2. Why this task exists

**Source plan/spec:**

- [Plan 0.3](../PLAN.md), incremento 3.
- [Spec 0.8](../SPEC.md): seção 1; seção 2 inteira, com o backend da 2.5 só
  como interface; seção 4 com a matriz; seção 5, recusas do núcleo; seção 6;
  seção 7, verificações 1, 2 e 5 e a parte do núcleo das 3 e 4.

**Hypothesis or risk reduced:**

- O ciclo de vida, o registro e as recusas são a parte do Demerzel que não
  depende de herdr nem de Radiant. Prová-los com um backend falso separa os
  erros de estado dos erros de integração antes dos incrementos 4 e 5.
- A interface de backend precisa aguentar os dois modos de worktree da Spec
  0.4, seção 2.5, sem mudar o núcleo no incremento 4.

## 3. Inputs

- `docs/project/SPEC.md` (revisão 0.8) e `docs/project/PLAN.md` (revisão 0.3).
- `docs/project/FRAME.md`, para a regra de egress e as fronteiras.
- A stack do incremento 2: `package.json`, `tsconfig.json`, `bun.lock`,
  `src/cli.ts`, `test/cli.test.ts`, e os comandos do `AGENTS.md`.
- `docs/project/verification/2026-10-30-launch-probe.md` e
  `2026-10-31-claude-worktree-base-probe.md`, para a ordem dos efeitos e os
  dados de cada modo de worktree.
- Git 2.x e a libc do sistema, esta por `bun:ffi` para o `flock`. O núcleo
  pode chamar `git`; nenhum outro executável.

Não inferir inputs ausentes que mudariam materialmente a solução. Uma lacuna
da Spec é `HOLD`, não decisão do Build.

## 4. Allowed scope

### Paths allowed to change

```text
src/core/
test/core/
package.json            (só a seção scripts)
AGENTS.md               (só a lista de comandos dentro do bloco radiant)
docs/project/verification/
```

### Paths read-only

```text
docs/project/SPEC.md
docs/project/PLAN.md
docs/project/FRAME.md
docs/project/contracts/
src/cli.ts
test/cli.test.ts
tsconfig.json
bun.lock
.gitignore
.radiant.json
```

### External systems allowed

- `git`, em repositórios temporários criados pelos testes.
- Nenhum herdr, harness, Radiant ou `python3` pelo Build. A crítica
  independente da seção 11 é feita pelo orquestrador, fora do Build.

### Network

`DENIED`

### Execution units

Uma unidade só, sem bloco `radiant-units`: o Demerzel ainda não despacha
unidades, e dividir o núcleo não reduz risco.

## 5. Required outputs

1. `src/core/` com:
   - `Task` e `Request` da Spec 2.1 e 2.2, com validação, a regra de
     `writes` e o montador do pedido;
   - a leitura da configuração da Spec 2.4 na parte do núcleo: `schema`,
     chaves conhecidas e padrões. `herdr` e `radiant` passam adiante sem
     validação de conteúdo;
   - o registro da Spec 2.3: raiz, chave do projeto, arquivos de tarefa,
     escrita atômica, lock por `flock`, ordem das gravações, recuperação,
     ciclo de vida, estado observado em dois campos e reconciliação;
   - o nome de agente da Spec 2.5;
   - a interface de backend e o backend falso em memória;
   - os seis comandos como funções que devolvem código de saída e o envelope
     `--json` da Spec 4.
2. `test/core/` com as suítes das verificações 1, 2, 5 e a parte do núcleo
   das 3 e 4, e os cenários da seção 11. Cada teste nomeia o comportamento
   que protege e a regressão que o faria falhar.
3. Um script em `package.json` que roda `test/core/` com um `PATH` sem
   `python3`, e que entra em `bun run check`.
4. O comando novo na lista do `AGENTS.md`.
5. `docs/project/verification/<data>-tc-0001-core.md` com o commit de
   entrada, o Completion report, a evidência da seção 11 e a tabela de
   rastreabilidade. O orquestrador acrescenta depois a crítica independente.

Não criar artefatos adicionais sem necessidade observada.

## 6. Non-goals

Esta tarefa **não** deve:

- implementar o backend herdr, chamar o herdr ou montar argumentos de
  harness, inclusive o JSON do hook `WorktreeCreate` (incremento 4);
- ler `.radiant.json`, contratos, `radiant-units`, regras de roteamento ou
  adapters, nem chamar `check_project.py` ou `check_dispatch.py`
  (incremento 5);
- implementar as recusas da integração, inclusive `approval-required`. O
  núcleo só registra `approval` e o uso de `--human-approved`;
- ligar os comandos ao `src/cli.ts`. O entrypoint continua só com
  `--version`; o incremento 4 liga `resume`, `status`, `wait`, `collect` e
  `close` com o backend real, e o 5 liga `dispatch`;
- adicionar dependência de runtime ou de desenvolvimento;
- lançar a crítica independente ou qualquer outro agente;
- implementar seguimentos para sessões lançadas ou interface de observação
  (Spec 8).

Encontrar uma melhoria fora deste escopo não autoriza implementá-la.
Registre-a como observação ou Learn Back candidate.

## 7. Functional requirements

Cada item aponta para a Spec, que continua sendo a fonte; o contrato não
repete o texto dela.

- [ ] R1. `Task`, `Request`, labels, IDs e paths seguem a Spec 2.1 e 2.2;
  fora do formato é `task-invalid`. O texto final do pedido tem só o texto
  fixo, o ID, o papel, os pointers e o `returnPath`, e é gravado no registro.
- [ ] R2. `writes` segue a Spec 2.1: validação, sobreposição por segmentos,
  diferença de caixa e nenhum symlink resolvido; `writes-overlap` contra
  tarefas que não estão `closed`.
- [ ] R3. A configuração segue a Spec 2.4; `schema` diferente de `1` ou chave
  desconhecida é `config-invalid`; arquivo ausente usa os padrões.
- [ ] R4. O registro segue a Spec 2.3: raiz por `XDG_STATE_HOME` ou
  `~/.local/state`, chave do projeto pelo `git rev-parse --git-common-dir`
  (um orquestrador num worktree vê o mesmo registro), um arquivo por tarefa
  gravado por temporário e rename, e o histórico de transições com horários.
- [ ] R5. O lock segue a Spec 2.3: `flock` por `bun:ffi`, pego por
  `dispatch`, `resume`, `collect` e `close` e nunca por `status` e `wait`,
  espera de até 30 s e `project-locked` sem efeito depois do tempo.
- [ ] R6. O `dispatch` grava na ordem da Spec 2.3, com cada gravação
  terminada antes do passo seguinte, e segura o lock até `launched` ou
  `launch-failed`.
- [ ] R7. A recuperação segue a Spec 2.3: quem pega o lock e acha `recorded`
  ou `launching` grava `interrupted` e leva a tarefa a `launch-failed` ou a
  `launched` com `request_sent` `false` ou `unknown`, conforme o que existe,
  sem relançar nem reenviar.
- [ ] R8. O ID nunca é reutilizado: qualquer ID registrado é `task-exists`.
- [ ] R9. O nome de agente segue a Spec 2.5: `dz-` mais 16 hex do sha256 de
  `<chave do projeto>:<id>`, gravado e nunca recalculado; nome já usado por
  agente vivo no snapshot é `agent-name-taken`.
- [ ] R10. O estado observado tem os dois campos da Spec 2.3, `agent` e
  `report`, e o envelope `--json` os traz.
- [ ] R11. A interface de backend cobre sondar disponibilidade e versão, ler
  o snapshot, criar worktree e sessão, iniciar o agente, enviar o pedido,
  ler o estado e encerrar com ou sem descarte. Ela também carrega, sem caso
  especial no núcleo:
  - um dado de preparo do lançamento que o backend devolve antes do primeiro
    efeito e o núcleo grava em `recorded`, como o JSON do hook do Claude
    Code;
  - o esforço aplicado ou omitido, devolvido pelo backend e gravado;
  - cada recurso criado, comunicado quando é criado, para que `created`
    esteja certo nos dois modos da Spec 2.5: worktree antes da sessão (Codex)
    e worktree no início do agente (Claude Code);
  - a falha da pós-condição de lançamento com recursos parciais, que leva a
    `launch-failed`.
- [ ] R12. O backend falso cria worktrees Git reais nos repositórios
  temporários e permite injetar cada desfecho: startup bloqueado, envio
  confirmado, `agent_prompt_stalled`, timeout, falha depois de cada efeito,
  falha de pós-condição, pane ausente e agente `unknown`.
- [ ] R13. As recusas do núcleo da Spec 5 (`dependency-pending`,
  `writes-overlap`, `backend-unavailable`, `backend-version`,
  `branch-exists`, `worktree-exists`, `config-invalid`, `task-invalid`,
  `task-exists`, `agent-name-taken`, `project-locked`, `task-not-found`,
  `wrong-lifecycle`, `request-already-sent`, `task-lost`, `task-working`)
  saem com `2` e não criam nem mudam arquivo de tarefa, branch, worktree ou
  chamada de efeito no backend.
- [ ] R14. Os seis comandos seguem a Spec 4 e cada linha da matriz: códigos
  de saída, `wait` com retorno presente e agente `working`, `collect` sem
  backend, `close` com `1` quando o descarte é recusado, repetição do
  descarte numa tarefa `closed`, e `wait` por ciclo próprio com intervalo e
  relógio injetáveis.
- [ ] R15. Todo comando que fala com o backend reconcilia o registro com o
  snapshot antes de agir; pane ausente vira agente `lost` e nunca é
  relançado sozinho.
- [ ] R16. `request_sent` é `true`, `false` ou `unknown` conforme a Spec 2.5,
  e `unknown` nunca leva a reenvio automático.
- [ ] R17. O uso de `--human-approved` e `--discard-worktree` fica gravado no
  registro, e nenhuma mensagem de erro ou envelope traz conteúdo de arquivo
  apontado pelo pedido (Spec 6).

## 8. Engineering Check

| Baseline | Status | Aplicação nesta tarefa | Evidência |
| --- | --- | --- | --- |
| EB-01 Complexidade deliberada | REQUIRED | Uma interface de backend, um registro, funções por comando; nada de framework de CLI, injeção genérica ou abstração para backends futuros além do falso | Revisão do diff |
| EB-02 Correção e contratos | REQUIRED | Escrita atômica, exclusão mútua por `flock`, ordem das gravações, recuperação, transições da matriz | Cenários da seção 11 |
| EB-03 Verificação e testes | REQUIRED | Testes pelo percurso de cada comando, com Git real, processos separados e backend falso | `bun run check` |
| EB-04 Segurança e privacidade | REQUIRED | Egress do pedido e das mensagens (Spec 6): só IDs, refs e paths | Cenário de marcadores no pedido, no envelope e nas recusas |
| EB-05 Manutenibilidade | REQUIRED | Fronteira `src/core/` sem Radiant; tipos estritos sem `any` nem `as` para calar o compilador | Teste da verificação 2 e `tsc` |
| EB-06 Dependências | REQUIRED | Nenhuma dependência nova; `bun:ffi` é do runtime | `bun.lock` sem diff contra o commit de entrada |
| EB-07 Diagnóstico | REQUIRED | Toda recusa tem `code`, `message` e `next` da Spec 4 | Asserções nas suítes de recusa |
| EB-08 Experiência e eficiência | APPLICABLE | `status` e `wait` não fazem trabalho proporcional ao histórico inteiro a cada ciclo | Revisão do diff |

## 9. Project-specific constraints

- Bun e TypeScript estrito da stack do incremento 2, sem afrouxar o
  `tsconfig.json`.
- `src/core/` não importa `src/radiant/` nem cita `.radiant`,
  `radiant-units` ou `check_project` (Spec 7, verificação 2).
- O núcleo nunca faz merge, push, PR ou remoção de branch, e nunca responde
  prompts (Spec 6).
- Nenhuma telemetria: o núcleo não abre conexão de rede. O teste de fronteira
  também falha se `src/core/` usar `fetch`, `node:net`, `node:http`,
  `node:https`, `node:dgram` ou `Bun.connect`.
- Testes usam `HOME`, `XDG_STATE_HOME` e `XDG_CONFIG_HOME` temporários e um
  Git isolado: `GIT_CONFIG_GLOBAL` apontando para um arquivo vazio,
  `GIT_CONFIG_NOSYSTEM=1`, identidade de autor e committer fixada no
  ambiente e sem hooks. Nunca tocam o registro, a configuração ou o Git do
  owner.

## 10. Dependency policy

### New runtime dependency allowed?

`NO`. Dependência de desenvolvimento nova também não. Se alguma parecer
necessária, ou se o `flock` por `bun:ffi` não funcionar no Bun 1.4.2, é
`HOLD`.

## 11. Verification plan

### Automated

```text
bun install --frozen-lockfile
bun run check
<script do output 3>      (test/core sem python3 no PATH)
git diff --exit-code <commit de entrada> -- bun.lock tsconfig.json src/cli.ts test/cli.test.ts .gitignore
git status --porcelain     (vazio depois do commit final)
```

### Cenários obrigatórios

Cada um vira pelo menos um teste e uma linha na tabela de rastreabilidade
do relatório, que liga requisito, cenário e teste:

- Verificação 1: o fluxo `dispatch`, `resume`, `status`, `wait`, `collect`,
  `close` com o backend falso, configuração e estado temporários, sem
  checkout Radiant, sem `.radiant.json` e sem `python3` no `PATH`.
- Verificação 2: o teste de fronteira falha quando um arquivo de
  `src/core/` importa `src/radiant/`, cita os termos proibidos ou usa uma API
  de rede da seção 9; o Build mostra a falha com um arquivo de prova e depois
  o remove.
- Verificação 3, parte do núcleo: cada recusa de R13, com saída `2`, código
  no JSON e prova de nenhum efeito: arquivos de tarefa iguais byte a byte,
  branches e worktrees iguais no Git, e nenhuma chamada de efeito registrada
  pelo backend falso.
- Verificação 4, parte do núcleo: um arquivo apontado com marcadores únicos
  não aparece no pedido gravado, no enviado ao backend falso, em nenhum
  envelope e em nenhuma mensagem de recusa.
- Lock, com processos separados e pontos de sincronia observáveis, nunca só
  `sleep`: o filho sinaliza por arquivo quando pegou o lock e quando está
  esperando, e o pai só segue depois do sinal. Casos: dois `dispatch`
  serializados; `collect` contra `close`, sem atualização perdida no estado
  nem no histórico; dono morto com `SIGKILL` e lock solto em seguida;
  `project-locked` com espera e relógio controláveis e um prazo real de
  proteção no teste. `status` e `wait` não esperam pelo lock.
- Interrupção: um `dispatch` em processo separado é morto com `SIGKILL` em
  cada ponto da ordem de gravações (depois de `recorded`, depois de cada
  recurso, depois de `send_started_at`), e outro processo pega o lock e
  recupera como R7 diz.
- Escrita atômica: um leitor concorrente nunca vê arquivo de tarefa parcial
  enquanto outro processo grava em laço.
- Estado observado: retorno presente com agente `working` faz `wait` voltar
  e `close` recusar com `task-working`; retorno presente com agente `lost` e
  com agente `blocked`.
- Matriz: cada linha da tabela da Spec 4, com aceite e com cada recusa,
  inclusive `collect` numa tarefa `closed`, `close` repetido, repetição do
  descarte e `backend-unavailable` em `resume`, `status`, `wait` e `close`.
- `writes`: os exemplos da Spec 2.1 (`src/` contra `src/a.ts`, `src` contra
  `src-old/`, caixa diferente) e paths inválidos.
- Dependências: tarefa coletada mas não fechada, fechada sem coleta, fechada
  e coletada sem o branch na base, e fechada e coletada com o branch na base.
- Interface: o backend falso nos dois modos de worktree, com o dado de
  preparo gravado em `recorded`, o esforço omitido gravado, falha depois de
  cada efeito e falha de pós-condição com recursos parciais em `created`.
- Flags humanas: `--human-approved` e `--discard-worktree` gravados.
- IDs: reuso de um ID `closed` recusado com `task-exists`; nomes de agente
  distintos para IDs que só diferem em caixa ou pontuação.
- Mutação: para pelo menos três regras críticas (decisão antes do efeito,
  recusa sem efeito, escrita atômica), o Build quebra a regra de propósito,
  mostra o teste falhando e desfaz.

### Readback

- Reabrir um arquivo de tarefa gravado por um teste e conferir campos e
  histórico contra a Spec 2.3.
- `git diff --stat <commit de entrada>` e `git status --porcelain`: nenhuma
  mudança, staged, unstaged ou não rastreada, fora da seção 4.

### Independent critique

`REQUIRED`, feita pelo orquestrador depois do Completion report e fora do
Build: um `radiant-verifier` num harness diferente do que fez o Build,
lançado pelo orquestrador na sessão herdr `lab`, lendo este contrato, a Spec,
o diff contra o commit de entrada e o relatório. Pré-requisitos: servidor do
herdr na sessão `lab` e o harness do verificador autenticado e com o
repositório confiado. As objeções e o que foi feito com cada uma entram no
relatório de verificação. Releitura própria não conta como crítica
independente.

## 12. Acceptance criteria

A tarefa só pode ser declarada `DONE` quando:

- [ ] cada requisito da seção 7 e cada cenário da seção 11 têm teste,
  ligados na tabela de rastreabilidade, e cada teste nomeia o comportamento e
  a regressão;
- [ ] `bun run check` passa num clone limpo, com a suíte do núcleo sem
  `python3` no `PATH`;
- [ ] as mutações da seção 11 foram mostradas falhando;
- [ ] `bun.lock`, `tsconfig.json`, `src/cli.ts`, `test/cli.test.ts` e
  `.gitignore` não mudaram contra o commit de entrada;
- [ ] a crítica independente foi feita pelo orquestrador e cada objeção foi
  aceita com correção ou recusada com motivo;
- [ ] todos os checks aplicáveis da seção 11 passam;
- [ ] não houve mudança fora do Allowed scope, contra o commit de entrada;
- [ ] limitações relevantes estão registradas;
- [ ] a evidência final foi lida, não apenas presumida pelo exit code.

Referentes: os critérios valem para o código de `src/core/` e `test/core/`.
Comportamento do herdr, dos harnesses e do Radiant fica fora; o backend falso
representa só o que a Spec 2.5 e as provas do incremento 1 registraram. O
`flock` é o da libc da máquina; a prova vale para macOS, onde o Build roda.

## 13. HOLD conditions

Interromper e pedir decisão quando:

- a Spec não decide um comportamento que muda o registro, o ciclo de vida ou
  um código de saída;
- a interface de backend não consegue representar um dos dois modos de
  worktree sem caso especial no núcleo;
- o `flock` por `bun:ffi` não funcionar como a Spec 2.3 descreve;
- uma dependência nova, ou uma mudança no `tsconfig.json`, parecer
  necessária;
- o Build precisaria escrever fora da seção 4 ou chamar herdr, harness,
  Radiant ou rede;
- a solução mínima deixou de caber neste contrato.

`HOLD` é resultado válido.

## 14. FAIL conditions

Marcar `FAIL` quando:

- os critérios da seção 12 não podem ser satisfeitos;
- a verificação mostra regressão no entrypoint do incremento 2;
- o registro pode ficar inconsistente depois de uma interrupção num dos
  pontos da ordem de gravações;
- o egress do pedido ou das mensagens não pode ser garantido.

Não mascarar `FAIL` como `DONE WITH NOTES`.

## 15. Change budget

O agente pode:

- organizar `src/core/` e `test/core/` como o trabalho pedir;
- adicionar helpers de teste dentro de `test/core/`;
- atualizar a lista de comandos do `AGENTS.md` e os scripts do
  `package.json`.

O agente não pode, sem HOLD:

- mudar a Spec, o Plan ou este contrato;
- mudar a stack ou o `tsconfig.json`;
- antecipar o backend herdr, a integração Radiant ou a ligação com o CLI;
- adicionar features não pedidas.

## 16. Completion report

Gravado no relatório de verificação do output 5, com Status (`DONE`, `HOLD`
ou `FAIL`), Changed, Verification evidence, Engineering notes, Remaining
limitations e Learn Back candidate, no formato do template de Task Contract
do Radiant na referência acima. O Build entrega com o status que a
evidência dele sustenta; o `DONE` do contrato espera a crítica independente.

## Emenda 1, 2026-10-31

Antes da primeira edição do Build, o owner decidiu três lacunas da Spec 0.6,
registradas na Spec 0.7. A fronteira, os outputs e os critérios não mudam:

- R7: a recuperação é feita só por `dispatch`, `resume` e `close`; `collect`
  não recupera.
- R13: a recusa `not-a-project` entra na lista.
- R14: `status` testa o lock sem esperar e mostra `interrupted: true`, com
  saída `1`, para tarefa em `recorded` ou `launching` com o lock livre.
- O commit de entrada do Build passa a ser o merge do PR desta emenda, que
  também muda a referência deste contrato para a Spec 0.7.
- Depois da verificação independente, o owner decidiu o label do workspace
  (Spec 0.8, seção 2.5): ID da tarefa e nome do agente. Entra no mesmo PR
  desta emenda, antes do merge, e o contrato passa a apontar para a Spec 0.8.

## 17. Completion rule

> **Não declarar DONE porque o código parece correto. Declarar DONE apenas
> quando os critérios observáveis, a engenharia aplicável e a evidência de
> verificação convergirem.**
