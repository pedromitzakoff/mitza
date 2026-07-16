# Platform Operational Architecture — MITZA Operational Workspace 2.0

## Objetivo do documento

Auditoria de arquitetura de produto, não de componentes. A pergunta que
guia cada resposta abaixo: **como reduzir ao máximo a energia mental que
um gestor precisa gastar para cuidar de 30 clientes?** Nenhuma parte desta
auditoria propõe funcionalidade nova, banco novo, integração nova ou
mudança de regra de negócio — só reorganização estrutural.

Telas cobertas: Visão Geral (`/`), Clientes (`/clients`), Sprints
(`/sprints`), Cliente individual/"Sprint" (`/clients/[id]`), Equipe
(`/team`), Relatórios (`/reports` + `/reports/[clientId]`), Configurações
(`/settings`).

**Nota sobre "Dashboard"**: o pedido lista "Dashboard" e "Visão Geral" como
telas separadas. Na plataforma real elas são a MESMA tela (`/`, item único
"Visão Geral" na Sidebar) — não existe uma segunda rota "Dashboard". Isso
já é, em si, um primeiro achado: o nome "Dashboard" que o pedido usa
naturalmente descreve um propósito mais estreito (glance rápido) do que o
que a "Visão Geral" atual entrega (ver Parte 1).

---

## PARTE 1 — Workspace Purpose

| Tela | Propósito atual | Propósito ideal | Nota |
|---|---|---|---|
| **Visão Geral** | 4 propósitos coexistindo: (1) dashboard financeiro agregado da agência, (2) fila de prioridades, (3) diretório navegável de todos os clientes por objetivo, (4) análise por gestor | UM propósito: "o que precisa da minha atenção agora, entre os 30 clientes" — uma tela de **triagem**, não um dashboard financeiro | 4/10 |
| **Clientes** | Diretório de busca/filtro pra achar e abrir um cliente | Igual — já é isso | 8/10 |
| **Sprints** | 2 propósitos sob o mesmo nome: "Sprint atual" = execução do dia em lote; "Mensal Consolidado"/"Mensal por Sprints" = conferência de período fechado (mais relatório do que execução) | Separar "o que eu executo hoje, em lote" de "como foi o mês, por cliente" | 5/10 |
| **Cliente individual ("Sprint")** | Execução + contexto completo de UM cliente (já reorganizado nas etapas Workspace Consistency/Workspace-First/Operational Workspace 1.0) | Igual — já bem definido | 8/10 |
| **Equipe** | 2 propósitos: cadastro/permissões de membros + monitoramento de atividade individual (redundante com "Operação por gestor" da Visão Geral) | Cadastro simples aqui; monitoramento de atividade deveria viver num único lugar (hoje duplicado em 2 telas) | 5/10 |
| **Relatórios (lista)** | Fila de "quais clientes têm relatório pendente/completo este mês" | Igual — já é isso | 8/10 |
| **Relatórios (individual)** | 2 propósitos: consolidar dados que já existem em outro lugar (performance/investimento/execução) + autoria original (análise do gestor, próximos passos, timeline) | Separar claramente "dados já existentes, só compilados" de "conteúdo que só existe aqui" | 5/10 |
| **Configurações** | Índice administrativo (cadastro de clientes, templates de sprint, clientes excluídos) | Igual — já é isso | 9/10 |

**Achado central da Parte 1**: toda tela com propósito duplo listada acima
tem o MESMO padrão — ela mistura "consulta de algo que já existe em outro
lugar da plataforma" com "a única coisa que só existe ali." Esse é o fio
condutor de toda a auditoria.

---

## PARTE 2 — Workspace Architecture (6 camadas)

| Tela | Forte | Fraca | Ocupando espaço demais | Deveria subir | Deveria descer |
|---|---|---|---|---|---|
| Visão Geral | Estado (KPIs financeiros) | Execução (zero — é só navegação, nenhuma ação acontece aqui) | Estado (3 blocos de métricas antes de qualquer prioridade) | Prioridade | Estado/financeiro |
| Clientes | Identidade (nome+status) | Prioridade (nenhuma) | — (tela já enxuta) | — | — |
| Sprints | Execução (drawers de tarefa/revisão inline) | Prioridade (existe como filtro, não como fila) | Histórico (Mensal Consolidado repete dado que já está no Relatório) | — | Mensal Consolidado (na prática é Histórico/Relatório) |
| Cliente individual | Execução (Foco Agora, já promovido) | Configuração (correto — não deveria ser forte aqui) | — (já compactado) | — | — |
| Equipe | Identidade (roster) | Prioridade/Execução (nenhuma ação além de editar cadastro) | Histórico (timeline paginada dentro do drawer de edição, um dado de "estado" tratado como cadastro) | — | Atividade/timeline (mais Estado que Configuração) |
| Relatórios (individual) | Histórico (timeline de eventos) | Execução (quase tudo aqui é preencher texto, não agir) | Estado (KPIs/investimento repetidos de Sprints/Cliente) | Autoria (análise do gestor, próximos passos) | Dados já existentes em outro lugar (Resumo/Performance/Comportamento por sprint) |
| Configurações | Configuração (correto) | — | — | — | — |

**Achado central da Parte 2**: em 3 das 7 telas (Visão Geral, Sprints,
Relatórios individual), a camada de **Estado/Histórico duplicado** ocupa
mais espaço do que a camada que de fato é exclusiva daquela tela. Nenhuma
tela tem uma camada de Execução fraca por acidente — é sempre porque outra
camada (geralmente Estado) está competindo pelo mesmo espaço.

---

## PARTE 3 — Decision Flow (fluxo mental do gestor)

**Visão Geral, hoje**: abre a tela → lê "Resultados da agência" (não decide
nada) → lê "Controle de investimento" (não decide nada, seria a mesma
informação de Sprints/Relatórios) → lê "Indicadores da operação" (idem) →
SÓ ENTÃO chega em Prioridades, a única seção que de fato aponta uma ação →
rola mais pra baixo pra ver as tabelas por objetivo (navegação, não
decisão) → só decide algo quando clica num cliente e sai da tela. **Ele
hesita** três vezes antes de decidir (nos 3 blocos financeiros) e **só
executa** ao abandonar a tela.

**Visão Geral, ideal**: abre a tela → Prioridades já é a primeira coisa
visível → decide em segundos qual conta olhar primeiro → clica e sai pra
executar. O financeiro agregado vira consulta opcional (um clique), nunca
parte do caminho de decisão.

**Sprints, hoje**: abre a tela → precisa primeiro decidir qual das 3 abas
usar (isso já é uma decisão que a tela deveria ter tomado por ele, dado o
contexto — "estou querendo executar hoje" vs. "quero conferir o mês") →
dentro da aba certa, executa bem (drawers inline). O ponto de hesitação é
a escolha da aba, não a execução em si.

**Relatórios individual, hoje**: abre a tela → rola por 4 seções de dados
que ele já viu em Sprints/Cliente (Resumo, Performance, Execução,
Comportamento por sprint) antes de chegar nas seções que só existem ali
(Acontecimentos, Análise do gestor, Pendências, Próximos passos). Hesita
tentando lembrar "eu já vi esse número hoje?" — carga cognitiva real, não
imaginária.

---

## PARTE 4 — Information Hierarchy

- **Primeira dobra (ideal)**: Visão Geral → só Prioridades. Sprints → a
  aba certa já selecionada por contexto + a lista de clientes. Cliente
  individual → já resolvido (Foco Agora). Relatórios individual → Resumo
  do mês + Pendências (o que falta fechar).
- **Poderia ficar escondido**: os 3 blocos financeiros da Visão Geral
  (Resultados/Investimento/Indicadores); "Detalhes do acompanhamento" (já
  escondido em Cliente); seções de dado-espelhado em Relatórios
  (Performance, Comportamento por sprint) poderiam colapsar quando o
  relatório está "em andamento" e só expandir quando o gestor quiser
  conferir antes de finalizar.
- **Grande demais**: o painel financeiro da Visão Geral (3 sub-blocos, 11
  métricas) para uma tela cujo propósito real é triagem.
- **Ocupa espaço sem gerar decisão**: praticamente todo o painel
  financeiro da Visão Geral; a aba "Mensal Consolidado" de Sprints (é
  puro histórico, sem CTA); as seções 1/2/4 do Relatório individual
  (Resumo/Performance/Comportamento por sprint são consulta, não decisão).
- **Duplicado**: investimento/ritmo mensal aparece em Visão Geral, em
  Sprints (Mensal Consolidado) e no Relatório (Resumo do mês) — os TRÊS
  mostram essencialmente a mesma conta com apresentação diferente. Contagem
  de tarefas concluídas/atrasadas aparece em Visão Geral ("Indicadores da
  operação"), em Equipe (atividade do membro) e no Relatório ("Execução da
  agência").
- **Longe do momento de uso**: a decisão "preciso atualizar performance
  desta conta" nasce na Visão Geral/Sprints mas só pode ser executada
  dentro do Cliente — isso já é resolvido por "Próxima Ação"/drawers
  (Waves anteriores); o que ainda está longe é a autoria do Relatório
  (análise do gestor) em relação ao momento em que as decisões da conta
  realmente acontecem (durante o mês, não no fechamento).

---

## PARTE 5 — Visual Weight

Em nível estrutural (não CSS): a Visão Geral tem 3 caixas de métricas +
painel de prioridades + até 3 tabelas + 1 caixa recolhível — 6-7 blocos
com bordas competindo por atenção antes desta etapa. Sprints e Relatórios
já usam bastante disclosure (`<details>`) pra conter isso; a Visão Geral,
até esta etapa, era a única tela principal do "andar de cima" (uso diário)
sem nenhum recolhimento — todo bloco sempre visível, sempre com o mesmo
peso, incluindo dados que não pedem decisão nenhuma.

---

## PARTE 6 — Cognitive Load

O que o gestor precisa lembrar hoje, cruzando telas:
- Se já checou o ritmo financeiro da conta hoje (repetido em 3 telas).
- Qual aba de Sprints usar pra cada situação (execução vs. conferência).
- Se a atividade recente de um membro da equipe já foi vista em "Operação
  por gestor" (Visão Geral) ou no drawer de Equipe (a MESMA pergunta,
  dois lugares).
- Se os números que está vendo num Relatório já foram conferidos em outro
  lugar durante o mês.

**A plataforma já tem os dados pra decidir isso sozinha** em quase todos
os casos: não é o gestor que deveria lembrar "onde eu vi isso antes" — é a
arquitetura que não deveria repetir a mesma pergunta em lugares diferentes
sob nomes diferentes.

---

## PARTE 7 — Workspace Boundaries

| Conceito | Onde mora de verdade | Onde só aparece como resumo | Duplicação/conflito |
|---|---|---|---|
| Cliente | `clients` (Configurações > Clientes edita; Cliente individual executa) | Clientes (diretório), Visão Geral, Sprints, Relatórios (todos resumem) | Nenhum conflito — resumos são coerentes entre si |
| Sprint | `sprints`/`sprint_*`, executada em Cliente individual e Sprints | Visão Geral (financeiro agregado), Relatórios ("Comportamento por sprint") | Financeiro de sprint aparece em 3 lugares com o mesmo número, nunca inconsistente, mas sempre recalculado/reapresentado |
| Tarefa | `tasks`, executada em Cliente individual/Sprints (Workspace-First Tasks) | Visão Geral ("Execução de tarefas"), Equipe (atividade do membro), Relatórios ("Execução da agência") | 3 lugares mostram % de execução de tarefas com escopos ligeiramente diferentes (agência / membro / cliente-mês) — nenhum XML de dado errado, mas responsabilidade fragmentada |
| Revisão de conta | `account_reviews`, registrada em Cliente individual/Sprints | Visão Geral (indireta, via prioridades), Relatórios ("Revisões" na Execução) | Sem conflito |
| Performance | `performance_records`, editada em Cliente individual | Visão Geral ("Resultados da agência"), Relatórios (seção Performance dedicada) | A MESMA meta/resultado é editável em 2 lugares (Cliente e Relatório) — risco de o gestor editar em um e esquecer que o outro é só leitura recalculada (na prática o Relatório também tem `updateKpiValueAction` próprio) |
| Objetivo | `clients.performance_goal`, editável em Cliente/Configurações | Visão Geral (agrupamento das tabelas), Relatórios | Sem conflito |
| Equipe | `team_members`, cadastro em Equipe | Visão Geral ("Operação por gestor") | **Responsabilidade mal definida**: "quem está executando bem" é respondido em dois lugares (Equipe e Visão Geral) sem que um aponte pro outro |
| Relatório | `monthly_reports` + tabelas satélite, autoria só em Relatórios | Sprints/Relatórios lista (status) | Sem conflito real, mas o Relatório RECALCULA/reapresenta dado que já existe em Sprints/Cliente ao invés de linkar pra lá |

---

## PARTE 8 — Workspace Frequency

| Tela | Frequência | Está adequada à frequência? |
|---|---|---|
| Visão Geral | Diária (é a porta de entrada) | **Não** — era a mais usada e uma das mais carregadas (antes desta etapa) |
| Sprints | Diária | Adequada dentro de cada aba; a existência de 3 abas é a única complexidade acima do necessário |
| Cliente individual | Diária/múltiplas vezes ao dia | Adequada — já é a mais trabalhada e mais simples do fluxo operacional |
| Equipe | Semanal (cadastro raramente muda; atividade é olhada com mais frequência) | Adequada para cadastro; a parte de atividade individual está mais complexa do que o uso semanal justificaria |
| Relatórios (lista) | Mensal | Adequada — simples, condiz com a frequência |
| Relatórios (individual) | Mensal | **Não** — 9 seções pra uma tarefa mensal é desproporcional mesmo considerando a frequência baixa |
| Configurações | Rara (só quando cadastro muda) | Adequada — já é simples |
| Clientes | Ocasional (achar um cliente específico) | Adequada |

---

## PARTE 9 — Attention Map

**Visão Geral (antes)**: Entrada → Resultados da agência (sem decisão) →
Investimento (sem decisão) → Indicadores (sem decisão) → **primeira
decisão** (Prioridades, só aqui) → segunda decisão (qual cliente na
tabela) → Execução (fora da tela, ao clicar) → Saída. O olhar pula por 3
blocos sem importância decisória antes da primeira decisão real —
exatamente o problema que a Parte 9 pede pra registrar.

**Sprints**: Entrada → decisão de aba (deveria ser automática por
contexto) → primeira decisão (qual cliente/sprint) → Execução (drawer
inline, sem sair da tela) → Consulta (comentários/histórico dentro do
card) → Saída. Fluxo já bom DENTRO de cada aba.

**Relatórios individual**: Entrada → Resumo (consulta) → Performance
(consulta) → Execução (consulta) → Comportamento por sprint (consulta) →
**primeira decisão real** (editar Análise do gestor / Pendências) →
Execução (escrever) → Status/Finalizar → Saída. 4 blocos de consulta antes
da primeira decisão — mesmo padrão da Visão Geral, gravidade maior porque
é um fluxo de autoria (mais tempo gasto rolando).

---

## PARTE 10 — Zero Scroll

- **Visão Geral**: obrigatório sem scroll = Prioridades. Todo o resto
  (financeiro agregado, tabelas por objetivo, operação por gestor) pode
  ficar abaixo/recolhido.
- **Sprints**: obrigatório = a aba certa já ativa + as primeiras linhas de
  clientes com algo pendente.
- **Cliente individual**: já resolvido (Foco Agora + saúde do mês).
- **Equipe**: obrigatório = contagem de ativos/pendentes + a tabela; o
  resto (drawer de atividade) é sob demanda, já é assim.
- **Relatórios individual**: obrigatório = status do relatório (pendente/
  completo) + o que falta preencher (Pendências); o resto pode vir depois.
- **Configurações**: já cabe inteira sem scroll.

---

## PARTE 11 — Mouse Distance

- **Criar tarefa**: resolvido nas etapas anteriores (Workspace-First
  Tasks) — inline, sem navegação.
- **Concluir tarefa**: resolvido — otimista, sem navegação.
- **Registrar revisão**: resolvido — drawer, sem navegação.
- **Atualizar performance**: resolvido — inline na sprint.
- **Abrir cliente**: 1 clique a partir de Clientes/Sprints/Visão Geral —
  adequado.
- **Trocar sprint**: dentro do Cliente, é expandir/recolher — adequado.
- **Trocar mês**: existe em 4 telas diferentes (Visão Geral, Sprints,
  Cliente, Relatórios), cada uma com seu próprio seletor — funcionalmente
  ok, mas é outro caso de "a mesma decisão, tomada de novo em cada tela"
  em vez de um contexto de período compartilhado entre elas. Não é
  ida-e-volta de mouse, é repetição de decisão entre telas.

Nenhuma movimentação redundante de mouse significativa foi encontrada
dentro de uma mesma tela — os problemas de "distância" nesta plataforma
são de **arquitetura de decisão repetida entre telas**, não de
posicionamento de botão.

---

## PARTE 12 — Operation Score

| Tela | Clareza | Hierarquia | Execução | Velocidade | Carga Cognitiva | Operação | Consistência | Workspace | **Nota final** |
|---|---|---|---|---|---|---|---|---|---|
| Visão Geral | 5 | 4 | 3 | 6 | 4 | 5 | 7 | 5 | **4,9** |
| Sprints | 7 | 7 | 9 | 8 | 6 | 8 | 8 | 7 | **7,5** |
| Cliente individual | 8 | 9 | 9 | 9 | 8 | 9 | 9 | 9 | **8,8** |
| Equipe | 7 | 6 | 5 | 7 | 6 | 6 | 7 | 6 | **6,3** |
| Relatórios (lista) | 8 | 8 | 6 | 8 | 7 | 7 | 8 | 7 | **7,4** |
| Relatórios (individual) | 6 | 5 | 5 | 5 | 5 | 6 | 6 | 5 | **5,4** |
| Configurações | 9 | 9 | 8 | 9 | 9 | 8 | 9 | 8 | **8,6** |

**Média da plataforma (antes desta etapa): 6,99.**

---

## PARTE 13 — Roadmap (auditoria → prioridades, nada implementado ainda nesta lista)

| # | Item | Impacto | Risco | Complexidade | Valor operacional |
|---|---|---|---|---|---|
| **P1** | Visão Geral: Prioridade sobe acima do painel financeiro; painel financeiro vira consulta recolhível | Alto | Baixo | Baixa | Alto — implementado nesta etapa |
| **P2** | Unificar "atividade de gestor" (hoje duplicada em Visão Geral "Operação por gestor" e no drawer de Equipe) num único lugar, com o outro linkando pra ele | Alto | Médio | Média | Alto |
| **P3** | Sprints: separar explicitamente "Sprint atual" (execução diária) de "Mensal Consolidado"/"Mensal por Sprints" (conferência de período) — hoje as 3 vivem sob o mesmo rótulo de aba, sem deixar claro que são propósitos diferentes | Alto | Médio | Média | Alto |
| **P4** | Relatório individual: mover Resumo/Performance/Comportamento por sprint (dado já existente em Cliente/Sprints) pra um bloco único recolhível "Dados do mês (referência)", deixando Acontecimentos/Análise do gestor/Pendências/Próximos passos como o corpo principal da tela | Alto | Médio | Média-alta | Alto |
| **P5** | Contexto de mês compartilhado entre Visão Geral/Sprints/Cliente/Relatórios (hoje 4 seletores independentes) | Médio | Alto (toca navegação entre telas) | Alta | Médio |
| **P6** | Consolidar a métrica "% de execução de tarefas" (hoje calculada 3x com escopos levemente diferentes) atrás de uma única definição documentada, mesmo mantendo as 3 apresentações | Médio | Baixo | Baixa | Médio |
| **P7** | Clientes (lista): avaliar se "projeção" (dado comercial) pertence ali ou deveria mover pra Configurações > Clientes | Baixo | Baixo | Baixa | Baixo |
| **P8** | Equipe: separar cadastro (rápido, sempre visível) de atividade/timeline (sob demanda, já é um drawer — só precisa deixar de duplicar a pergunta que a Visão Geral já responde) | Médio | Baixo | Baixa | Médio |
| **P9** | Investigar se "Reuniões" (item "Em breve" na Sidebar) deveria virar uma visão dedicada ou permanecer dentro do Cliente/Sprints — decisão de escopo, não de arquitetura | Baixo | Baixo | Baixa | Baixo |
| **P10** | Revisitar se Relatórios deveria consumir automaticamente a Análise/Otimização já registrada durante o mês (Cliente) em vez de pedir pro gestor reescrever do zero na Análise do gestor | Alto | Alto (toca fluxo de autoria e possivelmente schema) | Alta | Alto — mas fora do escopo desta etapa (mexe em regra de negócio) |

---

## Implementação desta etapa

Consistente com "implementar apenas mudanças macro, de menor risco" —
**só P1 foi implementado**. É o item de maior impacto/menor risco do
roadmap: reordena a Visão Geral (Prioridade sobe, painel financeiro vira
consulta recolhível), sem tocar em nenhum cálculo, query, permissão ou
regra de negócio — só a ordem de leitura e o destaque visual.

P2-P10 ficam registrados como prioridades para etapas futuras, cada uma
exigindo decisão de produto mais profunda (P2/P3/P4 mexem em como duas ou
mais telas se relacionam; P5/P10 têm risco mais alto ou tocam regra de
negócio, fora do escopo desta etapa).
