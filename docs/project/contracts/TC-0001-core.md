# Radiant Task Contract - Demerzel - Incremento 3, núcleo

**Contract ID:** `TC-0001`
**Revisão do contrato:** 1, 2026-10-31
**Project:** `demerzel`
**Iteration:** Plan 0.3, incremento 3
**Status:** `READY`
**Lifecycle:** `ready`, não ativo até o owner apontar o `ACTIVE.md` para ele
**Owner:** Fael (humano); Build por um agente no papel `radiant-dev`
**Risk tier:** `2`. Registro durável, lock e o contrato que os incrementos 4 e
5 implementam; nenhum efeito externo real, porque o backend é falso
**Capability:** `default`
**Engineering Baseline:** `Radiant Engineering Baseline v0.1`
**Engineering Profile:** `none`
**Referência Radiant:** `6b129752b6687598e9bc3582c1c89c7ee6d71aee`

## 1. Objective

> **O núcleo do Demerzel existe em `src/core/`: recebe uma `Task` já
> resolvida, aplica as recusas do núcleo sem efeito, grava e reconcilia o
> registro sob lock, e executa `dispatch`, `resume`, `status`, `wait`,
> `collect` e `close` contra uma interface de backend, provado com um backend
> falso em memória e sem nada do Radiant.**

## 2. Why this task exists

**Source plan/spec:**

- [Plan 0.3](../PLAN.md), incremento 3.
- [Spec 0.5](../SPEC.md): seção 1; seção 2 inteira, com o backend da 2.5 só
  como interface; seção 4; seção 5, recusas do núcleo; seção 6; seção 7,
  verificações 1, 2 e 5 e a parte do núcleo das 3 e 4.

**Hypothesis or risk reduced:**

- O ciclo de vida, o registro e as recusas são a parte do Demerzel que não
  depende de herdr nem de Radiant. Prová-los com um backend falso separa os
  erros de estado dos erros de integração antes dos incrementos 4 e 5.
- A interface de backend precisa aguentar os dois modos de worktree da Spec
  0.4, seção 2.5, sem mudar o núcleo no incremento 4.

## 3. Inputs

- `docs/project/SPEC.md` (revisão 0.5) e `docs/project/PLAN.md` (revisão 0.3).
- `docs/project/FRAME.md`, para a regra de egress e as fronteiras.
- A stack do incremento 2: `package.json`, `tsconfig.json`, `bun.lock`,
  `src/cli.ts`, `test/cli.test.ts`, e os comandos do `AGENTS.md`.
- `docs/project/verification/2026-10-30-launch-probe.md` e
  `2026-10-31-claude-worktree-base-probe.md`, para a ordem dos efeitos em
  cada modo de worktree.
- Git 2.x no `PATH`. O núcleo pode chamar `git`; nenhum outro executável.

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
.radiant.json
```

### External systems allowed

- `git`, em repositórios temporários criados pelos testes.
- Nenhum herdr, harness, Radiant ou `python3`.

### Network

`DENIED`

### Execution units

Uma unidade só, sem bloco `radiant-units`: o Demerzel ainda não despacha
unidades, e dividir o núcleo não reduz risco.

## 5. Required outputs

1. `src/core/` com:
   - `Task` e `Request` da Spec 2.1 e 2.2, com validação e o montador do
     pedido;
   - a leitura da configuração da Spec 2.4 na parte do núcleo: `schema`,
     chaves conhecidas e padrões. `herdr` e `radiant` passam adiante sem
     validação de conteúdo;
   - o registro da Spec 2.3: raiz, chave do projeto, arquivos de tarefa,
     escrita atômica, lock, ciclo de vida, estado observado e reconciliação;
   - o nome de agente da Spec 2.5;
   - a interface de backend e o backend falso em memória;
   - os seis comandos como funções que devolvem código de saída e o envelope
     `--json` da Spec 4.
2. `test/core/` com as suítes das verificações 1, 2, 5 e a parte do núcleo
   das 3 e 4. Cada teste nomeia o comportamento que protege e a regressão que
   o faria falhar.
3. Um script em `package.json` que roda `test/core/` com um `PATH` sem
   `python3`, e que entra em `bun run check`.
4. O comando novo na lista do `AGENTS.md`.
5. `docs/project/verification/<data>-tc-0001-core.md` com o Completion
   report, a evidência da seção 11 e a crítica independente.

Não criar artefatos adicionais sem necessidade observada.

## 6. Non-goals

Esta tarefa **não** deve:

- implementar o backend herdr, chamar o herdr ou montar argumentos de
  harness (incremento 4);
- ler `.radiant.json`, contratos, `radiant-units`, regras de roteamento ou
  adapters, nem chamar `check_project.py` ou `check_dispatch.py`
  (incremento 5);
- implementar as recusas da integração, inclusive `approval-required`. O
  núcleo só registra `approval` e o uso de `--human-approved`;
- ligar os comandos ao `src/cli.ts`. O entrypoint continua só com
  `--version`; o incremento 4 liga `resume`, `status`, `wait`, `collect` e
  `close` com o backend real, e o 5 liga `dispatch`;
- adicionar dependência de runtime ou de desenvolvimento;
- implementar seguimentos para sessões lançadas ou interface de observação
  (Spec 8).

Encontrar uma melhoria fora deste escopo não autoriza implementá-la.
Registre-a como observação ou Learn Back candidate.

## 7. Functional requirements

Cada item aponta para a Spec, que continua sendo a fonte; o contrato não
repete o texto dela.

- [ ] `Task`, `Request`, labels, IDs e paths seguem a Spec 2.1 e 2.2; fora do
  formato é `task-invalid`. O texto final do pedido tem só o texto fixo, o
  ID, o papel, os pointers e o `returnPath`, e é gravado no registro.
- [ ] A configuração segue a Spec 2.4; `schema` diferente de `1` ou chave
  desconhecida é `config-invalid`; arquivo ausente usa os padrões.
- [ ] O registro segue a Spec 2.3: raiz por `XDG_STATE_HOME` ou
  `~/.local/state`, chave do projeto pelo `git rev-parse --git-common-dir`
  (um orquestrador num worktree vê o mesmo registro), um arquivo por tarefa
  gravado por temporário e rename, e o histórico de transições com horários.
- [ ] A decisão é gravada em `recorded` antes do primeiro efeito e nunca
  relida para decidir de novo.
- [ ] O lock segue a Spec 2.3, revisão 0.5: criação exclusiva, espera de até
  30 s, retomada registrada do lock de processo encerrado e `project-locked`
  sem efeito depois do tempo.
- [ ] O nome de agente segue a Spec 2.5: `dz-` mais 16 hex do sha256 de
  `<chave do projeto>:<id>`, gravado e nunca recalculado; nome já usado por
  agente vivo no snapshot é `agent-name-taken`.
- [ ] A interface de backend cobre sondar disponibilidade e versão, ler o
  snapshot, criar worktree e sessão, iniciar o agente, enviar o pedido, ler o
  estado e encerrar com ou sem descarte. Todo recurso criado chega ao núcleo
  quando é criado, para que `launch-failed` liste `created` nos dois modos da
  Spec 2.5: worktree antes da sessão (Codex) e worktree no início do agente
  (Claude Code).
- [ ] O backend falso cria worktrees Git reais nos repositórios temporários,
  para que `branch-exists`, `worktree-exists`, a ancestralidade de
  dependências e `collect` sejam provados contra o Git, e permite injetar
  cada desfecho: startup bloqueado, envio confirmado, `agent_prompt_stalled`,
  timeout, falha depois de cada efeito, pane ausente e estado `unknown`.
- [ ] As recusas do núcleo da Spec 5 (`dependency-pending`,
  `writes-overlap`, `backend-unavailable`, `backend-version`,
  `branch-exists`, `worktree-exists`, `config-invalid`, `task-invalid`,
  `task-exists`, `agent-name-taken`, `project-locked`) saem com `2`, sem
  arquivo de registro, branch, worktree ou chamada de efeito no backend.
- [ ] `dispatch`, `resume`, `status`, `wait`, `collect` e `close` seguem os
  códigos e as regras da Spec 4, inclusive `close` com `1` quando o descarte
  é recusado e `2` em `working`, e `wait` por ciclo próprio com intervalo e
  relógio injetáveis.
- [ ] Todo comando reconcilia o registro com o snapshot antes de agir; pane
  ausente vira `lost` e nunca é relançado sozinho.
- [ ] `request_sent` é `true`, `false` ou `unknown` conforme a Spec 2.5, e
  `unknown` nunca leva a reenvio automático.

## 8. Engineering Check

| Baseline | Status | Aplicação nesta tarefa | Evidência |
| --- | --- | --- | --- |
| EB-01 Complexidade deliberada | REQUIRED | Uma interface de backend, um registro, funções por comando; nada de framework de CLI, injeção genérica ou abstração para backends futuros além do falso | Revisão do diff |
| EB-02 Correção e contratos | REQUIRED | Escrita atômica, lock, transições válidas do ciclo de vida, decisão gravada antes do efeito | Testes da verificação 5 |
| EB-03 Verificação e testes | REQUIRED | Testes pelo percurso de cada comando, com Git real e backend falso | `bun run check` |
| EB-04 Segurança e privacidade | REQUIRED | Egress do pedido (Spec 6): só IDs, refs e paths; nenhum conteúdo de arquivo apontado entra no texto | Teste da verificação 4 com marcadores |
| EB-05 Manutenibilidade | REQUIRED | Fronteira `src/core/` sem Radiant; tipos estritos sem `any` nem `as` para calar o compilador | Teste da verificação 2 e `tsc` |
| EB-06 Dependências | REQUIRED | Nenhuma dependência nova | `bun.lock` sem diff |
| EB-07 Diagnóstico | REQUIRED | Toda recusa tem `code`, `message` e `next` da Spec 4, sem conteúdo de contrato | Asserções nas suítes de recusa |
| EB-08 Experiência e eficiência | APPLICABLE | `status` e `wait` não fazem trabalho proporcional ao histórico inteiro a cada ciclo | Revisão do diff |

## 9. Project-specific constraints

- Bun e TypeScript estrito da stack do incremento 2, sem afrouxar o
  `tsconfig.json`.
- `src/core/` não importa `src/radiant/` nem cita `.radiant`,
  `radiant-units` ou `check_project` (Spec 7, verificação 2).
- O núcleo nunca faz merge, push, PR ou remoção de branch, e nunca responde
  prompts (Spec 6).
- Testes usam `HOME`, `XDG_STATE_HOME` e `XDG_CONFIG_HOME` temporários e
  nunca tocam o registro ou a configuração reais do owner.

## 10. Dependency policy

### New runtime dependency allowed?

`NO`. Dependência de desenvolvimento nova também não. Se alguma parecer
necessária, é `HOLD`.

## 11. Verification plan

### Automated

```text
bun install --frozen-lockfile
bun run check
<script do output 3>      (test/core sem python3 no PATH)
git diff --exit-code bun.lock tsconfig.json src/cli.ts
```

### Focused verification

- Verificação 1: o fluxo `dispatch`, `resume`, `status`, `wait`, `collect`,
  `close` passa com o backend falso, configuração e estado temporários, sem
  checkout Radiant, sem `.radiant.json` e sem `python3` no `PATH`.
- Verificação 2: o teste de fronteira falha quando um arquivo de
  `src/core/` importa `src/radiant/` ou cita os termos proibidos; o Build
  mostra a falha com um arquivo de prova e depois o remove.
- Verificação 3, parte do núcleo: cada recusa da seção 7 com saída `2`,
  código no JSON e prova de nenhum efeito.
- Verificação 4, parte do núcleo: um arquivo apontado com marcadores únicos
  não aparece no pedido gravado nem no enviado ao backend falso.
- Verificação 5: transições; reconciliação para `lost`; `launch-failed` com
  `created` nos dois modos de worktree; `request_sent` em cada desfecho de
  envio; dois `dispatch` concorrentes, em processos separados, serializados
  pelo lock; retomada do lock de um processo encerrado; `project-locked`
  depois do tempo, com relógio injetável; nomes de agente distintos para IDs
  que só diferem em caixa ou pontuação; `wait` voltando com o retorno
  presente e o agente ainda `working`, e quando o estado passa a `unknown`.
- Mutação: para pelo menos três regras críticas (decisão antes do efeito,
  recusa sem efeito, escrita atômica), o Build quebra a regra de propósito,
  mostra o teste falhando e desfaz.

### Readback

- Reabrir um arquivo de tarefa gravado por um teste e conferir campos e
  histórico contra a Spec 2.3.
- Conferir que nenhum path fora da seção 4 mudou: `git diff --stat main`.

### Independent critique

`REQUIRED`: `radiant-verifier` em outro harness (Codex), lançado na sessão
herdr `lab`, lendo este contrato, a Spec e o diff. As objeções e o que foi
feito com cada uma entram no relatório de verificação. Releitura própria não
conta como crítica independente.

## 12. Acceptance criteria

A tarefa só pode ser declarada `DONE` quando:

- [ ] todos os requisitos da seção 7 têm teste, e cada teste nomeia o
  comportamento e a regressão;
- [ ] `bun run check` passa num clone limpo, com a suíte do núcleo sem
  `python3` no `PATH`;
- [ ] as mutações da seção 11 foram mostradas falhando;
- [ ] `bun.lock`, `tsconfig.json` e `src/cli.ts` não mudaram;
- [ ] a crítica independente foi feita e cada objeção foi aceita com
  correção ou recusada com motivo;
- [ ] todos os checks aplicáveis da seção 11 passam;
- [ ] não houve mudança fora do Allowed scope;
- [ ] limitações relevantes estão registradas;
- [ ] a evidência final foi lida, não apenas presumida pelo exit code.

Referentes: os critérios valem para o código de `src/core/` e `test/core/`.
Comportamento do herdr, dos harnesses e do Radiant fica fora; o backend falso
representa só o que a Spec 2.5 e as provas do incremento 1 registraram.

## 13. HOLD conditions

Interromper e pedir decisão quando:

- a Spec não decide um comportamento que muda o registro, o ciclo de vida ou
  um código de saída;
- a interface de backend não consegue representar um dos dois modos de
  worktree sem caso especial no núcleo;
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
- o registro pode ficar inconsistente depois de uma falha no meio de um
  comando;
- o egress do pedido não pode ser garantido.

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
do Radiant na referência acima.

## 17. Completion rule

> **Não declarar DONE porque o código parece correto. Declarar DONE apenas
> quando os critérios observáveis, a engenharia aplicável e a evidência de
> verificação convergirem.**
