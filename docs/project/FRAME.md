# Project Frame: Demerzel

Revisão do Frame: 0.3, 2026-10-17
Referência Radiant: 33fd4efb482bc83564e868e6d9c3859cb8de15e9

O Demerzel nasceu do ADR-0002 do Radiant. Em 2026-10-17 o owner decidiu que
ele continua sendo mecânica de despacho, com um núcleo que não depende do
Radiant e uma integração Radiant como única entrada no primeiro incremento.
Essa decisão foi aceita no Radiant como ADR-0003
(`docs/adrs/ADR-0003-demerzel-independent-core.md` no checkout indicado pelo
pin), que substitui em parte o ADR-0002. O Radiant também é o processo usado
para desenvolver o Demerzel.

## Intenção e participante

Participantes: o owner e a sessão orquestradora, que é a sessão principal com
o humano. O Demerzel é uma ferramenta que o orquestrador chama no lugar da
ferramenta nativa de subagente, e que o humano também pode chamar.

Problema: montar uma subtarefa hoje exige criar worktree e branch, abrir uma
aba, escolher harness e modelo, iniciar o harness e colar contexto e contrato
à mão. O subagente nativo de cada harness evita parte disso, mas prende a
subtarefa ao harness da sessão principal e não deixa a divisão registrada.

Transformação: cada unidade declarada no bloco `radiant-units` de um Task
Contract vira uma sessão do harness roteado, numa aba própria do herdr, com
estado acompanhável e retorno coletável pelo orquestrador.

## Papel

O Demerzel responde: como cada unidade vira uma sessão rodando, e em que
estado ela está?

- Núcleo: modelo interno de tarefa, montador do pedido, backend, registro de
  despachos em `$XDG_STATE_HOME/demerzel/`, por projeto, e supervisão. Recebe
  harness, modelo, esforço, paths e pedido já resolvidos e não conhece
  Radiant.
- Integração Radiant: acha o projeto pelo `.radiant.json`, lê `radiant-units`,
  passa pelo gate de pin com `check_project.py`, roteia pelas regras do
  usuário (`docs/routing.md` do Radiant) e pelos adapters Radiant, e espera o
  Completion report em `.radiant/reports/`.
- O Demerzel não tem julgamento: não divide o trabalho, não escolhe a regra e
  não aceita entregas. Valida e executa a regra escolhida pelo orquestrador; o
  aceite fica com o orquestrador e o verificador.
- Stack: Bun e TypeScript. A interface principal é um CLI não interativo, com
  saída `--json`, códigos `0` (ok), `1` (achados ou estado pendente) e `2`
  (recusa sem efeito), e erros que dizem o que fazer em seguida. O herdr é o
  primeiro backend, atrás de uma interface própria do Demerzel.

## Hipótese e Challenge

Hipótese: um operador externo que lê unidades declaradas no contrato e as
despacha por regras de roteamento torna a delegação entre harnesses mais
barata para o owner do que montá-la à mão, sem tirar do orquestrador e do
humano o aceite e as decisões irreversíveis.

Premissas críticas:

- a unidade carrega o necessário para configurar o subagente, sem contexto
  colado no pedido;
- o herdr expõe o suficiente para lançar e acompanhar a sessão (criar
  worktree, iniciar agente, enviar pedido, ler estado);
- Claude Code e Codex, lançados num terminal, iniciam sem intervenção
  frequente.

Alternativas descartadas: Radiant como runtime de agentes, camada de operação
dentro do Radiant, adotar o firstmate como camada de execução, contrato
inteiro como unidade de despacho e harness ou modelo nomeados no contrato
(ADR-0002); dependência do Radiant espalhada pelo núcleo, núcleo genérico
completo sem uso que o justifique e Demerzel como orquestrador com julgamento
(ADR-0003). A alternativa menor continua disponível: o subagente nativo de
cada harness.

## Menor experimento

Um contrato real com duas unidades independentes num consumidor Radiant real,
uma roteada para Claude Code e outra para Codex, ambas em abas do herdr, com
`collect` devolvendo os dois Completion reports e o orquestrador fazendo o
aceite. A fronteira do núcleo é provada pela suíte do Demerzel, que roda o
fluxo do núcleo com backend falso e sem checkout Radiant no ambiente.

Evidência: registro de despachos, snapshot do herdr, os relatórios, os diffs e
a execução da suíte sem Radiant.

A hipótese é refutada quando:

- despachar custa mais tempo ou atenção do owner do que montar à mão;
- a maioria dos contratos precisa de amendment na divisão;
- o lançamento trava com frequência em prompts de confiança ou autenticação;
- o orquestrador ainda precisa colar contexto no pedido;
- o núcleo precisa de um checkout Radiant para despachar uma tarefa já
  resolvida.

## Fronteiras

O Demerzel nunca:

- altera contratos ou muda escopo;
- faz merge, push, abertura de PR ou remoção de branch;
- apaga worktree ou branch sem flag explícita de descarte dada pelo humano;
- responde prompts de permissão; em `blocked`, reporta ao orquestrador, que
  leva ao humano;
- rebaixa capacidade em silêncio; sem candidato viável na capacidade pedida, a
  unidade fica em HOLD;
- embute conteúdo do contrato ou secrets no pedido; o pedido leva só paths.
  O harness lançado lê o contrato e o envia ao seu provedor de modelo como
  faria numa sessão aberta à mão, então rotear para um harness é também uma
  decisão de egress.

Todas as verificações rodam antes do primeiro efeito, e recusas não criam
nada. As recusas estão na seção 4 do ADR-0002; a seção 2 do ADR-0003 diz
quais a integração verifica.

Adiado, com condição para reabrir (ADR-0003):

- entrada genérica do núcleo e catálogo próprio de harnesses, quando houver um
  despacho real num projeto sem `.radiant.json`;
- formato de roteamento do Demerzel, quando o roteamento precisar de um fato
  que o Radiant não deve conhecer, como cota de uso por harness.

Fora de escopo:

- interface de observação e gestão, que terá desenho próprio;
- Demerzel como orquestrador com julgamento, incluindo escolha automática de
  regra;
- adapters Radiant para outros harnesses;
- backends além do herdr;
- execução em nuvem ou em host remoto;
- alterações na Constitution do Radiant.

Questões em aberto, para Spec ou Plan:

- modelo interno de tarefa do núcleo;
- path e formato da configuração do Demerzel, que guarda o prefixo de branch e
  a opção de `--trust-repository`;
- versão mínima do herdr; o ADR-0002 exige uma e registra apenas a 0.9.0 como
  conferida em 2026-10-16;
- qual consumidor real recebe o menor experimento.
