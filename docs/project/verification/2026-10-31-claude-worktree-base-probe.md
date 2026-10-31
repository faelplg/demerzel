# Prova de base do worktree do Claude Code

Data: 2026-10-31
Plan: [revisão 0.2](../PLAN.md), incremento 1
Spec: [revisão 0.3](../SPEC.md)
Referência Radiant: 6b129752b6687598e9bc3582c1c89c7ee6d71aee
Estado: **PASS** para a pergunta desta prova. Um hook `WorktreeCreate`
passado por `--settings` deixa o Demerzel escolher path, branch e base do
worktree do Claude Code, sem diálogo de confiança. A
[prova de lançamento](2026-10-30-launch-probe.md) ficou em HOLD porque o
worktree do Claude Code fugia da Spec 0.3; esta prova mostra como manter a
Spec nesse ponto.

## Pergunta

O `claude --worktree <nome>`, iniciado na raiz de um repositório confiável,
consegue partir de um commit escolhido pelo orquestrador, e não só da base
que o próprio Claude Code escolhe?

## O que a documentação diz

A página [Worktrees](https://code.claude.com/docs/en/worktrees.md) do Claude
Code, lida em 2026-10-31:

- a base padrão (`worktree.baseRef: "fresh"`) é o branch padrão do remoto,
  `origin/HEAD`; sem remoto, o `HEAD` local;
- `worktree.baseRef: "head"` usa o `HEAD` local;
- `worktree.baseRef` não aceita nome de branch nem commit;
- um hook `WorktreeCreate` substitui a criação padrão por inteiro. O hook de
  comando imprime o path do worktree no stdout, e saída diferente de 0 faz a
  criação falhar;
- um nome de worktree que já existe reabre o worktree em vez de criar outro.

## Ambiente

Os mesmos da prova de lançamento: herdr 0.9.0 na sessão `lab`, Claude Code
2.1.286 com `claude-sonnet-5-5`, repositório Git descartável cuja raiz o
owner confiou uma vez no Claude Code. Nenhum diálogo foi respondido pelo
orquestrador.

O repositório ganhou três bases distinguíveis:

| Ref | Commit | Conteúdo |
| --- | --- | --- |
| `origin/main`, `origin/HEAD` | c1 `05b03ce` | o commit inicial, num remoto bare local |
| `main` | c2 `e9cdbef` | c1 mais `.gitignore` com `.claude/worktrees/`, sem push |
| `feat`, checado na raiz | c3 `437dbef` | c2 mais uma linha no `README.md` |

## Método

Cada lançamento abriu um workspace com
`herdr workspace create --cwd <repo> --no-focus`, iniciou
`herdr agent start --kind claude -- --worktree dz-<id> <extra> --model claude-sonnet-5-5 --effort <nível>`,
enviou o pedido curto com `--wait --until working --until blocked`, esperou o
fim do turno e fechou o workspace. Antes e depois do fechamento, leu
`git worktree list --porcelain`.

| Lançamento | `<extra>` |
| --- | --- |
| `b1` | nada |
| `b2` | `--settings '{"worktree":{"baseRef":"head"}}'` |
| `h1` a `h5` | `--settings` com um hook `WorktreeCreate` que roda `git -C <repo> worktree add -b radiant/dz-<id> <wt2>/dz-<id> <c2>` com a saída do Git no stderr, e imprime só o path |

A pasta `wt2/` fica fora de qualquer repositório e não foi confiada. O hook
também gravou o JSON que recebeu. Dados em
[2026-10-31-claude-worktree-base-probe.jsonl](2026-10-31-claude-worktree-base-probe.jsonl).

## Resultado

| Lançamento | Diálogo | Pedido virou trabalho | Base | Path e branch | Lock |
| --- | --- | --- | --- | --- | --- |
| `b1` | não | sim | c1, `origin/HEAD` | `.claude/worktrees/dz-b1`, `worktree-dz-b1` | sim |
| `b2` | não | sim | c3, `HEAD` da raiz | `.claude/worktrees/dz-b2`, `worktree-dz-b2` | sim |
| `h1` a `h5` | 0 de 5 | 5 de 5 | c2, o commit passado ao hook | `wt2/dz-h<n>`, `radiant/dz-h<n>` | não |

- Tempos iguais aos da prova de lançamento: `agent start` em cerca de 4,9 s,
  envio em 0,6 s com o agente em `working`, turno em `done` entre 1,4 s e
  8,2 s.
- `low`, `medium`, `high`, `xhigh` e `max` iniciaram sem erro com o hook.
- O `foreground_cwd` do agente no herdr foi o path impresso pelo hook. O
  pane do herdr continua na raiz do repositório.
- O hook recebeu `session_id`, `transcript_path`, `cwd` (a raiz do
  repositório), `hook_event_name` e `name`, o nome passado a `--worktree`.
- Com o hook, nada foi criado dentro do repositório nem dentro do worktree
  além do checkout: sem `.claude/`, sem lock. O worktree e o branch
  continuaram iguais depois de `herdr workspace close`.
- Sem o hook, os locks de `b1` e `b2` citam o pid do processo do Claude Code
  e continuaram depois do fechamento. Pela documentação, uma varredura
  posterior do Claude Code libera locks de processos encerrados.

## Leitura

- A base do `--worktree` sem hook não serve ao Demerzel: `"fresh"` ignora
  commits locais e `"head"` segue o checkout de quem chama, e nenhum dos dois
  aceita o commit base que a integração Radiant resolve.
- Com o hook, o Claude Code segue a Spec 0.3 em path, branch e base, como o
  `herdr worktree create` faz para o Codex. A diferença fica só em quem cria
  o worktree.
- A confiança do Claude Code é conferida no diretório de lançamento, a raiz
  confiável. O path do worktree não passou por diálogo, embora fosse uma
  pasta nunca confiada.

## O que esta prova não diz

- O que acontece se o projeto consumidor também tiver um hook
  `WorktreeCreate` ou `disableAllHooks` nas próprias configurações.
- O que o Claude Code faz se o humano sair da sessão pela aba e escolher
  remover o worktree, sem um hook `WorktreeRemove`.
- O comportamento numa raiz não confiada; a documentação diz que o
  `--worktree` interativo sai com erro.
- Se um commit base diferente do `HEAD` da raiz muda o que o Claude Code
  carrega no startup, como `CLAUDE.md` e configurações do projeto.

## Recursos que sobraram

No repositório descartável: os worktrees `dz-b1` e `dz-b2` (travados) e
`wt2/dz-h1` a `wt2/dz-h5`, com seus branches; o remoto bare `origin.git`; e
o arquivo com a entrada do hook. O descarte fica com o owner, junto com os
recursos da prova de lançamento.
