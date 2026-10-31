# Spec: Demerzel

Revisão da Spec: 0.8, 2026-10-31
Frame: [revisão 0.3](FRAME.md)
Referência Radiant: 6b129752b6687598e9bc3582c1c89c7ee6d71aee

Esta Spec define o comportamento observável do primeiro incremento: o núcleo
de despacho, a integração Radiant e os comandos `dispatch`, `resume`,
`status`, `wait`, `collect` e `close`. Intenção, hipótese e fronteiras estão
no Frame. As decisões de origem são o ADR-0002 e o ADR-0003 do Radiant
(`docs/adrs/` no checkout indicado pelo pin). As decisões que o Frame deixou
em aberto e as que as fontes não tomavam foram aprovadas pelo owner em
2026-10-17 e estão registradas na seção 9. A revisão 0.4 aplica as provas do
incremento 1 do Plan, em `docs/project/verification/`: cada harness tem seu
modo de criar o worktree, e a confiança passa a ser pré-requisito do owner.

## 1. Conceitos

| Termo | Significado |
| --- | --- |
| Tarefa | O que o núcleo despacha: harness, modelo, esforço, paths e pedido já resolvidos. Não conhece Radiant. |
| Unidade | Item do bloco `radiant-units` de um Task Contract. A integração a transforma em tarefa. |
| Projeto | Repositório Git de onde o orquestrador chama o Demerzel, identificado pelo checkout principal. |
| Registro | Estado do Demerzel por projeto, em `$XDG_STATE_HOME/demerzel/`. |
| Backend | Superfície própria do Demerzel para criar worktree, abrir sessão, iniciar agente, enviar pedido, ler estado e encerrar. O herdr é a primeira implementação. |
| Retorno | Arquivo que a sessão despachada grava num path fixo do worktree. Para unidades Radiant, o Completion report. |

## 2. Núcleo

O núcleo vive em `src/core/` e não importa nada da integração. Ele não lê
`.radiant.json`, contratos, regras de roteamento nem adapters, e não executa
nada do checkout Radiant.

### 2.1 Modelo de tarefa

```ts
type Task = {
  id: string;            // ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$, nunca reutilizado no projeto
  harness: string;       // chave do backend: "claude-code" | "codex"
  model: string;         // ID completo, nunca alias
  effort?: string;       // registrado; omitido do lançamento se o harness não aceitar
  branch: string;        // nome completo, já com prefixo; validado por git check-ref-format
  base?: string;         // ref; ausente usa o branch atual do checkout chamador
  writes: string[];      // paths relativos normalizados, ver abaixo
  dependsOn: string[];   // IDs de tarefas do mesmo projeto
  request: Request;      // ver 2.2
  returnPath: string;    // path relativo dentro do worktree
  approval?: "human";    // exige --human-approved na chamada
  provenance: Record<string, string>; // gravado e devolvido, sem interpretação
};
```

A integração preenche `provenance` com revisão e raiz do Radiant, path do
contrato e ID da regra. O núcleo só grava e devolve esses campos.

`writes`: cada path é relativo à raiz do projeto, separado por `/`, sem `/`
inicial, sem segmento vazio, `.` ou `..`; uma `/` final só marca diretório e
não muda a comparação. Fora disso é `task-invalid`. Dois paths se sobrepõem
quando os segmentos de um são prefixo dos segmentos do outro, iguais
inclusive: `src/` sobrepõe `src/a.ts` e `src`, mas não `src-old/`. A
comparação é byte a byte, com diferença de caixa, e não resolve symlinks:
`writes` declara intenção, e um alias por symlink ou por caixa não é
detectado. Lista vazia não sobrepõe nada.

O ID nunca é reutilizado: qualquer ID já registrado, inclusive `closed`, é
`task-exists`. Repetir uma unidade que falhou é uma unidade nova, com outro
ID, porque o branch da tentativa anterior continua existindo.

### 2.2 Pedido

O montador do pedido fica no núcleo e garante a regra de egress do Frame: o
pedido leva só identificadores, refs e paths, dentro de um texto fixo do
Demerzel.

```ts
type Request = {
  role: string;                          // ^[a-z][a-z0-9-]{0,63}$
  pointers: Array<
    | { label: string; path: string }    // absoluto e existente, ou relativo e presente no commit base
    | { label: string; ref: string }     // commit completo, 40 ou 64 hex
  >;
};
```

Labels seguem `^[a-z][a-z0-9-]{0,31}$`. Um path com quebra de linha, um path
inexistente ou uma ref fora do formato é recusa. O texto final é o texto fixo,
o ID da tarefa, o papel, os pointers e o `returnPath`, e é gravado no registro.

### 2.3 Registro

- Raiz: `$XDG_STATE_HOME/demerzel/`, ou `~/.local/state/demerzel/` sem a
  variável.
- Projeto: `projects/<nome-do-repo>-<12 hex do sha256 do path real do
  checkout principal>/`. O checkout principal vem de
  `git rev-parse --git-common-dir`, para que um orquestrador num worktree veja
  o mesmo registro.
- Dentro do projeto: `tasks/<id>.json`, um arquivo por tarefa, gravado por
  arquivo temporário e rename; `worktrees/<id>/`, os worktrees criados; e
  `lock`.
- O lock serializa todo comando que grava no registro: `dispatch`, `resume`,
  `collect` e `close`. `status` e `wait` só leem e não o pegam; como cada
  arquivo de tarefa é trocado por rename, eles nunca leem um arquivo pela
  metade.
- O lock é um `flock(LOCK_EX)` do sistema operacional no arquivo `lock`,
  pedido sem bloquear e repetido em intervalo curto por até 30 s. O kernel
  solta o lock quando o processo termina, de qualquer jeito, então não existe
  lock abandonado nem retomada. O Bun chega ao `flock` da libc por
  `bun:ffi`, sem dependência. Esgotado o tempo, a recusa é `project-locked`.
  O comando grava no arquivo o próprio pid e horário só para diagnóstico; a
  exclusão não depende desse conteúdo.
- Quem tem o lock só solta depois de gravar o último estado do comando.
  Um `dispatch` segura o lock de `recorded` até `launched` ou
  `launch-failed`, inclusive durante o envio.
- Cada tarefa registra: a tarefa recebida, o pedido final, harness, modelo,
  esforço aplicado ou omitido, base (ref e commit), branch, path do worktree,
  IDs no backend (workspace, aba, pane, nome do agente), `provenance`, ciclo de
  vida, recursos criados e o histórico de transições com horários.
- A decisão de roteamento é gravada antes do primeiro efeito e nunca é relida
  para decidir de novo.
- Ordem das gravações no `dispatch`: `recorded` com a decisão; `launching`
  antes do primeiro efeito; cada recurso entra em `created` logo depois de
  criado; `send_started_at` antes do envio; `launched` com o desfecho do
  envio. Cada gravação termina antes do passo seguinte começar.
- Projeto ausente: um comando chamado fora de um repositório Git não tem
  projeto nem registro, e a recusa é `not-a-project`.
- Recuperação: `dispatch`, `resume` e `close`, os comandos que pegam o lock e
  falam com o backend, ao encontrar tarefa em `recorded` ou `launching` sabem
  que o `dispatch` dela foi interrompido, porque o dono daquele `dispatch`
  teria o lock. Antes de agir, gravam a recuperação e o motivo `interrupted`
  no histórico. `collect` não recupera e só grava a própria tarefa:
  - `recorded`: `launch-failed` com `created` vazio, porque nenhum efeito
    começou;
  - `launching`: confere no Git e no snapshot o branch, o worktree, o
    workspace pelo ID gravado ou, sem ele, pelo label, com a aba e o pane
    dele, e o agente pelo nome, e grava em `created` o que existe. Com o agente vivo, a tarefa vai para `launched`, com
    `request_sent: unknown` se `send_started_at` foi gravado e `false` se não;
    sem agente, para `launch-failed`;
  - nada é relançado nem reenviado sozinho.

Ciclo de vida gravado:

| Estado | Significado |
| --- | --- |
| `recorded` | Decisão gravada, nenhum efeito ainda |
| `launching` | Primeiro efeito iniciado |
| `launch-failed` | Falha depois do primeiro efeito; `created` lista o que existe |
| `launched` | Agente iniciado; `request_sent` é `true`, `false` ou `unknown` |
| `collected` | Retorno lido por `collect`, com digest |
| `closed` | Encerrado por `close` |

Estado observado, calculado a cada comando para tarefas `launched` ou
`collected`, sem gravar julgamento. São dois campos independentes, porque o
agente pode gravar o retorno e continuar trabalhando:

| Campo | Valores | Origem |
| --- | --- | --- |
| `agent` | `working` | herdr `working` |
| | `blocked` | herdr `blocked`: prompt de permissão, confiança ou pergunta |
| | `idle` | herdr `idle` ou `done` |
| | `unknown` | herdr `unknown` |
| | `lost` | pane ausente no snapshot; nunca relançado sozinho |
| `report` | `present`, `absent` | arquivo de retorno no worktree |

Todo comando que fala com o backend reconcilia o registro com
`herdr api snapshot` antes de agir. `collect` não fala com o backend: lê só o
arquivo e devolve `agent: null`.

### 2.4 Configuração

Um arquivo do usuário, gerado pelo dotfiles como o `routing.json` do Radiant:
`$XDG_CONFIG_HOME/demerzel/config.json`, ou `~/.config/demerzel/config.json`
sem a variável. JSON, porque o Bun lê sem dependência e porque é o formato do
`routing.json`.

```json
{
  "schema": 1,
  "herdr": { "session": "lab" },
  "radiant": {
    "root": "/Users/fael/workspaces/github/faelplg/radiant",
    "branch_prefix": "radiant/"
  }
}
```

- `schema`: exatamente `1`. Chave desconhecida é recusa.
- `herdr`: lido só pelo backend herdr. `session` é opcional e segue
  `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; presente, toda chamada ao herdr leva
  `--session <nome>`, inclusive a leitura de versão; ausente, o herdr usa a
  sessão padrão. O herdr 0.9.0 só escolhe a sessão por essa flag, sem
  variável de ambiente.
- `radiant`: lido só pela integração. `root` é obrigatório para despachar
  unidades e não tem padrão. `branch_prefix` é opcional, padrão `radiant/`.
- Arquivo ausente: o núcleo usa os padrões e a integração recusa por falta de
  `radiant.root`.

### 2.5 Backend herdr

Versão mínima: 0.9.0, a única conferida (ADR-0002). Versões acima são
aceitas; o cenário local da seção 7 registra a versão conferida. O Demerzel lê
`herdr status --json`, na sessão da configuração, e exige `server.running`, `server.compatible` e
`server.version` igual ou acima da mínima.

| Operação | herdr 0.9.0 |
| --- | --- |
| Criar worktree e sessão, Codex | `herdr worktree create --cwd <projeto> --branch <branch> --base <commit> --path <path> --label <label> --no-focus`. Devolve `workspace`, `tab`, `root_pane` e `worktree`. |
| Criar sessão, Claude Code | `herdr workspace create --cwd <projeto> --label <label> --no-focus`. Devolve `workspace`, `tab` e `root_pane`. O worktree nasce no passo seguinte. |
| Iniciar agente | `herdr agent start <nome> --kind <kind> --pane <root_pane> -- <args>`. No Codex, `<args>` são modelo e esforço. No Claude Code, vêm antes `--worktree <nome> --settings <hook>`, descritos abaixo. |
| Enviar pedido | `herdr agent prompt <nome> <texto> --wait --until working --until blocked --timeout <ms>`. Sem `--until`, o `--wait` só volta em `idle`, `done` ou `blocked`, isto é, no fim do turno, e o `dispatch` seguraria o lock do projeto durante todo o trabalho. |
| Ler estado | `herdr api snapshot` e `herdr agent get <nome>` |
| Esperar | Ciclo próprio: a cada intervalo curto, lê `herdr api snapshot` e confere o arquivo de retorno, até cada tarefa chegar a um estado de parada ou o timeout expirar. `herdr agent wait` não serve sozinho: não vê o arquivo de retorno e, sem `--until`, só volta em `idle`, `done` ou `blocked`. |
| Encerrar | `herdr workspace close <workspace>`; com descarte, depois `git -C <projeto> worktree remove <path>`, sem `--force` |

- No herdr 0.9.0, `worktree create` e `workspace create` abrem um workspace
  próprio com uma aba e um pane. A "aba própria" da unidade é essa aba.
- O label do workspace é o ID da tarefa, um espaço e o nome do agente, por
  exemplo `TC-0025.1 dz-6de747e982262631`. O ID é o que o humano lê na aba;
  o nome do agente torna o label único entre projetos que compartilham o
  herdr, para que a recuperação nunca tome a aba de outro projeto.
- O path do worktree é `<registro do projeto>/worktrees/<id>`, decidido antes
  do primeiro efeito para que a recusa de path existente seja verificável.
  Path, branch e base são os mesmos nos dois harnesses; muda só quem cria o
  worktree.
- Por que dois modos: o Claude Code 2.1.286 confia por path exato e pararia
  no diálogo de confiança em cada worktree novo criado pelo herdr; o Codex
  0.166.0 confia pela raiz do repositório e cobre os worktrees dela. Sem
  hook, o `claude --worktree` escolhe sozinho path, branch e base
  (`origin/HEAD` ou o `HEAD` local), o que não serve à integração Radiant.
- Worktree do Claude Code: o agente é iniciado na raiz do projeto com
  `--worktree <nome do agente>` e `--settings <json>`. O JSON tem só um hook
  `WorktreeCreate` de comando, que roda
  `git -C <projeto> worktree add -b <branch> <path> <commit base>` com a
  saída do Git no stderr e imprime só `<path>` no stdout. O Demerzel monta o
  comando com cada argumento entre aspas simples, no escape de POSIX `sh`, e
  grava o JSON no registro antes do primeiro efeito.
- Pós-condição do lançamento no Claude Code: depois de `agent start`, o
  `foreground_cwd` do agente é o path do worktree, e o branch existe e aponta
  para o commit base. Se não, a tarefa vai para `launch-failed`, com
  `created` listando o que existe. Assim um hook `WorktreeCreate` ou um
  `disableAllHooks` do próprio projeto, que se combinam com o `--settings` de
  modos que o Demerzel não conferiu, não passam despercebidos.
- Confiança: o backend nunca passa `--trust-repository`, que no herdr 0.9.0
  não mudou a decisão de nenhum dos dois CLIs. O owner confia uma vez o
  checkout principal do projeto em cada CLI, como na autenticação inicial.
  Num projeto não confiado, o Codex para no diálogo e a tarefa fica
  `blocked`; o Claude Code com `--worktree` interativo, pela documentação,
  sai com erro, e a tarefa vai para `launch-failed`.
- O herdr exige nome de agente em `[a-z][a-z0-9_-]{0,31}`, único entre os
  agentes vivos. O nome é `dz-` mais os 16 primeiros hex do sha256 da chave do
  projeto seguida de `:` e do ID da tarefa: tem 19 caracteres, começa por
  letra e não colide entre IDs que só diferem em caixa ou pontuação. Antes do
  primeiro efeito, o núcleo confere no snapshot que nenhum agente vivo usa o
  nome; se usa, a recusa é `agent-name-taken`. O nome é gravado no registro e
  nunca recalculado.
- Tabela de lançamento, só para os dois harnesses com adapter Radiant:

  | Harness | `--kind` | Modelo | Esforço |
  | --- | --- | --- | --- |
  | `claude-code` | `claude` | `--model <id>` | `--effort <nível>` |
  | `codex` | `codex` | `--model <id>` | `-c model_reasoning_effort=<nível>` |

  Os níveis aceitos por cada CLI são conferidos no Plan pelo `--help` das
  versões instaladas. O backend nunca passa flags de permissão ou de bypass; o
  harness lançado usa a configuração do próprio usuário.
- Startup bloqueado (`agent_not_ready`) deixa a tarefa `launched`, com
  `request_sent: false`, observada como `blocked`. O pedido sai depois por
  `resume`.
- `agent_prompt_stalled` ou timeout no envio deixam `request_sent: unknown`. O
  Demerzel não reenvia sozinho, porque o pedido pode ter chegado.

## 3. Integração Radiant

Vive em `src/radiant/`, depende do núcleo e é a única entrada do primeiro
incremento.

1. **Projeto.** Raiz do checkout chamador (`git rev-parse --show-toplevel`),
   que precisa ter `.radiant.json`.
2. **Gate de pin.** Executa
   `python3 <radiant.root>/validators/check_project.py <raiz>`. Saída
   diferente de 0 é recusa, com a linha `HOLD:` do validator na mensagem. O
   gate compara o pin com o único checkout Radiant da máquina, então o
   consumidor precisa estar no mesmo pin desse checkout.
3. **Base.** `--base <ref>`, ou o branch atual do checkout chamador; em HEAD
   destacado, o commit de HEAD. A base é resolvida para um commit e os dois são
   gravados. O `.radiant.json` lido do commit base precisa ter o mesmo
   `radiant_revision` que o gate validou no checkout chamador; se diverge, ou
   se falta, a recusa é `pin-mismatch`. Assim o gate vale para a árvore que
   será despachada, não só para o working tree de quem chama.
4. **Contrato.** O prefixo do ID (`TC-0025` em `TC-0025.1`) localiza o arquivo
   `TC-0025-*.md` no diretório `contracts` do `.radiant.json` do commit base;
   precisa haver exatamente um. O contrato é lido do commit base, não do working tree, para
   que a sessão despachada veja o mesmo texto que foi validado. A ativação
   (`ACTIVE.md`) não é verificada: é texto livre, e ativar contrato é decisão do
   orquestrador.
5. **Unidades e regras.** O Radiant mantém o único corpo dessas regras, e o
   Demerzel não as reimplementa nem lê YAML. A integração chama
   `python3 <radiant.root>/validators/check_dispatch.py`, read-only:
   - `units -`, com o contrato do commit base na entrada padrão, devolve
     `{"units": [...]}` já lido pelo leitor restrito do Radiant;
   - `routing`, sem path, valida `$XDG_CONFIG_HOME/radiant/routing.json` (ou
     `~/.config/radiant/routing.json`) e devolve as regras;
   - saída `0` traz o valor em JSON; saída `1` traz `{"errors": [...]}`, que
     vira `units-invalid` ou `routing-invalid` com os erros na mensagem, salvo
     quando algum erro de `routing` é de candidato sem adapter
     (`harness sem adapter`): aí a recusa é `harness-without-adapter`, com os
     demais erros na mensagem; saída `2` é erro de uso e vira falha interna,
     nunca efeito.
6. **Roteamento.** Aplica às regras validadas a regra pedida por
   `--rule <id>`, ou `default` sem a flag:
   - descarta candidatos sem suporte no backend ou cujo `provides.json` não
     cobre os `requires` da unidade. Candidato sem adapter Radiant já é erro
     de `check_dispatch.py`, que só aceita como adapter o diretório com
     `README.md`, `capabilities.json` e `provides.json`;
   - capacidade efetiva: a do candidato quando presente, senão a da unidade,
     senão a padrão do papel em `agents.json`; candidato abaixo da capacidade
     da unidade não é viável;
   - o primeiro viável vence; o modelo vem de
     `adapters/<harness>/capabilities.json`;
   - sem viável, recusa; se algum candidato só falhou por capacidade, a recusa
     traz `hold: true`, sem rebaixamento.
7. **Retorno.** `returnPath` é `.radiant/reports/<id>.md`, que precisa ser
   ignorado pelo Git no projeto (`git check-ignore`).
8. **Pedido e branch.** Papel da unidade e pointers `radiant-root` (absoluto),
   `radiant-revision` (ref) e `contract` (relativo ao worktree). O ID da
   unidade vai no texto fixo como ID da tarefa. O branch é
   `branch_prefix + id`.
9. **Dependências e sobreposição.** `depends_on` e `writes` da unidade passam
   ao núcleo como `dependsOn` e `writes`.

## 4. CLI

Não interativo. Toda saída de máquina sai com `--json`; sem a flag, o mesmo
conteúdo em texto curto. Códigos: `0` ok, `1` achados ou estado pendente, `2`
recusa sem efeito.

Envelope `--json`:

```json
{
  "ok": true,
  "command": "status",
  "tasks": [{ "id": "TC-0025.1", "lifecycle": "launched", "agent": "working", "report": "absent" }],
  "refusal": null
}
```

Cada tarefa traz também branch, base, worktree, IDs no herdr, harness, modelo,
esforço, `request_sent` e horários. Numa recusa, `"ok": false` e
`"refusal": { "code": "<código>", "message": "<o que houve>", "next": "<o que fazer>", "hold": false }`.

Matriz dos comandos que recebem ID. Toda linha também recusa ID sem tarefa
com `task-not-found`, e os comandos que falam com o backend recusam herdr
parado com `backend-unavailable`.

| Comando | Aceita | Recusa, sem efeito |
| --- | --- | --- |
| `resume` | `launched` com `request_sent: false` | outro ciclo de vida: `wrong-lifecycle`; `request_sent` `true` ou `unknown`: `request-already-sent`; agente `lost`: `task-lost` |
| `status` | qualquer ciclo de vida | nenhuma além das comuns |
| `wait` | `launched` e `collected` | outro ciclo de vida: `wrong-lifecycle` |
| `collect` | `launched` e `collected`; não fala com o backend | outro ciclo de vida: `wrong-lifecycle` |
| `close` | `launched`, `collected` e `launch-failed`; `closed` só com `--discard-worktree` e worktree ainda presente, para repetir o descarte | agente `working`, com ou sem retorno: `task-working`; `closed` sem descarte pendente: `wrong-lifecycle` |

### `demerzel dispatch <unit-id> [--rule <id>] [--base <ref>] [--human-approved] [--json]`

Todas as verificações da seção 5 rodam antes do primeiro efeito, sob o lock do
projeto. Depois, grava e executa na ordem da seção 2.3: `recorded`,
`launching`, worktree e sessão, agente, envio e `launched`.

- `0`: agente iniciado e pedido enviado; devolve a tarefa gravada.
- `1`: `launch-failed` (com `created`), agente bloqueado no startup
  (`request_sent: false`) ou envio sem confirmação (`request_sent: unknown`).
- `2`: recusa.

### `demerzel resume <id> [--json]`

Envia o pedido inicial gravado de uma tarefa `launched` com
`request_sent: false`, depois que o humano liberou o startup na aba. Só esse
pedido: o texto já está no registro e não é montado de novo.

- `0`: pedido enviado.
- `1`: agente ainda `blocked` ou envio sem confirmação.
- `2`: recusa da matriz acima.

### `demerzel status [<id>...] [--all] [--json]`

Sem IDs, lista as tarefas que não estão `closed`; `--all` inclui as
`closed`.

`status` não espera pelo lock nem grava nada, mas tenta pegá-lo sem esperar
e o solta em seguida. Com o lock livre, uma tarefa em `recorded` ou
`launching` foi interrompida e aparece com `interrupted: true`; com o lock
ocupado, pode ser um `dispatch` em curso e aparece como está.

- `0`: leitura feita e nenhuma tarefa pede atenção.
- `1`: alguma tarefa `interrupted` ou `launch-failed`, ou `launched` ou `collected` com
  agente `blocked`, `unknown` ou `lost`, ou com agente `idle` e retorno
  `absent`.
- `2`: recusa da matriz acima.

### `demerzel wait <id>... [--timeout <ms>] [--json]`

Volta quando cada tarefa tem retorno `present` ou agente `blocked`, `idle`,
`lost` ou `unknown`, ou quando o timeout expira. Sem timeout, espera
indefinidamente. Um retorno presente com o agente ainda `working` também
conta: o orquestrador pode coletar enquanto o agente termina.

- `0`: todas com retorno `present`.
- `1`: alguma parou sem retorno ou o timeout expirou.
- `2`: recusa da matriz acima.

### `demerzel collect <id> [--json]`

Lê o retorno em `<worktree>/<returnPath>` e devolve conteúdo, path, digest
sha256, branch, base e worktree, para o orquestrador fazer readback e aceite.
Não interpreta o conteúdo. Grava `collected` com o digest; coletar de novo
devolve o conteúdo atual e registra se o digest mudou. Pega o lock, porque
grava no registro.

- `0`: retorno lido.
- `1`: retorno ausente.
- `2`: recusa da matriz acima.

### `demerzel close <id> [--discard-worktree] [--json]`

Fecha o workspace do herdr, se ele ainda está no snapshot, e grava `closed`.
Nunca apaga o branch. Com `--discard-worktree`, flag reservada ao humano,
também remove o worktree com `git worktree remove`, sem `--force`, nos dois
harnesses. Numa tarefa já `closed`, só repete esse descarte e não fala com o
backend.

- `0`: fechado, e o worktree removido quando pedido.
- `1`: fechado, mas o Git recusou remover o worktree, por exemplo por
  alterações ou arquivos não rastreados; a mensagem traz o motivo e o
  worktree fica.
- `2`: recusa da matriz acima. `task-working` vale mesmo com o retorno
  presente, porque fechar mataria trabalho em curso.

## 5. Recusas

Todas saem com `2` e não criam nem mudam nada: nenhum arquivo de tarefa,
branch, worktree, workspace ou chamada de efeito no backend. O arquivo `lock`
pode existir de um comando anterior e não conta como efeito.

| Recusa da seção 4 do ADR-0002 | Código | Quem verifica |
| --- | --- | --- |
| Pin diverge | `pin-mismatch` | Integração |
| Unidade não existe | `unit-not-found` | Integração |
| Bloco `radiant-units` inválido | `units-invalid` | Integração |
| Dependência não terminou | `dependency-pending` | Núcleo |
| `writes` se sobrepõe a tarefa que não está `closed` | `writes-overlap` | Núcleo |
| Nenhum candidato viável, com `hold: true` se só faltou capacidade | `no-viable-candidate` | Integração |
| Harness sem adapter Radiant | `harness-without-adapter`, quando `check_dispatch.py routing` aponta candidato sem adapter | Integração |
| herdr parado | `backend-unavailable` | Núcleo |
| herdr abaixo da mínima | `backend-version` | Núcleo |
| Branch já existe | `branch-exists` | Núcleo |
| Path do worktree já existe | `worktree-exists` | Núcleo |
| `.radiant/reports/` não ignorado pelo Git | `reports-not-ignored` | Integração |
| Regra com `approval: human` sem `--human-approved` | `approval-required` | Integração |

A seção 2 do ADR-0003 nomeia quatro recusas da integração: pin, bloco
inválido, harness sem adapter e retorno não ignorado. Unidade inexistente,
candidato viável e aprovação também ficam na integração, porque contrato e
regras só existem nela.

Uma dependência terminou quando a tarefa dela está `closed` depois de
`collected` e o último commit do seu branch é ancestral do commit base da nova
tarefa, isto é, o trabalho dela já está na base. Dependência sem tarefa no
registro também é `dependency-pending`.

Recusas que esta Spec acrescenta, todas sem efeito:

| Recusa | Código | Quem verifica |
| --- | --- | --- |
| Configuração inválida | `config-invalid` | Núcleo, e integração para `radiant` |
| `radiant.root` ausente | `radiant-root-missing` | Integração |
| Contrato ausente ou ambíguo no commit base | `contract-not-found` | Integração |
| `routing.json` ausente ou inválido, ou regra inexistente | `routing-invalid` | Integração |
| Tarefa ou pedido fora do formato | `task-invalid` | Núcleo |
| ID já registrado, em qualquer ciclo de vida | `task-exists` | Núcleo |
| Nome de agente já usado por agente vivo no herdr | `agent-name-taken` | Núcleo |
| Lock do projeto ocupado por outro processo por mais de 30 s | `project-locked` | Núcleo |
| ID sem tarefa no registro | `task-not-found` | Núcleo |
| Comando fora de um repositório Git | `not-a-project` | Núcleo |
| Ciclo de vida que o comando não aceita (matriz da seção 4) | `wrong-lifecycle` | Núcleo |
| `resume` com pedido já enviado ou `request_sent: unknown` | `request-already-sent` | Núcleo |
| `resume` com agente `lost` | `task-lost` | Núcleo |
| `close` com agente `working` | `task-working` | Núcleo |

## 6. Segurança e egress

- O pedido leva só o texto fixo, IDs validados, refs e paths. O conteúdo do
  contrato e secrets nunca entram nele. O harness lançado lê o contrato e o
  envia ao seu provedor, então rotear é decisão de egress (ADR-0003, seção 3).
- O Demerzel nunca faz merge, push, PR, remoção de branch ou mudança de
  escopo, nunca altera contratos e nunca responde prompts.
- O backend nunca passa `--trust-repository` nem decide confiança. O
  `--settings` do Claude Code leva só o hook `WorktreeCreate`, sem
  permissões.
- `--human-approved` e `--discard-worktree` registram uma decisão humana. O
  Demerzel não consegue distinguir quem digitou a flag; o registro guarda que
  ela foi usada.
- Nenhuma telemetria. Mensagens de erro trazem paths, IDs, regra violada e
  ação sugerida, sem conteúdo de contrato.

## 7. Verificação

Cada teste nomeia o comportamento que protege e a regressão que o faria falhar
(gate do `test-audit` do eve, citado no ADR-0002). Os comandos entram no
`AGENTS.md` com o Plan.

1. **Suíte do núcleo sem Radiant.** Roda o fluxo de `dispatch` a `close`,
   incluindo `resume`, com backend falso em memória, `HOME` e `XDG_*`
   temporários, sem checkout Radiant, sem `.radiant.json` e sem `python3` no
   `PATH`. Passa.
2. **Fronteira por import.** Um teste falha se algum arquivo de `src/core/`
   importa `src/radiant/` ou cita `.radiant`, `radiant-units` ou
   `check_project`.
3. **Recusas.** Cada recusa da seção 5 tem teste: saída `2`, código esperado
   no JSON e prova de nenhum efeito (backend falso sem chamadas de efeito, sem
   arquivo de registro, sem branch).
4. **Pedido.** Um contrato de fixture com marcadores únicos prova que nenhum
   deles aparece no pedido gravado ou enviado.
5. **Registro.** Transições e cada linha da matriz da seção 4,
   reconciliação para `lost`, `launch-failed` com `created`, `request_sent`
   em cada desfecho de envio, comandos que gravam serializados pelo lock
   entre processos, inclusive `collect` contra `close`, lock solto quando o
   dono é morto, recuperação de `dispatch` interrompido em cada ponto da
   ordem de gravação, sobreposição de `writes` com os exemplos da seção 2.1,
   nomes de agente distintos para IDs que só diferem em caixa ou pontuação,
   `wait` voltando quando o retorno aparece com o agente ainda `working` e
   quando o agente passa a `unknown`, e `close` recusado nesse mesmo cenário
   de retorno presente com agente `working`.
6. **Integração Radiant.** Consumidor de fixture contra o checkout Radiant no
   pin: localização do contrato no commit base, recusa de base com pin
   diferente do checkout validado, validação por `check_dispatch.py`,
   roteamento com descarte e com `hold` por capacidade, e gate de pin
   divergente.
7. **Cenário herdr.** Backend contra o herdr real numa sessão nomeada e
   isolada: versão, criação de worktree e workspace nos dois modos, snapshot,
   fechamento e descarte. Prova também que o envio volta em `working` com o
   agente ainda trabalhando e que outro `dispatch` do mesmo projeto não espera
   esse turno, que `close` sem `--discard-worktree` preserva worktree e
   branch, que o descarte com alterações sai com `1` e mantém o worktree, e
   que `close` em `working` é recusado.
8. **Smoke com harness real.** Claude Code e Codex lançados pelo herdr,
   pedido entregue, retorno gravado e coletado, registrado na verificação do
   contrato. No Claude Code, o worktree tem o path, o branch e o commit base
   da tarefa, e um hook `WorktreeCreate` que imprime outro path leva a tarefa
   a `launch-failed`.
9. **Menor experimento.** Um contrato real do AIKM com duas unidades
   independentes, uma roteada para Claude Code e outra para Codex, com
   `collect` devolvendo os dois Completion reports e o orquestrador fazendo o
   aceite. Evidência: registro, snapshot do herdr, relatórios, diffs e a
   execução da suíte 1. Antes, o AIKM sobe o pin para uma revisão do Radiant
   com `radiant-units` e o CLI de validação.

## 8. Fora do primeiro incremento

Tudo o que o Frame deixa fora de escopo ou adiado, mais:

- seguimentos com texto do orquestrador para uma sessão já lançada; o humano
  usa a aba diretamente;
- verificação de ativação do contrato;
- interface de observação e gestão.

## 9. Decisões do owner

Aprovadas em 2026-10-17, junto com esta Spec.

| Questão | Decisão |
| --- | --- |
| Modelo interno de tarefa (Frame) | `Task` e `Request` da seção 2 |
| Path e formato da configuração (Frame) | `$XDG_CONFIG_HOME/demerzel/config.json`, JSON, seção 2.4 |
| Raiz do Radiant | `radiant.root` na configuração, sem padrão |
| `--trust-repository` | Lista `trusted_repositories`, não um booleano global. Substituída na revisão 0.4 |
| Versão mínima do herdr (Frame) | 0.9.0, aceitando versões acima |
| Consumidor do menor experimento (Frame) | AIKM |
| Branch e worktree no `close` | O branch nunca é apagado; `--discard-worktree` remove só o worktree |
| Dependência terminada | `closed` depois de `collected`, com o branch dela já na base |
| Pedido pendente | Comando `resume`, só para o pedido inicial |
| Validação de unidades e regras | CLI read-only no Radiant, sem segunda implementação no Demerzel; entrou como `validators/check_dispatch.py` em faelplg/radiant#24 |

Aprovadas em 2026-10-30, na revisão 0.3, depois da crítica do Plan 0.1:

| Questão | Decisão |
| --- | --- |
| Sessão do herdr | `herdr.session` na configuração, passado como `--session` em toda chamada |
| Espera no envio do pedido | `--until working --until blocked`, para o `dispatch` voltar quando o agente começa |

Revisão 0.4, 2026-10-31, a partir da
[prova de lançamento](verification/2026-10-30-launch-probe.md) e da
[prova de base](verification/2026-10-31-claude-worktree-base-probe.md).
Valem quando o owner aprovar o PR desta revisão:

| Questão | Decisão |
| --- | --- |
| Worktree do Claude Code | Criado pelo próprio Claude Code com `--worktree` e um hook `WorktreeCreate` passado por `--settings`, com o mesmo path, branch e base do Codex |
| Worktree do Codex | Sem mudança: `herdr worktree create` |
| Confiança | Pré-requisito do owner, uma vez por projeto em cada CLI; sai `trusted_repositories` e o backend nunca passa `--trust-repository` |
| Descarte do worktree | `git worktree remove` sem `--force`, igual nos dois harnesses; recusa do Git sai com `1` e mantém o worktree |
| Lançamento do Claude Code | Pós-condição de cwd, branch e commit base; se falha, `launch-failed` |

Revisões 0.5 e 0.6, 2026-10-31, ao preparar o contrato do núcleo (TC-0001)
e depois da crítica dele pelo Codex em `gpt-6-astra`, papel `radiant-grill`:
doze objeções, todas aceitas pelo owner. Valem quando o owner aprovar o PR do
contrato:

| Questão | Decisão |
| --- | --- |
| Lock do projeto | `flock` do sistema operacional por `bun:ffi`, espera de até 30 s, depois `project-locked`; o kernel solta o lock de processo encerrado. Substitui o lock com pid e retomada da revisão 0.5 |
| Quem pega o lock | Todo comando que grava: `dispatch`, `resume`, `collect` e `close` |
| `dispatch` interrompido | Ordem fixa de gravações e recuperação conservadora por quem pega o lock depois, sem relançar nem reenviar |
| Estado observado | Dois campos, `agent` e `report`; `close` recusa agente `working` mesmo com retorno presente |
| Comandos por ciclo de vida | Matriz da seção 4, com `task-not-found`, `wrong-lifecycle`, `request-already-sent`, `task-lost` e `task-working` |
| Reuso de ID | Nunca; `task-exists` para qualquer ID registrado |
| Sobreposição de `writes` | Por segmentos, com diferença de caixa e sem resolver symlinks |

Revisão 0.7, 2026-10-31, ao iniciar o Build do TC-0001. Aprovadas pelo owner
em 2026-10-31:

| Questão | Decisão |
| --- | --- |
| Comando fora de um repositório Git | Recusa `not-a-project` |
| Quem recupera `dispatch` interrompido | Só `dispatch`, `resume` e `close`, que falam com o backend; `collect` não recupera |
| Tarefa pela metade no `status` | `status` testa o lock sem esperar; com o lock livre, mostra `interrupted: true` e sai com `1` |

Revisão 0.8, 2026-10-31, depois da verificação independente do Build do
TC-0001. Aprovada pelo owner em 2026-10-31:

| Questão | Decisão |
| --- | --- |
| Label do workspace | ID da tarefa, espaço e nome do agente, único entre projetos |
