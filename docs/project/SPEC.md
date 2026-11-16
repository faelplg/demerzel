# Spec: Demerzel

Revisão da Spec: 0.15, 2026-11-14
Frame: [revisão 0.4](FRAME.md)
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
Revision 0.15 adds the project preparation of section 2.6, for
[faelplg/demerzel#30](https://github.com/faelplg/demerzel/issues/30): Demerzel
creates every worktree itself, prepares it, and only then starts the agent,
and a dispatch holds a lock of its own task.

## 1. Conceitos

| Termo | Significado |
| --- | --- |
| Tarefa | O que o núcleo despacha: harness, modelo, esforço, paths e pedido já resolvidos. Não conhece Radiant. |
| Unidade | Item do bloco `radiant-units` de um Task Contract. A integração a transforma em tarefa. |
| Projeto | Repositório Git de onde o orquestrador chama o Demerzel, identificado pelo checkout principal. |
| Registro | Estado do Demerzel por projeto, em `$XDG_STATE_HOME/demerzel/`. |
| Backend | Superfície própria do Demerzel para criar worktree, abrir sessão, iniciar agente, conferir o lançamento, enviar pedido, ler estado e encerrar. O herdr é a primeira implementação. |
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
contrato, ID da regra e `base_ref`, a ref da base pedida (seção 3, item 3).
O núcleo só grava e devolve esses campos.

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
  `lock`. Since revision 0.15, also `locks/<id>.lock`, the task lock, and
  `logs/<id>/prepare.log`, the output of the preparation (section 2.6).
- O lock é pego por todo comando que grava no registro: `dispatch`, `resume`,
  `collect` e `close`. Until revision 0.14 it serialized every write; since
  revision 0.15 it serializes the decisions about several tasks, and a
  task file is written by the holder of its task lock, as the next bullets
  say. `status` e `wait` só leem e não o pegam; como cada
  arquivo de tarefa é trocado por rename, eles nunca leem um arquivo pela
  metade.
- Since revision 0.15 the two locks split the work. The project lock
  serializes the decisions that read several tasks: the refusals of
  `dispatch` (ID, dependencies, `writes`, branch, worktree, agent name) and
  the planning of a recovery. A task file is written only by the holder of
  that task's lock, and the registry has no file shared between tasks:
  each task has its own task file, lock file and log. So a write needs the
  project lock only when it rests on a decision about other tasks. Every
  write of a `dispatch` after `recorded` touches only its own task, and the
  cross-task facts other commands read from it, its ID, `writes`, branch and
  worktree, are fixed in `recorded` and never change. That is why a
  `dispatch` may record its own `launch-failed` under the task lock alone
  when it cannot take the project lock back: a reader holding the project
  lock sees the task file before or after the rename, `launching` or
  `launch-failed`, and both reserve the same `writes`.
- O lock é um `flock(LOCK_EX)` do sistema operacional no arquivo `lock`,
  pedido sem bloquear e repetido em intervalo curto por até 30 s. O kernel
  solta o lock quando o processo termina, de qualquer jeito, então não existe
  lock abandonado nem retomada. O Bun chega ao `flock` da libc por
  `bun:ffi`, sem dependência. Esgotado o tempo, a recusa é `project-locked`.
  O comando grava no arquivo o próprio pid e horário só para diagnóstico; a
  exclusão não depende desse conteúdo.
- Quem tem o lock só solta depois de gravar o último estado do comando.
  Um `dispatch` segura o lock de `recorded` até `launched` ou
  `launch-failed`, inclusive durante o envio, with one exception: it
  releases the project lock while the preparation runs (section 2.6) and
  takes it back, with the same 30 s wait, before the next record.
- Task lock: an `flock(LOCK_EX)` on `locks/<id>.lock`. It tells a live
  `dispatch` from an interrupted one, which the project lock alone can no
  longer do once it is released during the preparation. Only the holder of
  a task lock writes that task's file, and every writer reads the task file
  only after it holds that task's lock, so no write starts from a stale copy.
  A task lock is never waited for while the project lock is held, so no
  command can block a `dispatch` that needs the project lock back. Creating
  a lock file is not an effect, like the project's `lock`; a task with no
  lock file has a free task lock. Only the holder stamps the file with its
  pid and time, for diagnosis.

  | Command | Order | Task lock busy | Reads the task | Releases |
  | --- | --- | --- | --- | --- |
  | `dispatch`, own task | project lock (30 s wait), then the task lock without waiting, before `recorded` | cannot happen: the ID is new, else `task-exists` | it writes the first copy | after its last record |
  | `dispatch`, preparation | releases the project lock after `prepare_started_at`, keeps the task lock, takes the project lock back with a 30 s wait | | | the project lock again after its last record |
  | `resume`, `collect`, `close` | project lock (30 s wait), then the target's task lock without waiting | `task-busy`, no effect | after taking the task lock | after their last record |
  | Recovery inside `dispatch`, `resume`, `close` | under the project lock, each task in `recorded` or `launching`: its task lock without waiting | the task is skipped and left as it is | after taking its task lock, and the lifecycle is checked again | at the end of the command, after publishing or without publishing |
  | `status` | no project lock; each task in `recorded` or `launching`: opens an existing lock file read-only, tries the task lock without waiting, releases it at once | the task shows as it is | before, without a lock | at once |

  If the project lock cannot be taken back after the preparation, the
  `dispatch` still holds its task lock, so it records `launch-failed` with
  the reason and `created` as it is, and exits with `1`. A `status` that
  holds a task lock for that instant can make a recovery skip the task;
  the task stays as it is until the next command recovers it. It touches
  only tasks in `recorded` or `launching`, so it can never hold the lock of
  a new task's `dispatch`. A `resume`, `collect` or `close` that meets it
  gets `task-busy`, a refusal with no effect, for a task those commands
  refuse anyway by lifecycle.
- Cada tarefa registra: a tarefa recebida, o pedido final, harness, modelo,
  esforço aplicado ou omitido, base (ref e commit), branch, path do worktree,
  IDs no backend (workspace, aba, pane, nome do agente), `provenance`, ciclo de
  vida, recursos criados e o histórico de transições com horários.
- A decisão de roteamento é gravada antes do primeiro efeito e nunca é relida
  para decidir de novo.
- Ordem das gravações no `dispatch`: `recorded` com a decisão; `launching`
  antes do primeiro efeito; cada recurso entra em `created` logo depois de
  criado; `send_started_at` antes do envio; `launched` com o desfecho do
  envio. Cada gravação termina antes do passo seguinte começar. Since
  revision 0.15 the effects run in this order: branch and worktree, created
  by the core (section 2.6); `prepare_started_at`, then the preparation, then
  its outcome; session; agent; launch check; send.
- Projeto ausente: um comando chamado fora de um repositório Git não tem
  projeto nem registro, e a recusa é `not-a-project`.
- Recuperação: `dispatch`, `resume` e `close`, os comandos que pegam o lock e
  falam com o backend, ao encontrar tarefa em `recorded` ou `launching` take
  its task lock without waiting, by the table above. If they get it, they
  read the task again and, if it is still in `recorded` or `launching`, its
  `dispatch` was interrupted, because a live one would hold the lock; if
  they do not, the task is left as it is. A recovery is published only when
  the command gets past all of its refusals; a refused command writes
  nothing, and the task stays for the next one. Antes de agir,
  gravam a recuperação e o motivo `interrupted`
  no histórico. `collect` não recupera e só grava a própria tarefa:
  - `recorded`: `launch-failed` com `created` vazio, porque nenhum efeito
    começou;
  - `launching`, including an interrupted preparation: confere no Git e no snapshot o branch, o worktree, o
    workspace pelo ID gravado ou, sem ele, pelo label, com a aba e o pane
    dele, e o agente pelo nome, e grava em `created` o que existe. Com o agente vivo, a tarefa vai para `launched`, com
    `request_sent: unknown` se `send_started_at` foi gravado e `false` se não;
    sem agente, para `launch-failed`. A recuperação não confere a
    pós-condição de lançamento da seção 2.5: quem confere é o `resume`, logo
    antes de enviar, para toda tarefa, recuperada ou não;
  - nada é relançado nem reenviado sozinho.

Ciclo de vida gravado:

| Estado | Significado |
| --- | --- |
| `recorded` | Decisão gravada, nenhum efeito ainda |
| `launching` | Primeiro efeito iniciado |
| `launch-failed` | Falha depois do primeiro efeito, ou pós-condição que não confere no `resume`; `created` lista o que existe |
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

Falha do backend no meio de um comando, como o servidor caindo entre a
sondagem e o snapshot, uma resposta que não é JSON ou um erro de transporte:

- antes do primeiro efeito do comando, é a recusa `backend-unavailable`,
  sem efeito, como uma sondagem que falha;
- depois do primeiro efeito, o comando grava o que já sabe, segue a regra do
  passo em que parou (por exemplo `launch-failed` com `created`, ou
  `request_sent: unknown` num envio) e sai com `1`, com o agente observado
  como `unknown`;
- em todos os casos, a mensagem traz o comando do backend que falhou e o
  resumo do erro dele, nunca o texto do pedido nem conteúdo de arquivo.

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
  unidades, não tem padrão e precisa ser um path absoluto; relativo é
  `config-invalid`. `branch_prefix` é opcional, padrão `radiant/`; só a
  chave ausente usa o padrão, e `null` é tipo errado.
- Arquivo ausente: o núcleo usa os padrões e a integração recusa por falta de
  `radiant.root`.

### 2.5 Backend herdr

Versão mínima: 0.9.0, a única conferida (ADR-0002). Versões acima são
aceitas; o cenário local da seção 7 registra a versão conferida. O Demerzel lê
`herdr status --json`, na sessão da configuração, e exige `server.running`, `server.compatible` e
`server.version` igual ou acima da mínima.

| Operação | herdr 0.9.0 |
| --- | --- |
| Criar sessão, Codex | `herdr workspace create --cwd <worktree> --label <label> --no-focus`, in the worktree the core already created and prepared (section 2.6). Devolve `workspace`, `tab` e `root_pane`. Until revision 0.14 it was `herdr worktree create`, which also created the worktree. |
| Criar sessão, Claude Code | `herdr workspace create --cwd <projeto> --label <label> --no-focus`. Devolve `workspace`, `tab` e `root_pane`. The agent enters the worktree in the next step. |
| Iniciar agente | `herdr agent start <nome> --kind <kind> --pane <root_pane> -- <args>`. No Codex, `<args>` são modelo e esforço. No Claude Code, vêm antes `--worktree <nome> --settings <hook>`, descritos abaixo. |
| Conferir o lançamento, Claude Code | `herdr agent get <nome>`, com o `foreground_cwd` do próprio agente; `git -C <projeto> rev-parse --verify refs/heads/<branch>`; e, no worktree, `git -C <worktree> symbolic-ref HEAD` e `git -C <worktree> rev-parse HEAD`. No Codex não há pós-condição e a conferência passa sem chamada. |
| Enviar pedido | `herdr agent prompt <nome> <texto> --wait --until working --until blocked --timeout <ms>`. Sem `--until`, o `--wait` só volta em `idle`, `done` ou `blocked`, isto é, no fim do turno, e o `dispatch` seguraria o lock do projeto durante todo o trabalho. |
| Ler estado | `herdr api snapshot` e `herdr agent get <nome>` |
| Esperar | Ciclo próprio: a cada intervalo curto, lê `herdr api snapshot` e confere o arquivo de retorno, até cada tarefa chegar a um estado de parada ou o timeout expirar. `herdr agent wait` não serve sozinho: não vê o arquivo de retorno e, sem `--until`, só volta em `idle`, `done` ou `blocked`. |
| Encerrar | `herdr workspace close <workspace>`; com descarte, depois `git -C <projeto> worktree remove <path>`, sem `--force` |

- No herdr 0.9.0, `workspace create` abre um workspace
  próprio com uma aba e um pane. A "aba própria" da unidade é essa aba.
- O label do workspace é o ID da tarefa, um espaço e o nome do agente, por
  exemplo `TC-0025.1 dz-6de747e982262631`. O ID é o que o humano lê na aba;
  o nome do agente torna o label único entre projetos que compartilham o
  herdr, para que a recuperação nunca tome a aba de outro projeto.
- O path do worktree é `<registro do projeto>/worktrees/<id>`, decidido antes
  do primeiro efeito para que a recusa de path existente seja verificável.
  Path, branch e base são os mesmos nos dois harnesses. Since revision 0.15
  the core creates the worktree for both, and what differs is only where the
  agent starts.
- Por que dois modos: o Claude Code 2.1.286 confia por path exato e pararia
  no diálogo de confiança em cada worktree novo aberto como cwd; o Codex
  0.166.0 confia pela raiz do repositório e cobre os worktrees dela. Sem
  hook, o `claude --worktree` escolhe sozinho path, branch e base
  (`origin/HEAD` ou o `HEAD` local), o que não serve à integração Radiant.
  So Claude Code starts at the trusted root and enters the worktree through
  the hook, and Codex starts in the worktree. The
  [prepared worktree probe](verification/2026-11-14-prepared-worktree-probe.md)
  showed both with a worktree created by `git worktree add` before the
  agent, with Claude Code 2.1.311 and Codex 0.169.0, 0 of 5 dialogs each.
- Worktree do Claude Code: o agente é iniciado na raiz do projeto com
  `--worktree <nome do agente>` e `--settings <json>`. O JSON tem só um hook
  `WorktreeCreate` de comando, which since revision 0.15 creates nothing: it
  runs `printf '%s' <path>` and so prints only the path of the worktree the
  core already created and prepared. O Demerzel monta o
  comando com o argumento entre aspas simples, no escape de POSIX `sh`, e
  grava o JSON no registro antes do primeiro efeito.
- Pós-condição do lançamento no Claude Code: depois de `agent start`, o
  `foreground_cwd` do agente é o path do worktree, o branch existe e aponta
  para o commit base, e o `HEAD` do worktree é esse branch, nesse commit, e
  não outro branch nem `HEAD` destacado. Se não, a tarefa vai para
  `launch-failed`, com `created` listando o que existe. Assim um hook `WorktreeCreate` ou um
  `disableAllHooks` do próprio projeto, que se combinam com o `--settings` de
  modos que o Demerzel não conferiu, não passam despercebidos.
- A mesma pós-condição é uma operação própria do backend, usada pelo
  `dispatch` depois de `agent start` e pelo `resume` logo antes de enviar o
  pedido. O `resume` confere sempre, mesmo que o `dispatch` já tenha
  conferido, porque a tarefa pode ter chegado a `launched` pela recuperação
  da seção 2.3, sem conferência, e porque o worktree pode ter mudado enquanto
  o humano liberava o startup. A conferência só lê: não cria, não muda e não
  remove nada. Se ela não confere no `resume`, a tarefa vai de `launched`
  para `launch-failed`, com o motivo e `created` como estava, e o pedido não
  sai.
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

  O backend só passa um nível de esforço que foi conferido na versão
  instalada do CLI e registrado no Plan; qualquer outro é omitido do
  lançamento, com o motivo gravado em `recorded`, antes do primeiro efeito.
  Hoje: Claude Code 2.1.286, `low`, `medium`, `high`, `xhigh` e `max`; Codex
  0.166.0, `minimal`, `low`, `medium`, `high` e `xhigh`. O backend nunca passa
  flags de permissão ou de bypass; o harness lançado usa a configuração do
  próprio usuário.
- Startup bloqueado (`agent_not_ready`) deixa a tarefa `launched`, com
  `request_sent: false`, observada como `blocked`. O pedido sai depois por
  `resume`. No Claude Code, a pós-condição de lançamento é conferida também
  no startup bloqueado: se cwd, branch e commit base conferem, a tarefa fica
  `launched` e bloqueada; se não conferem, inclusive porque o agente ainda
  não entrou no worktree, vai para `launch-failed`, com `created` listando o
  que existe. O `resume` nunca envia o pedido a um worktree que não foi
  conferido, porque confere de novo antes de enviar.
- `agent_blocked` no envio, isto é, agente já bloqueado antes de receber o
  pedido, deixa `request_sent: false`.
- `agent_prompt_stalled` ou timeout no envio deixam `request_sent: unknown`. O
  Demerzel não reenvia sozinho, porque o pedido pode ter chegado.

### 2.6 Project preparation

A project declares how a fresh worktree is prepared, such as installing its
dependencies, so that a dispatched task can run the project's check without
preparing anything on its own. The preparation is the project's, not the
integration's: the core reads it, and an integration neither adds nor
removes commands.

Declared in `.demerzel.json` at the project root, read from the base commit
with `git show <commit>:.demerzel.json`, like the contract in section 3, so
what runs is what was committed at the commit being dispatched:

```json
{
  "schema": 1,
  "prepare": [
    ["bun", "install", "--frozen-lockfile"]
  ]
}
```

- `schema`: exactly `1`. An unknown key is a refusal.
- `prepare`: optional; a list of commands, run in order. Each command is a
  non-empty list of strings, an argv with no shell: no expansion, no
  pipes, no redirection. No string is empty or holds a NUL. An absent
  `prepare`, or an empty list, prepares nothing.
- File absent at the base commit, that is, the commit's root tree read
  successfully with no `.demerzel.json` entry: no preparation, as before
  revision 0.15. The entry must be a regular file (mode `100644` or
  `100755`).
- An entry of another type, such as a symlink, a directory or a submodule, a
  Git error reading the tree or the blob, a file that is not JSON, or one
  that breaks any rule above is the refusal `project-config-invalid`,
  before the first effect. The message names the file, the commit and the
  rule, never the values.
- The commands are recorded in `recorded`, with the commit they came from,
  before the first effect, and are never read again for the same task.

Run by the core, after the worktree exists and before the session opens:

1. The core creates the branch and the worktree for every harness with
   `git -C <project> -c core.hooksPath=<an empty folder> worktree add -b <branch> <path> <commit base>`,
   and records both in `created`. No Git hook runs, so `.demerzel.json` is
   the one declared place for setup; checkout filters, such as a Git LFS
   smudge, still run as configured, because they are part of what checking
   out the commit means. A filter's command comes from the user's Git
   configuration, not from the commit, which only names the filter in
   `.gitattributes`. It runs under the project lock with no time limit of
   Demerzel's own, as with `herdr worktree create` before revision 0.15. Its
   output is part of Git's own output, which the core captures from
   `git worktree add` like from any Git call, outside `prepare.log`, and
   never prints. A failing filter fails `git worktree add`, and the task
   goes to `launch-failed` with what exists in `created` and the summary of
   Git's error in the reason, as for any Git failure. Before revision 0.15 the backend created them, in
   a different way per harness, with the project's hooks.
2. It records `prepare_started_at` and releases the project lock, keeping
   the task lock (section 2.3).
3. It runs each command with the worktree as its cwd, stdin from
   `/dev/null`, Demerzel's own environment, and its own process group,
   recording the group's ID before the command starts. The
   program is found on `PATH`, or, when it holds a `/`, relative to the
   worktree. Standard output and error go, in order, to
   `logs/<id>/prepare.log` in the project's registry, with one header line
   per command giving its index; nothing goes to Demerzel's own output.
4. A command is done when its leader exits and its process group is
   empty. If any process of the group is left, the group receives
   `SIGTERM`, then `SIGKILL` 5 s later, and the command fails with "left
   processes running", whatever its exit code. A process that leaves the
   group, as with `setsid`, is not seen.
5. It stops at the first command that exits with a code other than `0`, is
   ended by a signal, cannot start, or leaves processes running. The whole
   preparation, all commands together, has a fixed limit of 10 minutes;
   past it, the running command's group receives `SIGTERM`, then `SIGKILL`
   5 s later.
6. It checks that the preparation kept the task's identity: the branch
   still points to the base commit, and the worktree's `HEAD` is that
   branch at that commit, for both harnesses. Untracked and ignored files,
   such as installed dependencies, are allowed. If it does not hold, the
   preparation failed.
7. It takes the project lock back and records the outcome: each command run
   with its exit code or signal and its duration, and the log path.

A failed preparation takes the task to `launch-failed`, with `created`
listing the branch and the worktree, both kept for the human to inspect,
and no session or agent started. `dispatch` exits with `1`. For a command
that failed, the reason names its index and program, its exit code, signal,
"left processes running" or the time limit, and the log path, never the
log's content. For a failed identity check, every command having
succeeded, the reason names the invariant that broke (the branch moved off
the base commit, `HEAD` on another branch, `HEAD` detached, or `HEAD` off
the base commit), with the commits involved, and the log path.

An interrupted preparation, such as a `dispatch` killed while a command
runs, leaves the task in `launching` with `prepare_started_at` and its task
lock free; the recovery of section 2.3 takes it to `launch-failed` with the
branch and the worktree in `created`. A command still running from the
killed `dispatch` is not stopped by the recovery, and `close` keeps its
behavior; the recovery's reason names the recorded process group, so the
human can check whether it is still running before discarding the
worktree.

The preparation does not change what the request carries (section 2.2), but
it runs commands from the project with the user's environment, with the
network access those commands use; section 6 covers it.

## 3. Integração Radiant

Vive em `src/radiant/`, depende do núcleo e é a única entrada do primeiro
incremento.

1. **Projeto.** Raiz do checkout chamador (`git rev-parse --show-toplevel`),
   que precisa ter `.radiant.json`.
2. **Gate de pin.** Executa
   `python3 <radiant.root>/validators/check_project.py <raiz>`. O gate
   compara o pin com o único checkout Radiant da máquina, então o consumidor
   precisa estar no mesmo pin desse checkout. Os validators rodam com
   `PYTHONDONTWRITEBYTECODE=1`, para não gravar bytecode no checkout Radiant.
   Cada um tem o próprio protocolo:

   | Validator | Sucesso | Erro de domínio | Qualquer outra coisa |
   | --- | --- | --- | --- |
   | `check_project.py` | saída `0` com linha `PASS:` no stdout | saída `1` com linha `HOLD:` no stderr, que vira `pin-mismatch` com essa linha na mensagem | `validator-failed` |
   | `check_dispatch.py` | saída `0` com o JSON prometido | saída `1` com `{"errors": [...]}`, item 5 | `validator-failed` |

   "Qualquer outra coisa" inclui outra saída, encerramento por sinal,
   `python3` ausente e texto fora do formato prometido. O pin que o gate
   validou é o commit da linha `PASS:` (`PASS: Radiant <commit>;` na revisão
   fixada no pin), e uma linha `PASS:` sem ele está fora do formato. A
   integração nunca relê o `.radiant.json` do checkout chamador depois do
   gate. Os arquivos que a integração lê direto do checkout Radiant
   (`agents.json`, `capabilities.json` e `provides.json`) fora do formato
   também são `validator-failed`: o checkout não é o que o pin promete.
3. **Base.** `--base <ref>`, ou o branch atual do checkout chamador; em HEAD
   destacado, o commit de HEAD. A base é resolvida para um commit e os dois são
   gravados; uma base que não resolve para um commit é `task-invalid`, como
   no núcleo. O `.radiant.json` lido do commit base precisa ser um objeto JSON
   com o mesmo `radiant_revision` que o gate validou no checkout chamador; se
   falta, não é JSON, não tem a chave ou diverge, a recusa é `pin-mismatch`.
   Do resto desse mapa, a integração só usa `contracts`, conferido no item 4.
   Assim o pin validado vale para a árvore que será despachada; o gate
   completo só roda no checkout chamador. A base é
   resolvida uma vez só: a tarefa entregue ao núcleo leva esse commit em
   `base`, e a ref pedida vai em `provenance` como `base_ref`, para que o
   núcleo lance o commit que a integração validou mesmo que o branch ande no
   meio.
4. **Contrato.** O prefixo do ID (`TC-0025` em `TC-0025.1`) localiza o arquivo
   `TC-0025-*.md` no diretório `contracts` do `.radiant.json` do commit base;
   precisa haver exatamente um, e o `*` aceita também o sufixo vazio. Um ID
   fora de `TC-NNNN.N` é `unit-not-found` antes do gate, sem rodar nenhum
   validator, porque sem o prefixo não há contrato a procurar. `contracts` ausente, nulo ou fora de um path
   relativo dentro do repositório, como no `check_project.py`, também é
   `contract-not-found`. O contrato é lido do commit base, não do working tree, para
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
   - saída `0` traz o valor em JSON; saída `1` traz `{"errors": [...]}`. Em
     `units`, vira `units-invalid`, e a mensagem traz só a contagem de erros e
     o comando que os mostra, porque os erros repetem valores do contrato
     (seção 6). Em `routing`, vira `routing-invalid` com os erros na
     mensagem, porque o `routing.json` é do usuário, não do contrato; salvo
     quando algum erro é de candidato sem adapter (`harness without an
     adapter`, texto da revisão fixada no pin): aí a recusa é
     `harness-without-adapter`, com os demais erros na mensagem. Os erros de
     `check_dispatch.py` são texto livre, sem código; por isso toda mudança
     de pin confere esse trecho contra `validators/dispatch_formats.py` da
     nova revisão;
   - cada `dispatch` executa no máximo uma vez o gate, uma vez `units` e uma
     vez `routing`, e para na primeira recusa.
6. **Roteamento.** Aplica às regras validadas a regra pedida por
   `--rule <id>`, ou `default` sem a flag:
   - descarta candidatos sem suporte no backend ou cujo `provides.json` não
     cobre os `requires` da unidade. Candidato sem adapter Radiant já é erro
     de `check_dispatch.py`, que só aceita como adapter o diretório com
     `README.md`, `capabilities.json` e `provides.json`;
   - piso: a capacidade da unidade, ou, sem ela, a padrão do papel em
     `agents.json`, resolvido antes de olhar os candidatos. Capacidade
     efetiva: a do candidato quando presente, senão o piso. Candidato abaixo
     do piso, na ordem de `agents.json`, não é viável;
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
parado com `backend-unavailable`. Since revision 0.15, `resume`, `collect` and `close`
also refuse with `task-busy` a task whose lock another command holds
(section 2.3), before any check of the row.

| Comando | Aceita | Recusa, sem efeito |
| --- | --- | --- |
| `resume` | `launched` com `request_sent: false` | outro ciclo de vida: `wrong-lifecycle`; `request_sent` `true` ou `unknown`: `request-already-sent`; agente `lost`: `task-lost` |
| `status` | qualquer ciclo de vida | nenhuma além das comuns |
| `wait` | `launched` e `collected` | outro ciclo de vida: `wrong-lifecycle` |
| `collect` | `launched` e `collected`; não fala com o backend | outro ciclo de vida: `wrong-lifecycle` |
| `close` | `launched`, `collected` e `launch-failed`; `closed` só com `--discard-worktree` e worktree ainda presente, para repetir o descarte | agente `working`, com ou sem retorno: `task-working`; `closed` sem descarte pendente: `wrong-lifecycle` |

### `demerzel dispatch <unit-id> [--rule <id>] [--base <ref>] [--human-approved] [--json]`

Todas as verificações da seção 5 rodam antes do primeiro efeito. As da
integração rodam primeiro, sem o lock, porque só leem objetos Git do commit
base, o checkout Radiant e arquivos do usuário, e não tocam o registro. As do
núcleo rodam depois, sob o lock do projeto. Depois, grava e executa na ordem
da seção 2.3: `recorded`, `launching`, branch and worktree, the preparation
of section 2.6 without the project lock, sessão, agente, envio e
`launched`.

- `0`: agente iniciado e pedido enviado; devolve a tarefa gravada.
- `1`: `launch-failed` (com `created`), including a failed preparation,
  agente bloqueado no startup
  (`request_sent: false`) ou envio sem confirmação (`request_sent: unknown`).
- `2`: recusa.

### `demerzel resume <id> [--json]`

Envia o pedido inicial gravado de uma tarefa `launched` com
`request_sent: false`, depois que o humano liberou o startup na aba. Só esse
pedido: o texto já está no registro e não é montado de novo.

Ordem, sob o lock: recusas da matriz; com o agente ainda `blocked`, sai com
`1` sem conferir nem enviar; senão, confere o lançamento (seção 2.5) e só
então grava `send_started_at` e envia. Uma falha do backend durante a
conferência é `backend-unavailable`, sem efeito, porque nada foi gravado
ainda. Uma conferência que não confere leva a tarefa a `launch-failed` e o
pedido não sai.

- `0`: pedido enviado.
- `1`: agente ainda `blocked`, pós-condição que não confere
  (`launch-failed`) ou envio sem confirmação.
- `2`: recusa da matriz acima.

### `demerzel status [<id>...] [--all] [--json]`

Sem IDs, lista as tarefas que não estão `closed`; `--all` inclui as
`closed`.

`status` não espera pelo lock nem grava nada. Since revision 0.15, for each
task in `recorded` or `launching` it tries that task's lock (section 2.3)
without waiting and releases it at once, opening an existing lock file
read-only, never creating or stamping one. With the task lock free, the task
was interrupted and shows `interrupted: true`; with it held, a `dispatch` is
running, possibly in its preparation, and the task shows as it is.

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
| Validator fora do próprio protocolo (seção 3, item 2): outra saída, sinal, `python3` ausente ou texto fora do formato | `validator-failed` | Integração |
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
| `.demerzel.json` at the base commit unreadable, not a regular file, not JSON, or breaking section 2.6 | `project-config-invalid` | Núcleo |
| `resume`, `collect` or `close` of a task whose task lock another command holds, such as a live `dispatch` | `task-busy` | Núcleo |

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
- The preparation of section 2.6 is the only thing Demerzel runs from the
  project, and only the commands committed in `.demerzel.json` at the base
  commit. Git hooks do not run at worktree creation; checkout filters do,
  with the commands the user's own Git configuration gives them (section
  2.6). They run with the user's environment and network, as when the
  human prepares a worktree by hand, so trusting a project to dispatch is
  also trusting its preparation. The output of the preparation commands
  stays in `prepare.log` in the registry; a filter's output stays in Git's
  output captured by the core (section 2.6). Neither is sent to the harness
  or printed by Demerzel.

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
   deles aparece no pedido gravado ou enviado, nem no stdout, stderr ou
   envelope de uma recusa, inclusive `units-invalid` com o marcador num campo
   que o validator recusa.
5. **Registro.** Transições e cada linha da matriz da seção 4,
   reconciliação para `lost`, `launch-failed` com `created`, `request_sent`
   em cada desfecho de envio, comandos que gravam serializados pelo lock
   entre processos, inclusive `collect` contra `close`, lock solto quando o
   dono é morto, recuperação de `dispatch` interrompido em cada ponto da
   ordem de gravação, sobreposição de `writes` com os exemplos da seção 2.1,
   nomes de agente distintos para IDs que só diferem em caixa ou pontuação,
   `wait` voltando quando o retorno aparece com o agente ainda `working` e
   quando o agente passa a `unknown`, e `close` recusado nesse mesmo cenário
   de retorno presente com agente `working`. No `resume` de uma tarefa do
   Claude Code, recuperada de `launching` com o agente vivo e também vinda
   de um startup bloqueado: pós-condição que confere envia o pedido;
   pós-condição que não confere leva a `launch-failed` sem chamada de envio;
   falha do backend na conferência é `backend-unavailable` sem gravação; e
   agente ainda `blocked` sai com `1` sem conferir. No backend herdr, a
   conferência do `resume` acusa cwd fora do worktree, branch ausente e
   branch fora do commit base, com o herdr falso.
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
10. **Preparation.** With the fake backend and a fake project: the commands
    of `.demerzel.json` run in order in the worktree, before the backend's
    first session effect, with the log written; no file and an empty
    `prepare` run nothing; each rule of section 2.6 broken, a symlink or
    directory entry and an unreadable object are `project-config-invalid`
    with no effect; a failing command, a signal, a program that cannot
    start, a command that exits `0` leaving a child running, the time limit
    across commands and a preparation that moves `HEAD` each lead to
    `launch-failed` with branch and worktree in `created` and no session
    effect; a project `post-checkout` hook does not run; a second
    `dispatch` of an independent task completes while the first one is
    still preparing; `resume`, `collect` and `close` of a task whose lock
    is held are `task-busy`; `status` shows the preparing task without
    `interrupted` and the killed one with it, and creates no lock file;
    recovery takes a killed preparation to `launch-failed` and leaves a live
    one alone, a refused command publishes no recovery, and a recovery
    that read a task before its `dispatch` recorded `launch-failed` does not
    overwrite it. In
    the herdr backend, with the fake herdr: Codex opens its workspace in the
    worktree and the Claude Code hook only prints the path. The herdr
    scenario creates and prepares the worktree for both modes before the
    agent, and the smoke shows a real agent of each harness reading a file
    the preparation wrote.

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
| Worktree do Claude Code | Criado pelo próprio Claude Code com `--worktree` e um hook `WorktreeCreate` passado por `--settings`, com o mesmo path, branch e base do Codex. Replaced in revision 0.15: the core creates the worktree, and the hook only prints its path |
| Worktree do Codex | Sem mudança: `herdr worktree create`. Replaced in revision 0.15: `herdr workspace create` in the worktree the core created |
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
| Quem pega o lock | Todo comando que grava: `dispatch`, `resume`, `collect` e `close`. Revision 0.15 adds the task lock and the protocol table of section 2.3; `dispatch` releases the project lock during the preparation |
| `dispatch` interrompido | Ordem fixa de gravações e recuperação conservadora por quem pega o lock depois, sem relançar nem reenviar. Since revision 0.15, the recovering command must also get the task's lock |
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
| Tarefa pela metade no `status` | `status` testa o lock sem esperar; com o lock livre, mostra `interrupted: true` e sai com `1`. Replaced in revision 0.15: `status` tests each task's lock, read-only |

Revisão 0.8, 2026-10-31, depois da verificação independente do Build do
TC-0001. Aprovada pelo owner em 2026-10-31:

| Questão | Decisão |
| --- | --- |
| Label do workspace | ID da tarefa, espaço e nome do agente, único entre projetos |

Revisão 0.9, 2026-10-31, depois da crítica do TC-0002 pelo Codex em
`gpt-6.1-sol`, papel `radiant-grill`. Aprovadas pelo owner em 2026-10-31:

| Questão | Decisão |
| --- | --- |
| Startup bloqueado do Claude Code | A pós-condição vale também no startup bloqueado: conferida, `launched` e bloqueada; não conferida, `launch-failed` |
| Esforço não conferido | Só níveis conferidos e registrados no Plan; os outros são omitidos com motivo antes do primeiro efeito |
| Falha do backend no meio de um comando | Antes do primeiro efeito, `backend-unavailable`; depois, grava o que sabe e sai com `1`; a mensagem traz o comando e o erro do backend |

Revisão 0.10, 2026-11-04, a partir do achado P1 do review do Codex no
[PR #16](https://github.com/faelplg/demerzel/pull/16), aceito e adiado pelo
owner em 2026-11-02 e registrado no
[relatório do TC-0002](verification/2026-10-31-tc-0002-herdr.md). A
recuperação levava a `launched` uma tarefa do Claude Code cuja pós-condição
não foi conferida, e o `resume` enviava o pedido sem conferir. Valem quando o
owner aprovar o PR desta revisão:

| Questão | Decisão |
| --- | --- |
| Onde a pós-condição protege o envio | No `resume`, logo antes de enviar, para toda tarefa; a recuperação continua sem conferir. Alternativa descartada: gravar a conferência do `dispatch` e exigi-la na recuperação, que não cobre um worktree mudado depois do startup |
| Superfície do backend | Conferir o lançamento vira operação própria, a mesma no `dispatch` e no `resume`; no Codex passa sem chamada |
| Pós-condição que não confere no `resume` | `launched` vai para `launch-failed`, com o motivo, e sai com `1`; o pedido não sai |
| Agente ainda `blocked` no `resume` | Sai com `1` sem conferir; a conferência fica para o `resume` que vai enviar |

Revisão 0.11, 2026-11-04, ao fixar o pin em
`9612a8cd5396a1d77776faf462dc48c8bd9d734a`, a tradução do Radiant para o
inglês em [faelplg/radiant#27](https://github.com/faelplg/radiant/pull/27). Os
prefixos `PASS:` e `HOLD:` e o formato JSON não mudaram; mudou o texto das
mensagens. Valem quando o owner aprovar o PR desta revisão:

| Questão | Decisão |
| --- | --- |
| Erro de candidato sem adapter | O trecho procurado nos erros de `routing` passa a ser `harness without an adapter`, conferido a cada mudança de pin. Alternativa descartada: o Demerzel conferir `adapters/<harness>/` por conta própria, que seria uma segunda implementação da regra; a detecção sem depender do texto pede um código de erro no `check_dispatch.py`, mudança do Radiant |

Revisão 0.12, 2026-11-04, ao preparar o contrato da integração Radiant
(TC-0003). Valem quando o owner aprovar o PR do contrato:

| Questão | Decisão |
| --- | --- |
| Lock nas recusas do `dispatch` | As da integração rodam antes, sem o lock, porque só leem o commit base, o checkout Radiant e arquivos do usuário; as do núcleo continuam sob o lock |
| Validator que não responde como prometido | Recusa `validator-failed`, sem efeito, para saída `2`, execução que falha, inclusive sem `python3`, ou saída fora do JSON esperado |
| Base resolvida duas vezes | A integração resolve a base uma vez e entrega o commit ao núcleo; a ref pedida fica em `provenance.base_ref` |

Revisão 0.13, 2026-11-04, depois da crítica do TC-0003 pelo Codex em
`gpt-6-astra`, papel `radiant-grill`: oito objeções, todas aceitas pelo owner
em 2026-11-04. Valem quando o owner aprovar o PR do contrato:

| Questão | Decisão |
| --- | --- |
| Alcance da pós-condição | Inclui o `HEAD` do worktree: o branch da tarefa, no commit base, nunca outro branch nem `HEAD` destacado |
| Piso de capacidade | A capacidade da unidade ou, sem ela, a padrão do papel, resolvida antes dos candidatos |
| Erros de `units` na recusa | Só a contagem e o comando que os mostra, porque repetem valores do contrato; os de `routing` passam como vêm |
| Mapa do commit base | Objeto JSON com o mesmo `radiant_revision`, senão `pin-mismatch`; `contracts` inutilizável é `contract-not-found`; o gate completo só roda no checkout chamador |
| Protocolo dos validators | Uma linha por executável, seção 3, item 2; `validator-failed` para o que fica fora dele. Substitui a decisão da revisão 0.12 |
| Execuções por `dispatch` | Uma vez o gate, uma `units` e uma `routing`, parando na primeira recusa |
| Bytecode | Validators com `PYTHONDONTWRITEBYTECODE=1`; nada gravado no checkout Radiant, nem arquivo ignorado |

Revisão 0.14, 2026-11-05, depois da primeira verificação independente do
Build do TC-0003, pelo Codex em `gpt-6-astra`, papel `radiant-verifier`. O
verificador apontou quatro códigos de recusa que a Spec não decidia, e o
owner aprovou, em 2026-11-05, o que o Build já fazia:

| Questão | Decisão |
| --- | --- |
| `--base` que não resolve | `task-invalid`, o código que o núcleo dava para a mesma checagem. Alternativa descartada: um código próprio da integração |
| ID de unidade fora de `TC-NNNN.N` | `unit-not-found` antes do gate, sem rodar validator. Alternativa descartada: rodar o gate primeiro |
| `radiant.root` relativo | `config-invalid`, porque o pointer `radiant-root` é absoluto. Alternativa descartada: resolver relativo à pasta da configuração |
| `agents.json`, `capabilities.json` ou `provides.json` fora do formato | `validator-failed`. Alternativa descartada: `pin-mismatch` |

A mesma verificação levou a três esclarecimentos, sem decisão nova: o pin
validado é o da linha `PASS:` do gate, e a integração não relê o mapa do
chamador; `branch_prefix: null` é tipo errado; o glob `TC-NNNN-*.md` aceita o
sufixo vazio.

Revision 0.15, 2026-11-14, for
[faelplg/demerzel#30](https://github.com/faelplg/demerzel/issues/30), after
the [prepared worktree probe](verification/2026-11-14-prepared-worktree-probe.md).
Decided by the owner on 2026-11-14 and 2026-11-15; they take effect when
the PR of TC-0004 is merged, which also activates the contract:

| Question | Decision |
| --- | --- |
| Where the preparation is declared | `.demerzel.json` at the project root, read from the base commit, with commands as argv lists and no shell. Alternative discarded: a per-project key in the user's `config.json`, which is not versioned with the project |
| When it runs | After the worktree exists and before the session opens. The core creates the worktree with `git worktree add` for both harnesses; the Claude Code hook only prints the path. Alternative discarded: running it inside the `WorktreeCreate` hook for Claude Code and after `herdr worktree create` for Codex, two paths under the hook's timeout |
| Failed or timed out preparation | `launch-failed` with branch and worktree in `created`, no session or agent, exit `1`; output only in a registry log; fixed limit of 10 minutes. Alternative discarded: starting the agent anyway with a warning |
| Lock during the preparation | A task lock held by the `dispatch` for its whole run; the project lock is released while the preparation runs. Recovery and `status` read the task lock. Alternative discarded: preparing under the project lock, which refuses a parallel `dispatch` with `project-locked` after 30 s |
| Busy task lock | `resume`, `collect` and `close` refuse with `task-busy`, without waiting on a task lock while holding the project lock. Alternative discarded: releasing the project lock to wait up to 30 s for the task lock |
| Descendants of a preparation command | A command is done when its process group is empty; survivors are killed and fail the preparation. Alternative discarded: the leader's exit code alone |
| Git hooks at worktree creation | Suppressed with `core.hooksPath`; checkout filters still run. Alternative discarded: keeping hooks and bounding them like the preparation |
| Identity after the preparation | Branch and worktree `HEAD` checked against the base commit before any session, for both harnesses. Alternative discarded: only documenting it and relying on the Claude Code launch check |

The four decisions above came from the [critique of TC-0004](verification/2026-11-14-tc-0004-grill.md)
by Codex in `gpt-6-astra`, role `radiant-grill`: nine objections, all
accepted by the owner on 2026-11-15. The other five changed the Spec without
a new decision: the preparation's process group named in the recovery
reason, rereading a task after taking
its lock, publishing recovery only past all refusals, the definition of an
absent `.demerzel.json`, and a read-only `status`.

