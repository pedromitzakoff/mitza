# MITZA Operational Card Architecture 2.0 — Steve Jobs Review

Esta etapa não melhora o card da Sprint. Questiona sua existência, elemento
por elemento, e remove o que não sobrevive à pergunta: *"se isso
desaparecesse, o gestor sentiria falta imediatamente, ou só perceberia
depois?"*

Escopo: `SprintCardBody`/`SprintCard` (`src/app/clients/sprint-card.tsx`) —
o card compartilhado entre a página do Cliente e as 3 visões de Sprints.
Nenhum dado, cálculo, query ou permissão mudou. Nenhuma linha nova foi
adicionada — só remoção, ocultação por intenção e reordenação.

---

## Por que este componente, e não outro

O card da Sprint é o ponto mais lido e mais reaberto da plataforma: é onde
o gestor passa a maior parte do tempo operacional (marcar tarefa,
registrar otimização, atualizar performance). Se existe um lugar onde
"cada elemento precisa se justificar", é aqui.

---

## Auditoria — questionando cada elemento

### 1. O resumo fechado (`<summary>`)

Já contém: período, badge temporal (Sprint atual/Concluída/Futura),
"R$X investidos", performance compacta, "Y/Z tarefas", "N otimizações". Já
é a "leitura de 3 segundos" — permanece intocado (é exatamente o padrão
que esta auditoria quer proteger, não atacar).

### 2. "Performance da sprint" (toolbar sempre visível)

**Pergunta:** o gestor precisa ver Investido/Resultados/Custo por
resultado/Objetivo *toda vez* que abre a Sprint, mesmo quando só quer
marcar uma tarefa?

**Resposta:** não. O resumo fechado (item 1) já mostra a versão compacta
("32 leads · CPL R$25") sempre que a tela é ≥ 640px — a caixa cheia
(sempre montada, com fundo e borda) repetia quase a mesma informação, só
com mais detalhe (comparação com a meta) e os botões de edição. Se essa
caixa desaparecesse, o gestor sentiria falta **só quando** quisesse
comparar com a meta ou editar o número — nunca no primeiro olhar. Virou
**disclosure**, exatamente como Comentários (Princípio 2: nasce escondida,
só aparece com intenção).

### 3. "Última execução: Hoje/Ontem/Há N dias úteis"

**Pergunta:** essa linha ajuda a tomar a próxima decisão?

**Resposta:** só quando sinaliza atraso (âmbar/vermelho). No caso neutro
(sprint sendo executada normalmente), ela é só texto cinza confirmando que
está tudo bem — nenhuma decisão nasce dali. Existia **sempre que havia
dado**, não só quando havia sinal. Isso é exatamente o que o Princípio 2
proíbe ("nunca porque há espaço disponível"). Passou a existir **só**
quando `executionSeverity` é `atencao`/`critico` — no caso saudável, a
linha simplesmente não é renderizada.

### 4. "Próxima ação"

**Pergunta:** por que isso existe? Ajuda a decidir?

**Resposta:** sim — é literalmente a resposta a "o que eu faço agora?"
(Princípio 5). Não só sobrevive, como **sobe pro topo** do corpo expandido:
é a primeira coisa que o gestor deveria ler ao abrir a Sprint, não a
quarta.

### 5. Tarefas + Otimizações lado a lado

**Pergunta:** isso pode virar "apenas um resumo" (convite explícito da
etapa)?

**Resposta, depois de questionar de verdade:** não. Diferente de
Performance (consulta) e Comentários (discussão), Tarefas é a própria
EXECUÇÃO — marcar uma tarefa como feita é a ação mais frequente de toda a
plataforma (todo o investimento em otimismo de UI, formulários inline e
drawers, construído em etapas anteriores, existe exatamente pra essa
lista). Reduzi-la a um resumo esconderia a própria razão de existir do
card e adicionaria um clique extra à ação mais comum do produto — o
oposto de "menos esforço mental". Permanece sempre visível, sem
disclosure, e sobe para logo depois de "Próxima ação" (era a 4ª coisa,
agora é a 2ª).

### 6. Comentários

Já era disclosure, já fechado por padrão. Nenhuma mudança — é o modelo que
Performance passou a seguir.

### 7. "Abrir cliente" (só no painel Sprints)

Um link de texto, sem caixa, no fim do card. Já mínimo. Sem mudança.

### 8. Containers

Antes: Performance tinha uma caixa cheia sempre montada (borda + fundo).
Depois: vira um botão pill fechado por padrão (mesma "caixa" de
Comentários) — o container caro só existe quando alguém pede pra ver.
Cogitei fundir Performance e Comentários num único disclosure ("Mais
detalhes") para reduzir ainda mais — descartei: são categorias mentais
diferentes (números financeiros com ações de edição vs. uma conversa em
texto livre); misturar as duas atrás de um rótulo ambíguo pioraria a
previsibilidade ("o que tem lá dentro?"), trocando um container por
confusão. Dois disclosures pequenos e nomeados continuam mais claros que
um disclosure grande e genérico.

---

## Nova arquitetura do card aberto

**Antes:** Performance (caixa sempre aberta) → Última execução (sempre,
mesmo neutra) → Próxima ação → Tarefas/Otimizações → Comentários
(disclosure) → Abrir cliente.

**Depois:** Próxima ação → Última execução (só se exigir atenção) →
Tarefas/Otimizações → Performance (disclosure) → Comentários (disclosure)
→ Abrir cliente.

A regra por trás da nova ordem: **o que é decisão vem primeiro, sempre
visível; o que é consulta vem depois, escondido até a intenção.**

---

## Antes e depois de cada mudança

### 1. Performance da sprint
- **Antes:** `<div className="rounded-lg border ... bg-zinc-50">` sempre
  renderizada, com Investido/Resultados/Custo/Objetivo/ações visíveis o
  tempo todo, entre a linha fechada e o resto do card.
- **Depois:** `<details>` fechado por padrão — botão "Performance ▸" (mesmo
  padrão visual de "Comentários ▸"); o mesmo conteúdo (nenhum campo, ação
  ou fórmula removida) só aparece com um clique.
- **Por quê:** o resumo fechado da Sprint já mostra a versão compacta desses
  mesmos números. Manter a versão detalhada sempre montada era pagar o
  custo de um container cheio (Princípio 4) por uma informação de consulta
  (Princípio 2), competindo visualmente com Tarefas/Otimizações — a real
  área de execução.
- **Esforço mental:** o gestor que só quer marcar uma tarefa não precisa
  mais "passar visualmente" por uma toolbar financeira densa pra chegar
  lá — a Sprint aberta mostra menos coisas ao mesmo tempo.

### 2. Última execução
- **Antes:** sempre visível quando havia sprint atual, mesmo em texto
  cinza neutro sem nenhum sinal de atenção.
- **Depois:** só renderiza quando `executionSeverity` é `atencao` ou
  `critico` — no caso saudável, a linha não existe.
- **Por quê:** texto sem cor de urgência não muda nenhuma decisão; é
  ruído que "existia porque havia espaço". Quando existe sinal real
  (sprint parada há dias), continua aparecendo — nada de decisão-relevante
  foi perdido.
- **Esforço mental:** uma linha a menos para ler em toda sprint saudável
  (a maioria) — o olho só encontra esse texto quando ele de fato importa.

### 3. Próxima ação
- **Antes:** 3ª posição no corpo expandido (depois de Performance e Última
  execução).
- **Depois:** 1ª posição — a primeira coisa visível ao abrir a Sprint.
- **Por quê:** é a resposta direta e única a "o que eu faço agora?"
  (Princípio 5) — não deveria competir por atenção com uma toolbar
  financeira antes dela.
- **Esforço mental:** zero scroll/leitura intermediária entre "abri a
  Sprint" e "sei o que fazer".

### 4. Tarefas + Otimizações
- **Antes:** 4ª posição, depois de Performance/Última execução/Próxima
  ação.
- **Depois:** 2ª posição, logo depois de Próxima ação.
- **Por quê:** é a área de execução de verdade — mais usada, mais
  interativa. Considerei reduzi-la a um resumo (convite explícito da
  etapa) e decidi que seria regressão, não simplificação: esconderia a
  própria razão de abrir o card.
- **Esforço mental:** o gestor chega mais rápido no lugar onde realmente
  age.

---

## Por que a nova Sprint exige menos esforço mental

1. **Menos coisas montadas ao mesmo tempo.** Antes, abrir uma Sprint
   renderizava (sempre) uma toolbar financeira completa + uma linha de
   atividade + a ação recomendada + tarefas/otimizações + um botão de
   comentários. Agora, na maioria das sprints saudáveis, o gestor vê: a
   ação recomendada + as tarefas/otimizações + dois botões fechados
   (Performance/Comentários). Menos blocos = menos decisões de "isso
   importa pra mim agora?" que o cérebro precisa descartar.
2. **A ordem agora segue a prioridade real da decisão**, não a ordem em
   que as seções foram implementadas historicamente (Performance estava
   primeiro porque uma etapa anterior a promoveu por ser "a informação
   principal" — mas "principal" pra consulta não é o mesmo que "primeiro"
   pra decisão).
3. **Cor e destaque só aparecem quando há sinal real** (Última execução) —
   antes, um texto neutro em toda sprint saudável treinava o olho a
   ignorar essa linha, o que é o oposto de um sistema de atenção
   confiável.

---

## O que foi considerado e descartado

- **Fundir Tarefas e Otimizações num resumo único** — descartado: destruiria
  a área de execução mais usada da plataforma.
- **Fundir Performance e Comentários num disclosure único** — descartado:
  categorias mentais diferentes, um rótulo genérico ("Mais detalhes")
  reduziria previsibilidade sem reduzir esforço real.
- **Remover "Última execução" por completo** — descartado: no caso
  atenção/crítico, é um sinal genuíno que o gestor sentiria falta
  imediatamente (sprint parada sem ninguém notar).
- **Remover o resumo fechado (`<summary>`)** — nem cogitado: já é
  exatamente o "one screen, one glance" que esta auditoria protege, não
  ataca.

---

## Arquivos alterados

- `src/app/clients/sprint-card.tsx` — única alteração desta etapa.

## Validação

- `tsc --noEmit`: limpo.
- `eslint`: limpo.
- `next build`: limpo, todas as rotas geradas normalmente.
- Sem suíte de testes automatizada no repositório.
- Nenhuma query, cálculo, prop de dado ou regra de permissão foi alterada
  — `SprintPerformanceSection` e `computeNextAction`/`computeSprintExecutionInfo`
  continuam exatamente as mesmas funções, só a condição/posição de
  renderização mudou.

## Limitações

- A auditoria foi feita sobre `SprintCardBody`/`SprintCard` especificamente
  (o pedido cita "a Sprint"); não se estende a `AccountCardSummary` (o
  resumo fechado de conta na tela Sprints, já auditado e reorganizado na
  etapa "Operational Tables 1.0") nem a outras telas.
- Sem navegador interativo neste ambiente para captura de tela real — a
  validação de "3 segundos" foi feita por leitura de código e da ordem
  real de renderização, não por teste de usuário cronometrado.
