# Radiant Task Contract - Demerzel - Incremento 5, integração Radiant

**Contract ID:** `TC-0003`
**Revisão do contrato:** 2, 2026-11-04. A revisão 1 recebeu a crítica do
Codex em `gpt-6-astra`, papel `radiant-grill`: oito objeções, todas aceitas
pelo owner e aplicadas aqui e na Spec 0.12, antes de qualquer execução
([crítica](../verification/2026-11-04-tc-0003-grill.md))
**Project:** `demerzel`
**Iteration:** Plan 0.4, incremento 5
**Status:** `READY`
**Lifecycle:** `ready`. Proposta pronta não autoriza execução; o owner ativa
apontando o `ACTIVE.md` para este contrato
**Owner:** Fael (humano); Build por um agente no papel `radiant-dev`;
orquestrador responsável pela crítica independente
**Risk tier:** `2`. O `dispatch` passa a lançar harnesses com modelos pagos a
partir de contratos reais, e o roteamento decide para qual provedor o
contrato vai (Spec 6). Os efeitos dos testes ficam em repositórios
temporários, com backend falso ou herdr falso, e o Radiant só é lido
**Capability:** `default`
**Engineering Baseline:** `Radiant Engineering Baseline v0.1`
**Engineering Profile:** `none`
**Referência Radiant:** `aea22d44868492da82adce25b4c371bfc234902c`, o pin do
`.radiant.json`
**Commit de entrada do Build:** o commit do `main` em que o `ACTIVE.md` passa
a apontar para este contrato, gravado no relatório antes da primeira edição

## 1. Objective

> **`demerzel dispatch <unit-id>` despacha uma unidade de um Task Contract
> Radiant: a integração em `src/radiant/` valida pin, base, contrato, unidade
> e roteamento pelo checkout Radiant da máquina, monta a tarefa e a entrega ao
> núcleo com o backend herdr. Antes disso, o `resume` passa a conferir o
> lançamento logo antes de enviar, como decide a Spec 0.10.**

## 2. Why this task exists

**Source plan/spec:**

- [Plan 0.4](../PLAN.md), incremento 5.
- [Spec 0.12](../SPEC.md): seção 2.5, conferir o lançamento; seção 2.4, a
  parte `radiant`; seção 3 inteira; seção 4, `dispatch` e `resume`; seção 5,
  as recusas da integração; seção 6; seção 7, verificações 2, 3, 4, 5 (a
  parte nova da revisão 0.10) e 6.
- [Relatório do TC-0002](../verification/2026-10-31-tc-0002-herdr.md),
  achado P1 do review do PR #16, em Remaining limitations.
- [TC-0002](TC-0002-herdr-backend.md), non-goals: o `dispatch` entra no CLI
  neste incremento.

**Hypothesis or risk reduced:**

- O ADR-0003 do Radiant põe no Demerzel só a ponte com o Radiant e deixa as
  regras de unidades e roteamento num corpo único, `check_dispatch.py`. Este
  incremento prova que a ponte funciona sem uma segunda implementação dessas
  regras, e que cada recusa da integração acontece antes de qualquer efeito.
- O achado P1 deixa o `resume` enviar o pedido a um worktree não conferido. A
  correção vem antes do `dispatch` no CLI, porque é o `dispatch` real que
  torna esse estado alcançável.

## 3. Inputs

- `docs/project/SPEC.md` (revisão 0.12) e `docs/project/PLAN.md` (0.4).
- O núcleo em `src/core/` e o backend herdr em `src/herdr/`, com a
  pós-condição do Claude Code hoje dentro de `launch` em
  `src/herdr/backend.ts`.
- O checkout Radiant em `radiant.root`, no pin acima, com
  `validators/check_project.py`, `validators/check_dispatch.py`,
  `adapters/<harness>/capabilities.json`, `adapters/<harness>/provides.json`
  e `skills/radiant-delegation/agents.json`.
- Conferido pelo orquestrador em 2026-11-04, ao preparar este contrato, no
  pin `aea22d4`, com `python3` do sistema:
  - `check_project.py <raiz>` deste repositório sai com `0` e imprime
    `PASS: Radiant aea22d4...; pin e paths conferidos.` no stdout; sem
    `.radiant.json`, sai com `1` e imprime uma linha `HOLD:` no stderr;
  - `check_dispatch.py routing` com o `routing.example.json` do Radiant em
    `$XDG_CONFIG_HOME/radiant/routing.json` sai com `0` e imprime o JSON das
    regras; com `default: [{"harness": "opencode"}]`, sai com `1` e imprime
    `{"errors": ["default: harness sem adapter 'opencode'"]}`;
  - `check_dispatch.py units -`, com um bloco `radiant-units` válido na
    entrada padrão, sai com `0` e imprime `{"units": [...]}` com `id`,
    `role`, `requires`, `objective`, `writes`, `depends_on` e `done_when`,
    sem completar `capability` ausente com o padrão do papel; com um papel
    desconhecido, sai com `1` e o erro repete o valor do campo, por exemplo
    `perfil desconhecido 'MARCADOR'`;
  - os adapters `claude-code` e `codex` existem; `capabilities.json` mapeia
    `deep`, `standard` e `light` para IDs completos; o `provides.json` do
    `claude-code` é `{"provides": []}`;
  - `agents.json` ordena as capacidades como `deep`, `standard`, `light` e
    dá a capacidade padrão de cada papel.
- O `faelplg/radiant` ficou público em 2026-11-04, por decisão do owner, e o
  commit do pin responde sem autenticação. O CI pode fazer checkout dele no
  pin sem credencial.

Não inferir inputs ausentes que mudariam materialmente a solução. Uma lacuna
da Spec é `HOLD`, não decisão do Build.

## 4. Allowed scope

### Paths allowed to change

```text
src/radiant/
test/radiant/
src/cli.ts
src/cli/
src/core/               (só as mudanças do output 1)
src/herdr/              (só as mudanças do output 1)
test/core/              (testes novos; ver a exceção do output 1)
test/herdr/             (testes novos; ver a exceção do output 1)
test/cli.test.ts        (inclusive os testes que afirmam o dispatch recusado)
package.json            (só a seção scripts)
AGENTS.md               (só a lista de comandos)
.github/workflows/check.yml  (só o checkout do Radiant no pin, do output 5)
docs/project/verification/
```

### Paths read-only

```text
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

- `git`, e `python3` só para executar os dois validators do checkout Radiant,
  sempre read-only.
- O checkout Radiant no pin, dado por `DEMERZEL_RADIANT_ROOT`, só lido pelos
  testes de `test/radiant/`. Testes e scripts nunca escrevem nele.
- No CI, o checkout público de `faelplg/radiant` no pin, sem credencial.
- Nenhum `herdr` real, `claude` ou `codex`: o `dispatch` é provado com o
  backend falso do núcleo e com o `herdr` falso de `test/herdr/`.

### Network

`DENIED` para o agente do Build. O CI baixa o `faelplg/radiant` público no
pin.

### Execution units

Uma unidade só, sem bloco `radiant-units`: o Demerzel ainda não despacha as
próprias unidades.

## 5. Required outputs

1. A correção do achado P1, pela Spec 0.10, feita primeiro e num commit
   próprio:
   - em `src/core/backend.ts`, uma operação de conferir o lançamento na
     interface `Backend`, com resultado que confere ou não confere com o
     motivo;
   - em `src/core/commands/resume.ts`, a ordem da Spec 4: recusas da matriz;
     agente `blocked` sai com `1` sem conferir; senão confere e só então
     grava `send_started_at` e envia;
   - em `src/herdr/backend.ts`, a pós-condição do Claude Code extraída de
     `launch` para essa operação, usada por `launch` e pelo `resume`; no
     Codex, a operação passa sem chamada ao herdr;
   - em `src/core/fake-backend.ts`, o desfecho da conferência controlável
     pelo teste, com as chamadas gravadas;
   - testes novos em `test/core/` e `test/herdr/`. Os testes existentes
     dessas duas pastas não mudam, salvo um que afirme a sequência exata de
     chamadas ao backend no `resume`; cada mudança dessas entra no relatório
     com o motivo. Em `test/cli.test.ts`, os testes que afirmam o `dispatch`
     recusado até o incremento 5 passam a afirmar o comando novo.
2. `src/radiant/` com a integração da Spec 3: projeto, gate de pin, base,
   contrato do commit base, unidades e regras por `check_dispatch.py`,
   roteamento, retorno, pedido, branch, dependências e `writes`, e as recusas
   da integração da Spec 5. Depende do núcleo; o núcleo não depende dela.
3. `src/cli.ts`, e `src/cli/` se preciso, com
   `dispatch <unit-id> [--rule <id>] [--base <ref>] [--human-approved] [--json]`
   pela Spec 4, sobre a integração, o núcleo e o backend herdr.
4. `test/radiant/`, dentro do `bun run check`, com consumidores de fixture em
   repositórios temporários contra o checkout Radiant real no pin, sem Radiant
   falso. O checkout vem de `DEMERZEL_RADIANT_ROOT`; sem a variável, ou com o
   `HEAD` do checkout diferente do pin, os testes falham com a instrução de
   como apontá-lo, nunca são pulados.
5. O Radiant no `check`:
   - em `.github/workflows/check.yml`, um passo que faz checkout de
     `faelplg/radiant` no `radiant_revision` do `.radiant.json`, num path
     ignorado pelo Git ou fora do checkout do Demerzel, e exporta
     `DEMERZEL_RADIANT_ROOT`; a action fixada por SHA, como as outras do
     workflow;
   - o `AGENTS.md` dizendo que `bun run check` precisa de
     `DEMERZEL_RADIANT_ROOT` e de `python3` 3.9 ou acima, e citando
     `dispatch` no entrypoint.
6. `docs/project/verification/<data>-tc-0003-radiant.md` com o commit de
   entrada, o Completion report, a evidência da seção 11 e a tabela de
   rastreabilidade. O orquestrador acrescenta a crítica independente e o
   link da execução do CI.

Não criar artefatos adicionais sem necessidade observada.

## 6. Non-goals

Esta tarefa **não** deve:

- reimplementar o leitor de YAML, as regras de unidades ou a validação de
  `routing.json`: tudo isso vem de `check_dispatch.py` (Spec 3, item 5);
- verificar a ativação do contrato pelo `ACTIVE.md` (Spec 3, item 4, e 8);
- mudar o núcleo ou o backend herdr além do output 1;
- mudar o `bun.lock`, o `tsconfig.json` ou o CI além do passo do output 5,
  nem dar credencial ao CI;
- lançar harness real, usar o herdr real ou a sessão `lab`;
- passar flags de permissão ou de bypass a harness, ou `--trust-repository`
  ao herdr;
- gravar no checkout Radiant ou na configuração real do owner;
- adicionar dependência de runtime ou de desenvolvimento.

Encontrar uma melhoria fora deste escopo não autoriza implementá-la.
Registre-a como observação ou Learn Back candidate.

## 7. Functional requirements

Cada item aponta para a Spec, que continua sendo a fonte.

Correção do achado P1 (output 1):

- [ ] P1. Conferir o lançamento é operação do backend (Spec 2.5). No Claude
  Code, ela lê o `foreground_cwd` do próprio agente por `herdr agent get`, o
  branch por `git rev-parse --verify refs/heads/<branch>` e o `HEAD` do
  worktree por `git -C <worktree> symbolic-ref HEAD` e `rev-parse HEAD`, e não
  confere quando o cwd não é o worktree, o branch falta ou não aponta para o
  commit base, ou o `HEAD` do worktree é outro branch, outro commit ou está
  destacado. No
  Codex, confere sem chamada. `launch` do Claude Code usa a mesma operação, e
  os testes atuais da pós-condição continuam passando.
- [ ] P2. `resume` segue a ordem da Spec 4: com o agente ainda `blocked`, sai
  com `1` sem conferir nem enviar; senão confere antes de gravar
  `send_started_at`.
- [ ] P3. Conferência que não confere no `resume` leva a tarefa de `launched`
  a `launch-failed`, com o motivo no histórico e `created` como estava, sai com
  `1` e não chama o envio.
- [ ] P4. Falha do backend durante a conferência no `resume` é
  `backend-unavailable`, sem gravar nada, nem a recuperação de outras tarefas.
- [ ] P5. Uma tarefa do Claude Code recuperada de `launching` com o agente
  vivo só recebe o pedido pelo `resume` se a conferência confere.

Integração Radiant (outputs 2 e 3):

- [ ] I1. Configuração `radiant` (Spec 2.4): `root` obrigatório para
  despachar, e a ausência é `radiant-root-missing`; `branch_prefix` opcional,
  padrão `radiant/`; chave desconhecida ou tipo errado é `config-invalid`.
- [ ] I2. Projeto e gate de pin (Spec 3, itens 1 e 2): a raiz é
  `git rev-parse --show-toplevel`; `python3 <root>/validators/check_project.py
  <raiz>` com saída `1` e linha `HOLD:` no stderr é `pin-mismatch`, com essa
  linha na mensagem. Qualquer outro desfecho fora de `0` com `PASS:` é
  `validator-failed` (I7).
- [ ] I3. Base (Spec 3, item 3): `--base <ref>`, ou o branch atual, ou o
  commit de HEAD destacado, resolvida para um commit uma vez só; o
  `.radiant.json` do commit base ausente, que não é objeto JSON, sem
  `radiant_revision` ou com outro valor é `pin-mismatch`. A tarefa entregue ao núcleo leva
  esse commit como `base`, e a ref pedida vai em `provenance` como
  `base_ref`, para que o núcleo lance exatamente o commit que a integração
  validou (Spec 0.11).
- [ ] I4. Contrato (Spec 3, item 4): o prefixo do ID localiza
  `TC-NNNN-*.md` no diretório `contracts` do `.radiant.json` do commit base,
  lido do commit base; nenhum ou mais de um é `contract-not-found`, e também
  `contracts` ausente, nulo ou fora de um path relativo dentro do
  repositório.
- [ ] I5. Unidades (Spec 3, item 5): o contrato do commit base vai à entrada
  padrão de `check_dispatch.py units -`; saída `1` é `units-invalid`, com só
  a contagem de erros e o comando que os mostra, nunca o texto dos erros,
  que repete valores do contrato; ID fora da lista é `unit-not-found`.
- [ ] I6. Regras (Spec 3, item 5): `check_dispatch.py routing`; saída `1` é
  `routing-invalid` com os erros, ou `harness-without-adapter` quando algum
  erro é de harness sem adapter; `--rule` inexistente é `routing-invalid`.
- [ ] I7. Validator fora do próprio protocolo, pela tabela da Spec 3, item
  2: outra saída, encerramento por sinal, `python3` ausente ou texto fora do
  formato, inclusive JSON inválido do `check_dispatch.py`, é
  `validator-failed`, com o validator e o resumo do erro, sem conteúdo do
  contrato. Os validators rodam com `PYTHONDONTWRITEBYTECODE=1`.
- [ ] I8. Roteamento (Spec 3, item 6): descarta candidato sem suporte no
  backend ou cujo `provides.json` não cobre os `requires`; o piso é a
  capacidade da unidade ou, sem ela, a padrão do papel em `agents.json`,
  resolvido antes dos candidatos; capacidade efetiva do candidato, senão o
  piso; candidato abaixo do piso não é viável, na ordem de `agents.json`; o
  primeiro viável vence, com o modelo do `capabilities.json` e o `effort` do
  candidato; sem viável, `no-viable-candidate`, com `hold: true` quando algum
  candidato só falhou por capacidade.
- [ ] I9. Aprovação: regra com `approval: human` sem `--human-approved` é
  `approval-required`; com a flag, o registro guarda que ela foi usada.
- [ ] I10. Retorno (Spec 3, item 7): `.radiant/reports/<id>.md`, conferido
  por `git check-ignore` no checkout chamador; não ignorado é
  `reports-not-ignored`.
- [ ] I11. Pedido, branch e proveniência (Spec 3, item 8, e 2.1): papel da
  unidade; pointers `radiant-root` absoluto, `radiant-revision` com o commit
  completo do pin e `contract` relativo ao worktree; branch
  `branch_prefix + id`; `provenance` com revisão e raiz do Radiant, path do
  contrato, ID da regra e `base_ref`.
- [ ] I12. `depends_on` e `writes` da unidade chegam ao núcleo como
  `dependsOn` e `writes` (Spec 3, item 9), e as recusas do núcleo valem como
  hoje.
- [ ] I13. Toda recusa da integração sai com `2` e não cria nem muda nada:
  nenhum arquivo de tarefa, branch, worktree ou chamada de efeito no backend.
  As recusas da integração rodam antes do `dispatch` do núcleo, sem o lock
  (Spec 0.11).
- [ ] I14. CLI `dispatch` (Spec 4): `0`, `1` e `2` como a Spec define, com
  `--json` no envelope do núcleo e texto curto com ID, ciclo de vida,
  `request_sent`, harness, modelo e regra. Argumento desconhecido ou faltando
  é recusa com `2` e diz o uso.
- [ ] I15. Fronteira: `src/core/` não importa `src/radiant/` nem cita
  `.radiant`, `radiant-units` ou `check_project` (verificação 2).

## 8. Engineering Check

| Baseline | Status | Aplicação nesta tarefa | Evidência |
| --- | --- | --- | --- |
| EB-01 Complexidade deliberada | REQUIRED | A integração só monta a tarefa e chama os validators; nenhuma regra de unidade ou de roteamento reimplementada além da aplicação da Spec 3, item 6 | Revisão do diff |
| EB-02 Correção e contratos | REQUIRED | Cada recusa antes de qualquer efeito; contrato e pin lidos do commit base; conferência antes do envio | Testes de recusa com prova de nenhum efeito |
| EB-03 Verificação e testes | REQUIRED | Radiant real no pin no `check`, local e no CI; backend falso e herdr falso para o P1 e para o `dispatch` | `bun run check` local e no CI |
| EB-04 Segurança e privacidade | REQUIRED | Nenhum conteúdo do contrato no pedido; validators só lidos; roteamento registrado antes do efeito | Teste dos marcadores (verificação 4) |
| EB-05 Manutenibilidade | REQUIRED | `src/radiant/` depende do núcleo; o núcleo não depende dela | Teste de fronteira |
| EB-06 Dependências | REQUIRED | Nenhuma dependência nova; o YAML fica no Radiant | `bun.lock` sem diff |
| EB-07 Diagnóstico | REQUIRED | Erros dos validators e linha `HOLD:` do gate chegam à mensagem, com o próximo passo | Asserções no envelope `--json` e no texto |
| EB-08 Experiência e eficiência | APPLICABLE | Um `dispatch` executa no máximo uma vez o gate, uma vez `units` e uma vez `routing`, parando na primeira recusa | Contagem de execuções por um `python3` intermediário no `PATH` do teste, que repassa ao real |

## 9. Project-specific constraints

- Bun e TypeScript estrito, sem afrouxar o `tsconfig.json`.
- Os validators são executados com argumentos em lista, nunca por shell,
  com `PYTHONDONTWRITEBYTECODE=1`, e o contrato chega pela entrada padrão.
- Todo processo em teste roda com `HOME`, `XDG_STATE_HOME` e
  `XDG_CONFIG_HOME` em pastas próprias do teste; a configuração e o
  `routing.json` reais do owner nunca são lidos nem gravados.
- Git isolado nos testes, como no TC-0001: `GIT_CONFIG_GLOBAL` vazio,
  `GIT_CONFIG_NOSYSTEM=1`, identidade fixa.
- `bun run test:core` continua sem `python3` no `PATH`: os testes de
  `test/radiant/` ficam fora dele.
- Os testes de `test/radiant/` recebem o checkout Radiant por
  `DEMERZEL_RADIANT_ROOT` e falham se o `HEAD` dele não é o pin. O consumidor
  de fixture usa esse mesmo pin no próprio `.radiant.json`, para o gate de
  pin passar, e um `config.json` de teste com `radiant.root` igual a
  `DEMERZEL_RADIANT_ROOT`. Cada caso escreve o próprio `routing.json` no
  `XDG_CONFIG_HOME` do teste; o checkout Radiant não é copiado nem alterado.
- A aplicação do roteamento da Spec 3, item 6, é uma função pura sobre as
  regras, os adapters e os papéis já lidos. No pin, os dois adapters têm
  `provides: []`, então o caso em que um candidato cobre `requires` e vence
  só é provado nessa função, com dados em memória; contra o Radiant real fica
  o descarte por `provides` que termina em `no-viable-candidate`.

## 10. Dependency policy

### New runtime dependency allowed?

`NO`. Dependência de desenvolvimento nova também não. Se alguma parecer
necessária, é `HOLD`.

## 11. Verification plan

### Automated

```text
bun install --frozen-lockfile
DEMERZEL_RADIANT_ROOT=<checkout no pin> bun run check
bun run test:core            (continua sem python3 e sem Radiant)
git diff --exit-code <commit de entrada> -- bun.lock tsconfig.json .gitignore
git diff <commit de entrada> -- .github     (só o passo do output 5)
git status --porcelain       (vazio depois do commit final)
```

### Correção do achado P1, no `bun run check`

Com o backend falso, para uma tarefa do Claude Code recuperada de
`launching` com o agente vivo e para uma vinda de startup bloqueado:
conferência que confere envia uma vez; conferência que não confere vai a
`launch-failed` sem chamada de envio; falha do backend na conferência é
`backend-unavailable` sem nenhuma gravação; agente ainda `blocked` sai com `1`
sem chamada de conferência. Com o herdr falso: a conferência do `resume`
acusa cwd fora do worktree, branch ausente, branch fora do commit base e o
`HEAD` do worktree trocado para outro branch ou destacado com a ref original
intacta, e não faz chamada no Codex.

### Integração, no `bun run check`

Consumidor de fixture num repositório temporário, contra o Radiant real no
pin (verificação 6):

- cada recusa de I1 a I13 com saída `2`, o código esperado e prova de nenhum
  efeito: backend falso sem chamada de efeito, nenhum arquivo de tarefa,
  nenhum branch;
- base com pin diferente do validado, `.radiant.json` da base que não é
  JSON e `contracts` nulo, contrato só no working tree e contrato diferente
  entre working tree e commit base, lido do commit base;
- roteamento contra o Radiant real: descarte por `provides` sem viável,
  `hold: true` por capacidade, capacidade do candidato acima da unidade, o
  primeiro viável vencendo, o modelo vindo do `capabilities.json` e uma
  unidade sem `capability` de um papel `deep` recusando candidato `light`;
  descarte
  por backend com o backend falso declarando só um harness;
- a função pura do roteamento com dados em memória, inclusive o candidato que
  cobre `requires` e vence depois de um descartado;
- verificação 4: um contrato de fixture com marcadores únicos, e nenhum
  deles no pedido gravado ou enviado, nem no stdout, stderr ou envelope de
  uma recusa, inclusive `units-invalid` com um marcador no papel;
- `validator-failed` para cada desfecho fora do protocolo, com um `python3`
  intermediário no `PATH` do teste: saída `2` em cada validator, sinal, JSON
  inválido do `check_dispatch.py`, gate saindo com `1` sem `HOLD:` e
  `python3` ausente do `PATH`;
- nenhum arquivo novo no checkout Radiant, contando os ignorados, por
  `git status --porcelain --ignored` antes e depois da suíte;
- uma base que muda de commit depois da validação, com o núcleo lançando o
  commit validado e a ref em `base_ref`;
- o fluxo `dispatch`, `status`, `wait`, `collect` e `close` pelo CLI com o
  herdr falso, a partir de uma unidade de fixture.

### No CI

O mesmo `bun run check`, nos dois sistemas da matriz, com o Radiant no pin
pelo passo do output 5. O relatório traz o link da execução verde no PR do
Build.

### Mutação

O Build quebra cada regra abaixo de propósito, mostra o teste falhando e
desfaz, com o commit antes da quebra e o resultado tirado do código de saída:

- o `resume` sem conferir o lançamento;
- a conferência sem olhar o `HEAD` do worktree;
- o piso de capacidade sem o padrão do papel;
- os erros de `units` copiados para a mensagem;
- o contrato lido do working tree em vez do commit base;
- a comparação do pin no commit base removida;
- um candidato abaixo da capacidade da unidade aceito;
- `approval: human` ignorado.

### Readback

- Reabrir uma tarefa gravada por `dispatch` e conferir harness, modelo,
  esforço, branch, base, pointers e `provenance` contra a Spec 3.
- `git diff --stat <commit de entrada>` e `git status --porcelain`: nenhuma
  mudança fora da seção 4.

### Independent critique

`REQUIRED`, feita pelo orquestrador fora do Build, depois do Completion
report e do CI verde no PR do Build: um `radiant-verifier` num harness
diferente do que fez o Build, escolhido pelo owner, lendo este contrato, a Spec, o diff
contra o commit de entrada e o relatório. Pré-requisito: o harness do
verificador autenticado e com o repositório confiado. As objeções e o que foi
feito com cada uma entram no relatório. Releitura própria não conta.

## 12. Acceptance criteria

A tarefa só pode ser declarada `DONE` quando:

- [ ] cada requisito P1 a P5 e I1 a I15 tem teste ou evidência, ligado na
  tabela de rastreabilidade;
- [ ] `bun run check` passa num clone limpo, e `bun run test:core` continua
  sem `python3`;
- [ ] o `check` do CI passou nos dois sistemas da matriz, com o Radiant no
  pin, e não só na máquina do Build;
- [ ] as mutações da seção 11 foram mostradas falhando;
- [ ] o checkout Radiant terminou a suíte sem arquivo novo, contando os
  ignorados;
- [ ] contra o commit de entrada, `src/core/` e `src/herdr/` só têm as
  mudanças do output 1, os testes existentes de `test/core/` e
  `test/herdr/` só mudaram pela exceção do output 1, `.github/` só tem o passo do output 5, e `bun.lock`,
  `tsconfig.json` e `.gitignore` não mudaram;
- [ ] a crítica independente foi feita pelo orquestrador e cada objeção foi
  aceita com correção ou recusada com motivo;
- [ ] não houve mudança fora do Allowed scope, contra o commit de entrada;
- [ ] a evidência final foi lida, não apenas presumida pelo exit code.

Referentes: os critérios valem para `src/radiant/`, o `dispatch` do CLI, as
mudanças do output 1 e seus testes. O conteúdo dos validators, adapters e
regras é do Radiant; aqui só se prova que o Demerzel os consome como a Spec
manda.

## 13. HOLD conditions

Interromper e pedir decisão quando:

- a Spec não decide um comportamento que muda o registro, o ciclo de vida, um
  código de saída, um código de recusa ou o pedido;
- um validator no pin se comporta diferente do registrado na seção 3;
- o núcleo ou o backend herdr precisariam de mudança fora do output 1;
- um teste precisaria ler ou gravar a configuração real do owner ou o
  checkout Radiant;
- uma dependência nova parecer necessária;
- a solução mínima deixou de caber neste contrato.

`HOLD` é resultado válido.

## 14. FAIL conditions

Marcar `FAIL` quando:

- os critérios da seção 12 não podem ser satisfeitos;
- a verificação mostra regressão no núcleo, no backend herdr ou no CLI;
- uma recusa da integração deixa efeito;
- o pedido gravado ou enviado leva conteúdo do contrato;
- o `resume` envia a um worktree que não conferiu.

Não mascarar `FAIL` como `DONE WITH NOTES`.

## 15. Change budget

O agente pode:

- organizar `src/radiant/`, `src/cli/` e `test/radiant/` como o trabalho
  pedir;
- escrever fixtures, o `python3` intermediário e helpers de teste dentro de
  `test/radiant/`;
- atualizar os scripts do `package.json` e a lista de comandos do
  `AGENTS.md`.

O agente não pode, sem HOLD:

- mudar o núcleo ou o backend herdr além do output 1, a Spec, o Plan ou este
  contrato;
- mudar a stack, o `tsconfig.json` ou o CI além do passo do output 5;
- adicionar features não pedidas, como verificar a ativação do contrato.

## 16. Completion report

Gravado no relatório de verificação do output 6, com Status (`DONE`, `HOLD`
ou `FAIL`), Changed, Verification evidence, Engineering notes, Remaining
limitations e Learn Back candidate, no formato do template de Task Contract
do Radiant na referência acima. O Build entrega com o status que a evidência
dele sustenta; o `DONE` do contrato espera o CI verde e a crítica
independente.

Limitações já conhecidas, a registrar no relatório:

- o `git check-ignore` roda no checkout chamador, como a Spec 3 diz; um
  `.gitignore` do working tree diferente do commit base não é detectado;
- o `dispatch` e o `resume` com harness real não rodam neste contrato; o
  caminho real é exercitado pelo incremento 6;
- no pin, nenhum adapter declara `provides`, então um candidato que cobre
  `requires` só é provado na função pura do roteamento.

## 17. Completion rule

> **Não declarar DONE porque o código parece correto. Declarar DONE apenas
> quando os critérios observáveis, a engenharia aplicável e a evidência de
> verificação convergirem.**
