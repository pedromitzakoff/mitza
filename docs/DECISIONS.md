# Registro de Decisões

## Objetivo do documento

Registrar decisões arquiteturais e de produto relevantes e não-óbvias,
junto com o contexto que motivou cada uma, as alternativas consideradas e
a justificativa da escolha — para que o "porquê" de uma decisão nunca se
perca com o tempo nem precise ser redescoberto. Este documento não é um
changelog (não registra bugs corrigidos) nem um roadmap (não registra
planejamento futuro) — ele registra apenas decisões que alteram ou
definem a filosofia, a arquitetura ou o funcionamento do produto.

## Como deve ser utilizado

Consultado antes de questionar ou revisitar uma decisão já tomada — a
resposta pra "por que isso foi feito assim?" deve estar aqui. Cada entrada
nova segue o template padrão (ver capítulo 1), sempre adicionada ao final
da lista, nunca reescrevendo uma entrada antiga (decisões superadas ganham
uma entrada nova com status "Substituída", que referencia a anterior, em
vez de editar o registro original).

## Quem deve atualizá-lo

Quem toma ou implementa a decisão (dev ou agente responsável), com
aprovação do responsável de produto quando a decisão afetar filosofia ou
prioridade de produto.

## Quando deve ser atualizado

Sempre que uma decisão arquitetural ou de produto relevante e não-óbvia
for tomada — mudanças pequenas de código não devem entrar aqui. Ver
capítulo final ("Como adicionar novas decisões").

---

## Índice

- [Decisão 001: Sprint é a principal área operacional](#decisão-001-sprint-é-a-principal-área-operacional)
- [Decisão 002: Cada tela possui uma única responsabilidade](#decisão-002-cada-tela-possui-uma-única-responsabilidade)
- [Decisão 003: A plataforma trabalha para o gestor](#decisão-003-a-plataforma-trabalha-para-o-gestor)
- [Decisão 004: A plataforma não substitui ferramentas especializadas](#decisão-004-a-plataforma-não-substitui-ferramentas-especializadas)
- [Decisão 005: Operação antes de Performance](#decisão-005-operação-antes-de-performance)
- [Decisão 006: Arquitetura em módulos](#decisão-006-arquitetura-em-módulos)
- [Decisão 007: Fonte única da verdade](#decisão-007-fonte-única-da-verdade)
- [Decisão 008: A plataforma é um Sistema Operacional do Gestor](#decisão-008-a-plataforma-é-um-sistema-operacional-do-gestor)
- [Decisão 009: Card fechado do cliente também mostra tarefas e otimizações](#decisão-009-card-fechado-do-cliente-também-mostra-tarefas-e-otimizações)
- [Decisão 010: A Plataforma não é um ClickUp](#decisão-010-a-plataforma-não-é-um-clickup)
- [Decisão 011: Sprint é uma árvore operacional](#decisão-011-sprint-é-uma-árvore-operacional)
- [Decisão 012: A Sidebar é o único elemento estrutural fixo](#decisão-012-a-sidebar-é-o-único-elemento-estrutural-fixo)

## Capítulo 1 — Formato de uma Decisão

Toda decisão registrada neste documento segue o template abaixo. Copie o
bloco ao adicionar uma nova entrada.

```markdown
## Decisão XXX: <Título>

**Data:** <AAAA-MM-DD>
**Status:** Ativa | Substituída | Removida

### Contexto

### Problema

### Alternativas consideradas

### Decisão tomada

### Justificativa

### Impactos
```

> As 8 decisões abaixo são anteriores à criação deste documento e foram
> registradas retroativamente nesta etapa de documentação (14/07/2026).
> Por isso, os campos **Data**, **Problema**, **Alternativas consideradas**
> e **Impactos** aparecem marcados como "Não detalhado no registro
> original" sempre que a decisão original não especificou essa informação
> — nenhum conteúdo foi inventado para preenchê-los. Decisões futuras
> devem preencher todos os campos do template no momento em que a decisão
> for tomada.

## Decisão 001: Sprint é a principal área operacional

**Data:** Não detalhado no registro original (anterior à criação deste documento).
**Status:** Ativa.

### Contexto

Foi decidido que a plataforma não terá a página do cliente como principal
local de execução. A Sprint passa a ser a área onde o gestor trabalha
diariamente.

### Problema

Não detalhado no registro original.

### Alternativas consideradas

Não detalhado no registro original.

### Decisão tomada

Sprint é a principal área operacional da plataforma.

### Justificativa

Reduzir troca de contexto. Reduzir quantidade de cliques. Permitir
executar praticamente toda a rotina sem mudar de tela.

### Impactos

Não detalhado no registro original.

## Decisão 002: Cada tela possui uma única responsabilidade

**Data:** Não detalhado no registro original (anterior à criação deste documento).
**Status:** Ativa.

### Contexto

Não detalhado no registro original.

### Problema

Não detalhado no registro original.

### Alternativas consideradas

Não detalhado no registro original.

### Decisão tomada

Visão Geral decide. Sprint executa. Cliente investiga. Relatório
comunica.

### Justificativa

Evitar que as telas assumam papéis diferentes e acabem se tornando um
Frankenstein.

### Impactos

Não detalhado no registro original.

## Decisão 003: A plataforma trabalha para o gestor

**Data:** Não detalhado no registro original (anterior à criação deste documento).
**Status:** Ativa.

### Contexto

Não detalhado no registro original.

### Problema

Não detalhado no registro original.

### Alternativas consideradas

Não detalhado no registro original.

### Decisão tomada

Toda funcionalidade deve reduzir carga cognitiva. O gestor nunca deve
trabalhar para alimentar o sistema. A plataforma é quem deve trabalhar
para ele.

### Justificativa

Essa é a principal filosofia de UX da plataforma.

### Impactos

Não detalhado no registro original.

## Decisão 004: A plataforma não substitui ferramentas especializadas

**Data:** Não detalhado no registro original (anterior à criação deste documento).
**Status:** Ativa.

### Contexto

Não detalhado no registro original.

### Problema

Não detalhado no registro original.

### Alternativas consideradas

Não detalhado no registro original.

### Decisão tomada

Meta Ads continua sendo utilizado para anúncios. WhatsApp continua sendo
utilizado para comunicação. Google Drive continua sendo utilizado para
arquivos. A plataforma conecta contexto entre essas ferramentas.

### Justificativa

Evitar criar um ERP genérico.

### Impactos

Não detalhado no registro original.

## Decisão 005: Operação antes de Performance

**Data:** Não detalhado no registro original (anterior à criação deste documento).
**Status:** Ativa.

### Contexto

Não detalhado no registro original.

### Problema

Não detalhado no registro original.

### Alternativas consideradas

Não detalhado no registro original.

### Decisão tomada

Primeiro finalizar regras de negócio. Depois estabilizar. Depois otimizar
performance.

### Justificativa

Evitar otimizações prematuras.

### Impactos

Não detalhado no registro original.

## Decisão 006: Arquitetura em módulos

**Data:** Não detalhado no registro original (anterior à criação deste documento).
**Status:** Ativa.

### Contexto

Não detalhado no registro original.

### Problema

Não detalhado no registro original.

### Alternativas consideradas

Não detalhado no registro original.

### Decisão tomada

A plataforma será construída em módulos independentes: Operação,
Financeiro, Comercial, Administração, Analytics, Automações. Cada
funcionalidade deve pertencer claramente ao seu módulo.

### Justificativa

Não detalhado no registro original.

### Impactos

Não detalhado no registro original.

## Decisão 007: Fonte única da verdade

**Data:** Não detalhado no registro original (anterior à criação deste documento).
**Status:** Ativa.

### Contexto

Não detalhado no registro original.

### Problema

Não detalhado no registro original.

### Alternativas consideradas

Não detalhado no registro original.

### Decisão tomada

Nenhuma informação importante poderá possuir duas representações
diferentes. Toda alteração deve refletir automaticamente em todas as
áreas da plataforma.

### Justificativa

Não detalhado no registro original.

### Impactos

Não detalhado no registro original.

## Decisão 008: A plataforma é um Sistema Operacional do Gestor

**Data:** Não detalhado no registro original (anterior à criação deste documento).
**Status:** Ativa.

### Contexto

Não detalhado no registro original.

### Problema

Não detalhado no registro original.

### Alternativas consideradas

Não detalhado no registro original.

### Decisão tomada

O objetivo não é construir um novo ClickUp. Nem um ERP. Nem um Dashboard.
A plataforma existe para funcionar como um segundo cérebro operacional do
gestor de tráfego.

### Justificativa

Toda decisão futura deverá respeitar esse conceito.

### Impactos

Não detalhado no registro original.

## Decisão 009: Card fechado do cliente também mostra tarefas e otimizações

**Data:** 2026-07-14
**Status:** Ativa. Substitui parcialmente a regra de densidade descrita na
Decisão 001/registro original da tela Sprints (ver Contexto).

### Contexto

A tela Sprints já seguia a regra "card fechado = decisão, card aberto =
investigação": o card fechado do cliente mostrava só nome, período, %
investido, situação financeira, uma informação operacional e a barra —
nunca contagem de tarefas ou de otimizações, que só apareciam um nível
abaixo, ao expandir até a sprint.

### Problema

Na etapa "Sprint UX 2.0", o pedido original pede que o card fechado do
cliente já mostre tarefas pendentes/concluídas e a quantidade de
otimizações do período, pra reduzir a necessidade de expandir até a sprint
só pra saber isso. Isso contraria a regra de densidade documentada no
código (`account-card-summary.tsx`, Etapa 44).

### Alternativas consideradas

1. Manter como estava (contagem só no card da sprint, um nível abaixo).
2. Mostrar a contagem só na visão "Sprint atual" (meio-termo).
3. Adicionar a contagem ao card fechado do cliente em todas as visões.

### Decisão tomada

Adotada a alternativa 3, escolhida pelo responsável de produto: o card
fechado do cliente passa a mostrar `tarefas concluídas/total` e a
quantidade de otimizações do período, junto com o que já existia (nome,
período, % investido, situação financeira, informação operacional, barra).
Estados vazios usam texto compacto ("Sem tarefas no período", "Sem
otimizações no período") em vez de "0/0".

### Justificativa

O gestor precisa dessas duas contagens pra decidir rapidamente onde agir,
sem precisar expandir cliente por cliente só pra ver se há pendência —
reduz cliques e carga cognitiva, alinhado ao princípio "a Plataforma
trabalha para o gestor".

### Impactos

Afeta `src/app/sprints/account-card-summary.tsx` e os três agrupamentos que
o consomem (`current-client-group.tsx`, `monthly-consolidated-group.tsx`,
`monthly-sprints-group.tsx`). Nenhuma regra financeira ou de prioridade foi
alterada — só a apresentação do card fechado.

## Decisão 010: A Plataforma não é um ClickUp

**Data:** 2026-07-14
**Status:** Ativa.

### Contexto

Não especificado nesta decisão.

### Problema

Não especificado nesta decisão.

### Alternativas consideradas

Não especificado nesta decisão.

### Decisão tomada

A Plataforma Mitza não será construída como um gerenciador de tarefas. Ela
será construída como um Sistema Operacional especializado para Gestão de
Tráfego.

O ClickUp continuará servindo apenas como inspiração de UX, especialmente
em:

- densidade visual;
- rapidez operacional;
- edição inline;
- estrutura hierárquica;
- continuidade de navegação.

Não copiar:

- Kanban;
- gestão genérica de tarefas;
- backlog;
- projetos genéricos;
- Gantt;
- workflows universais.

### Justificativa

A plataforma resolve um problema diferente. O centro da operação é o
cliente, e não a tarefa.

### Impactos

Não especificado nesta decisão.

## Decisão 011: Sprint é uma árvore operacional

**Data:** 2026-07-14
**Status:** Ativa.

### Contexto

Não especificado nesta decisão.

### Problema

Não especificado nesta decisão.

### Alternativas consideradas

Não especificado nesta decisão.

### Decisão tomada

As sprints deixam de ser tratadas como grandes cards independentes. A
relação Cliente → Sprint → Contexto → Ação deve ser comunicada
visualmente através de uma estrutura hierárquica compacta.

### Justificativa

Permitir que um gestor escaneie dezenas de clientes rapidamente.

### Impactos

Não especificado nesta decisão.

## Decisão 012: A Sidebar é o único elemento estrutural fixo

**Data:** 2026-07-15
**Status:** Ativa.

### Contexto

A plataforma tinha dois elementos estruturais globais competindo por
espaço vertical: a Top Bar (largura cheia, no topo, com o botão de menu
mobile, a marca e o relógio da agência) e a Sidebar (navegação principal,
abaixo da Top Bar). Em telas de notebook comuns, a Top Bar consumia uma
faixa inteira sem oferecer valor proporcional ao espaço — não fazia nada
que a Sidebar já não pudesse fazer.

### Problema

Cada elemento estrutural que não converte em área operacional é espaço
tirado do gestor. A Top Bar só carregava marca, botão de menu mobile e
relógio — nenhuma dessas três coisas precisa de uma faixa própria de
largura total.

### Alternativas consideradas

Manter a Top Bar só no mobile (para o botão de menu) e removê-la no
desktop: rejeitada por criar dois comportamentos estruturais diferentes
entre mobile e desktop, o que contraria a ideia de a Sidebar ser um
elemento único e consistente em qualquer tela.

### Decisão tomada

A Top Bar global é removida por completo. A Sidebar passa a ser o único
elemento estrutural fixo da plataforma: ocupa exatamente 100% da altura da
viewport, em qualquer breakpoint, e nunca termina antes do fim da tela. As
únicas informações que eram exclusivas da Top Bar (data e horário da
agência) migram para o rodapé da Sidebar — texto discreto quando expandida,
ícone com tooltip quando recolhida (desktop), texto completo sempre que o
drawer estiver aberto (mobile, onde não existe hover). O botão de abrir o
menu no mobile deixa de viver na Top Bar (que não existe mais) e passa a
ser um gatilho flutuante próprio, exposto pela própria Sidebar.

### Justificativa

Um elemento estrutural deve justificar o espaço que ocupa (Capítulo 17 dos
Princípios de Arquitetura: "área operacional em primeiro lugar"). A Top
Bar não passava nesse teste. Consolidar tudo na Sidebar também reforça a
Sidebar como o principal — e agora único — elemento de navegação e
identidade estrutural da plataforma, transmitindo estabilidade e
continuidade em vez de duas faixas competindo entre si.

### Impactos

- `src/app/top-bar.tsx` removido.
- `src/app/app-shell-dimensions.ts` simplificado (sem mais cálculo de
  altura descontando a Top Bar).
- `src/app/sidebar.tsx`: fundo preto permanente (não acompanha o tema
  claro/escuro do resto da aplicação — é chrome estrutural, não conteúdo),
  altura cheia em qualquer breakpoint, relógio da agência no rodapé,
  gatilho de menu mobile próprio.
- `src/app/clients/client-identity-sticky.tsx`: ajustado para não
  descontar mais a altura da Top Bar (ela não existe).
- Nenhuma regra de negócio, banco de dados, permissão ou integração foi
  alterada.

## Como adicionar novas decisões

Sempre que uma alteração modificar a arquitetura da plataforma ou sua
filosofia, ela deverá ser registrada neste documento **antes** da
implementação, usando o template do Capítulo 1. Mudanças pequenas de
código não devem entrar aqui.

Uma decisão superada nunca é editada ou apagada — ela ganha uma entrada
nova, com seu próprio número sequencial, que referencia a decisão anterior
e atualiza o `Status` da decisão antiga para "Substituída".
