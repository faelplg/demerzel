# Project Frame: Demerzel

Revisão do Frame: 0.1, 2026-10-17
Referência Radiant: c5cf46774fe567b49d7f5af1e22056286a14f1db

A decisão que origina este produto é o ADR-0002 do Radiant
(`docs/adrs/ADR-0002-backend-dispatch-demerzel.md` no checkout indicado pelo
pin). Este Frame não repete o desenho do ADR; quando divergirem sobre o papel
ou as fronteiras do Demerzel, o ADR prevalece até ser emendado.

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

- Lê o contrato e as regras de roteamento do usuário
  (`$XDG_CONFIG_HOME/radiant/routing.json`, formato em `docs/routing.md` do
  Radiant). Grava apenas seu registro de despachos, em
  `$XDG_STATE_HOME/demerzel/`, por projeto.
- Valida e executa a regra escolhida pelo orquestrador. Não divide o trabalho,
  não escolhe a regra e não aceita entregas: o retorno é o Completion report,
  e o aceite fica com o orquestrador e o verificador.
- Consome o Radiant por `radiant_revision` e `check_project.py`, como qualquer
  consumidor. Pin divergente impede o despacho.
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

Alternativas descartadas no ADR-0002: Radiant como runtime de agentes, camada
de operação dentro do repositório Radiant, adotar o firstmate como camada de
execução, contrato inteiro como unidade de despacho e harness ou modelo
nomeados no contrato. A alternativa menor continua disponível: o subagente
nativo de cada harness. O Radiant funciona sem o Demerzel.

## Menor experimento

Um contrato real com duas unidades independentes num consumidor real, uma
roteada para Claude Code e outra para Codex, ambas em abas do herdr, com
`collect` devolvendo os dois Completion reports e o orquestrador fazendo o
aceite.

Evidência: registro de despachos, snapshot do herdr, os relatórios e os diffs.

A hipótese é refutada quando:

- despachar custa mais tempo ou atenção do owner do que montar à mão;
- a maioria dos contratos precisa de amendment na divisão;
- o lançamento trava com frequência em prompts de confiança ou autenticação;
- o orquestrador ainda precisa colar contexto no pedido.

## Fronteiras

O Demerzel nunca:

- altera contratos ou muda escopo;
- faz merge, push, abertura de PR ou remoção de branch;
- apaga worktree ou branch sem flag explícita de descarte dada pelo humano;
- responde prompts de permissão; em `blocked`, reporta ao orquestrador, que
  leva ao humano;
- rebaixa capacidade em silêncio; sem candidato viável na capacidade pedida, a
  unidade fica em HOLD;
- passa secrets no pedido; o pedido leva só paths, e o conteúdo do contrato
  não sai da máquina.

Todas as verificações rodam antes do primeiro efeito, e recusas não criam
nada. A lista de recusas está na seção 4 do ADR-0002.

Fora de escopo:

- interface de observação e gestão, que terá desenho próprio;
- adapters Radiant para outros harnesses;
- backends além do herdr;
- execução em nuvem ou em host remoto;
- escolha automática de regra sem o orquestrador;
- alterações na Constitution do Radiant.

Questões em aberto, para Spec ou Plan:

- versão mínima do herdr; o ADR exige uma e registra apenas a 0.9.0 como
  conferida em 2026-10-16;
- qual consumidor real recebe o menor experimento;
- path e formato da configuração do Demerzel, que guarda o prefixo de branch e
  a opção de `--trust-repository`.
