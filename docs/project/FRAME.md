# Project Frame: Demerzel

Revisão do Frame: 0.2, 2026-10-17
Referência Radiant: c5cf46774fe567b49d7f5af1e22056286a14f1db

O Demerzel nasceu do ADR-0002 do Radiant. Em 2026-10-17 o owner decidiu que
ele continua sendo mecânica de despacho, mas genérico: núcleo próprio e Radiant
como integração opcional. Essa decisão está proposta no Radiant como ADR-0003
([faelplg/radiant#22](https://github.com/faelplg/radiant/pull/22)), que
substitui em parte o ADR-0002. O Radiant é o processo usado para desenvolver o
Demerzel; não é dependência do núcleo em tempo de execução.

## Intenção e participante

Participantes: o owner e a sessão orquestradora, que é a sessão principal com
o humano. O Demerzel é uma ferramenta que o orquestrador chama no lugar da
ferramenta nativa de subagente, e que o humano também pode chamar.

Problema: montar uma subtarefa hoje exige criar worktree e branch, abrir uma
aba, escolher harness e modelo, iniciar o harness e colar contexto à mão. O
subagente nativo de cada harness evita parte disso, mas prende a subtarefa ao
harness da sessão principal e não deixa a divisão registrada.

Transformação: uma tarefa delimitada vira uma sessão do harness roteado, numa
aba própria do herdr, com estado acompanhável e retorno coletável pelo
orquestrador, em qualquer projeto. Num projeto Radiant, as unidades do bloco
`radiant-units` de um Task Contract viram essas tarefas sem perder as
garantias do Radiant.

## Papel

O Demerzel responde: como uma tarefa vira uma sessão rodando, e em que estado
ela está?

- Núcleo: formato de tarefa, catálogo de harnesses (como lançar cada um, o que
  cada um oferece, modelo por capacidade), regras de roteamento, backend,
  registro de despachos e supervisão. Catálogo, regras e configuração ficam no
  nível do usuário; o registro fica em `$XDG_STATE_HOME/demerzel/`, por
  projeto. O núcleo não conhece Radiant.
- Integração Radiant, ativa quando o projeto tem `.radiant.json`: lê
  `radiant-units`, passa pelo gate de pin com `check_project.py`, aceita só
  harness com adapter Radiant, resolve modelo e requisitos pelos arquivos do
  adapter e espera o Completion report em `.radiant/reports/`. Cumpre as
  regras de conduta de despacho do Radiant.
- O Demerzel não tem julgamento: não divide o trabalho, não escolhe a regra e
  não aceita entregas. Valida e executa a regra escolhida pelo orquestrador; o
  aceite fica com o orquestrador e, num projeto Radiant, com o verificador.
- Stack: Bun e TypeScript. A interface principal é um CLI não interativo, com
  saída `--json`, códigos `0` (ok), `1` (achados ou estado pendente) e `2`
  (recusa sem efeito), e erros que dizem o que fazer em seguida. O herdr é o
  primeiro backend, atrás de uma interface própria do Demerzel.

## Hipótese e Challenge

Hipótese: um operador que despacha tarefas delimitadas por regras de
roteamento torna a delegação entre harnesses mais barata para o owner do que
montá-la à mão, sem tirar do orquestrador e do humano o aceite e as decisões
irreversíveis, e sem exigir que o projeto use Radiant.

Premissas críticas:

- a tarefa carrega o necessário para configurar a sessão, sem contexto colado
  no pedido;
- o herdr expõe o suficiente para lançar e acompanhar a sessão (criar
  worktree, iniciar agente, enviar pedido, ler estado);
- Claude Code e Codex, lançados num terminal, iniciam sem intervenção
  frequente.

Alternativas descartadas: Radiant como runtime de agentes, camada de operação
dentro do Radiant, adotar o firstmate como camada de execução e harness ou
modelo nomeados no contrato (ADR-0002); Demerzel acoplado ao Radiant em tempo
de execução e Demerzel como orquestrador com julgamento (decisão de
2026-10-17). A alternativa menor continua disponível: o subagente nativo de
cada harness.

## Menor experimento

Um contrato real com duas unidades independentes num consumidor Radiant real,
uma roteada para Claude Code e outra para Codex, ambas em abas do herdr, com
`collect` devolvendo os dois Completion reports e o orquestrador fazendo o
aceite. A independência do núcleo é provada pela suíte do Demerzel, que roda o
fluxo do núcleo com backend falso e sem Radiant no ambiente.

Evidência: registro de despachos, snapshot do herdr, os relatórios, os diffs e
a execução da suíte sem Radiant.

A hipótese é refutada quando:

- despachar custa mais tempo ou atenção do owner do que montar à mão;
- a maioria dos contratos precisa de amendment na divisão;
- o lançamento trava com frequência em prompts de confiança ou autenticação;
- o orquestrador ainda precisa colar contexto no pedido;
- o núcleo precisa de um checkout Radiant para despachar uma tarefa sem
  `.radiant.json`.

## Fronteiras

O Demerzel nunca:

- altera a tarefa, o contrato ou o escopo;
- faz merge, push, abertura de PR ou remoção de branch;
- apaga worktree ou branch sem flag explícita de descarte dada pelo humano;
- responde prompts de permissão; em `blocked`, reporta ao orquestrador, que
  leva ao humano;
- rebaixa capacidade em silêncio; sem candidato viável na capacidade pedida, a
  tarefa fica em HOLD;
- passa secrets no pedido; o pedido leva só paths, e o conteúdo da tarefa não
  sai da máquina.

Todas as verificações rodam antes do primeiro efeito, e recusas não criam
nada. As recusas estão na seção 4 do ADR-0002, com a divisão entre núcleo e
integração da seção 3 do ADR-0003.

Fora de escopo:

- interface de observação e gestão, que terá desenho próprio;
- Demerzel como orquestrador com julgamento, incluindo escolha automática de
  regra;
- integrações com outros processos além do Radiant;
- adapters Radiant para outros harnesses;
- backends além do herdr;
- execução em nuvem ou em host remoto;
- alterações na Constitution do Radiant.

Questões em aberto, para Spec ou Plan:

- formato de tarefa do núcleo e formato do catálogo;
- formato e path das regras de roteamento e da configuração do Demerzel, que
  guarda o prefixo de branch e a opção de `--trust-repository`;
- versão mínima do herdr; o ADR-0002 exige uma e registra apenas a 0.9.0 como
  conferida em 2026-10-16;
- qual consumidor real recebe o menor experimento.
