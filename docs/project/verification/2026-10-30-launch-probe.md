# Prova de lançamento

Data: 2026-10-30
Plan: [revisão 0.2](../PLAN.md), incremento 1
Spec: [revisão 0.3](../SPEC.md)
Referência Radiant: 6b129752b6687598e9bc3582c1c89c7ee6d71aee
Estado: **HOLD**. Com o worktree criado pelo herdr, o ponto de parada foi
atingido para o Claude Code. Com o worktree criado pelo próprio Claude Code
(`--worktree`), os dois harnesses passam no critério, mas isso diverge da
Spec 0.3, que precisa mudar antes do incremento 2. A decisão é do owner.

## Ambiente

- herdr 0.9.0, servidor na sessão nomeada `lab`.
- Claude Code 2.1.286, modelo `claude-sonnet-5-5`.
- Codex 0.166.0, modelo `gpt-6.1-sol`. A prova começou na 0.163.0; no
  segundo startup o Codex mostrou um aviso de atualização antes do diálogo de
  confiança, e o owner atualizou.
- Repositório Git descartável, criado para a prova num diretório temporário
  da sessão do orquestrador, com worktrees numa pasta `wt/` ao lado dele.
- Orquestrador: sessão Claude Code fora do herdr, chamando
  `herdr --session lab`. Nenhum diálogo foi respondido pelo orquestrador.

## Método

Antes dos lançamentos contados, o owner confiou uma vez em cada CLI, como
na autenticação inicial: no Claude Code, na pasta-mãe `wt/`; no Codex, num
worktree do repositório, o que o Codex aplica à raiz do repositório.

Cada lançamento, por um script do orquestrador:

1. `herdr worktree create --cwd <repo> --branch probe/<id> --base main --path wt/r-<id> --label dz-probe-<id> --no-focus`,
   com `--trust-repository` nos cinco primeiros de cada harness;
2. `herdr agent start dzp<id> --kind <claude|codex> --pane <root_pane> --timeout 90000 -- <modelo e esforço>`;
3. se pronto: `herdr agent prompt dzp<id> "<pedido curto, sem ferramentas>" --wait --until working --until blocked --timeout 30000`,
   seguido de `herdr agent wait` até o fim do turno;
4. se bloqueado: leitura da tela e nenhuma resposta;
5. `herdr workspace close`.

Os dados brutos estão em
[2026-10-30-launch-probe.jsonl](2026-10-30-launch-probe.jsonl).

## Resultado

| Harness | Lançamentos com repositório confiável | Intervenção pedida | Sem `--trust-repository` |
| --- | --- | --- | --- |
| Claude Code | 5 | 5 de 5, diálogo de confiança na pasta do worktree | 1 de 1, mesmo diálogo |
| Codex | 5 | 0 de 5 | 0 de 1 |

- Claude Code: `agent start` voltou em cerca de 4,9 s com o agente
  `blocked`. A tela era o diálogo "Is this a project you created or one you
  trust?", com "No, exit" selecionado. A confiança na pasta-mãe `wt/`
  estava registrada no `~/.claude.json` e não cobriu as subpastas.
- Codex: `agent start` pronto em cerca de 4,9 s; `agent prompt` voltou em
  0,6 s com o agente em `working`; o turno terminou em `done` entre 0,9 s e
  2,4 s. Os cinco níveis `minimal`, `low`, `medium`, `high` e `xhigh` em
  `-c model_reasoning_effort=` iniciaram sem erro visível.

## Leitura

- Critério do Plan: intervenção em mais de um dos cinco lançamentos de um
  harness derruba a hipótese antes do Build. O Claude Code teve 5 de 5; o
  Codex, 0 de 5.
- O `--trust-repository` do herdr 0.9.0 não mudou nada nos dois CLIs. A
  confiança é decidida pelo próprio harness. A Spec 0.3, seção 2.4, supõe
  que fora de `trusted_repositories` o prompt de confiança aparece e dentro
  não; isso não se sustenta.
- Codex: a confiança é por raiz de repositório e cobre worktrees novos. A
  mecânica de lançamento funciona sem intervenção depois da confiança única.
- Claude Code: a confiança é por path exato, inclusive para worktrees de um
  repositório confiável cuja pasta-mãe também é confiável. Como o Demerzel
  cria um worktree por tarefa, cada despacho para o Claude Code pararia nesse
  diálogo.
- Spec 0.3, envio do pedido: `--until working --until blocked` voltou com o
  agente trabalhando, como previsto. Confirmado só no Codex.
- O que esta prova não diz: se a unidade carrega contexto suficiente, e os
  níveis de esforço aceitos pelo Claude Code, que não chegou a iniciar.

## Segunda prova: worktree criado pelo Claude Code

Pergunta: o `claude --worktree <nome>` (opção `-w` do `claude --help`
2.1.286), iniciado na raiz de um repositório confiável, evita o diálogo de
confiança?

Método: o owner confiou uma vez na raiz do repositório descartável no
Claude Code. Cada lançamento abriu um workspace com
`herdr workspace create --cwd <repo>` e iniciou
`herdr agent start --kind claude -- --worktree dz-w<n> --model claude-sonnet-5-5 --effort <nível>`,
seguido do mesmo envio, espera e fechamento da primeira prova. Dados em
[2026-10-30-launch-probe-claude-worktree.jsonl](2026-10-30-launch-probe-claude-worktree.jsonl).

| Rodada | Lançamentos | Diálogo de confiança | Pedido virou trabalho |
| --- | --- | --- | --- |
| 1 (`dz-w1` a `dz-w5`) | 5 | 0 de 5 | 0 de 5: "Login expired", o CLI estava sem login |
| 2 (`dz-w7` a `dz-w11`), depois do `/login` do owner | 5 | 0 de 5 | 5 de 5 |

- Na rodada 2, `agent start` ficou pronto em cerca de 4,9 s; `agent prompt`
  voltou entre 0,5 s e 0,6 s com o agente em `working`; o turno terminou em
  `done` entre 1,8 s e 6,0 s. O envio com `--until working --until blocked`
  fica confirmado também no Claude Code.
- Os níveis `low`, `medium`, `high`, `xhigh` e `max` iniciaram sem erro.
- A falta de login é a autenticação inicial que o critério do Plan exclui,
  mas mostra que o pré-requisito "CLIs autenticados" precisa ser conferido
  antes de cada prova: o envio deu `agent_prompt_stalled`, sem erro próprio.

Diferenças em relação à Spec 0.3, observadas no repositório descartável:

- o worktree fica em `<repo>/.claude/worktrees/<nome>`, não em
  `<registro do projeto>/worktrees/<id>`, e o Git o marca como `locked`;
- o branch se chama `worktree-<nome>`, não `branch_prefix + id`;
- o repositório ganha `.claude/` não rastreado, que precisa estar ignorado;
- a base do worktree não foi escolhida pelo orquestrador; nesta prova todos
  partiram do único commit de `main`. Como escolher a base continua sem
  prova;
- o herdr só vê o pane no cwd do repositório; o cwd do agente aparece em
  `foreground_cwd`.

## Recursos que sobraram

Os workspaces das duas provas foram fechados. No repositório descartável
ficaram 14 worktrees com branches `probe/*`, criados pelo herdr, e 11
worktrees `locked` em `.claude/worktrees/` com branches `worktree-dz-w*`,
criados pelo Claude Code; o descarte fica com o owner. A confiança
registrada para a prova continua no `~/.claude.json` (pasta `wt/` e raiz do
repositório) e no `~/.codex/config.toml` (raiz do repositório).
