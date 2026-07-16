# MITZA Information Design 1.0 — Auditoria e Implementação

**Escopo desta etapa:** leitura, não arquitetura. Toda mudança aqui precisa
ser percebida no primeiro olhar — se não fosse notada ao abrir a tela, não
foi implementada. Nenhuma mudança de token, documentação-por-documentação,
componentização ou "limpeza de código" entra neste relatório como
implementação (isso já foi feito, com outro propósito, na etapa "Visual
Language & Operational Hierarchy 1.0").

Telas cobertas: Visão Geral (= Dashboard, mesma rota `/`), Sprints, Cliente
individual, Equipe, Relatórios, Configurações.

---

## 1. Auditoria completa

### 1.1 Visão Geral (`/`)

A tela tem, na ordem real de renderização: filtros → **Prioridades de
hoje** → painel financeiro/operacional (recolhido) → tabelas de clientes
por objetivo → análises adicionais (recolhidas).

**`ClientObjectiveTable`** (`client-objective-table.tsx`) é a tabela mais
lida da plataforma — todo gestor passa por ela. Antes desta etapa, ela
tinha um problema clássico de "tabela sem hierarquia tipográfica": **toda
coluna de dado tinha o mesmo peso visual** (`text-overview-text-secondary`,
mesmo tamanho), exceto o nome do cliente. Isso inclui a coluna
**Investimento** — o número mais checado da tabela (o gestor quer saber
"quanto essa conta já gastou") — que tinha peso idêntico ao nome do gestor
ou ao rótulo da plataforma. Só a coluna "Ritmo financeiro" carregava cor
(via `StatusDot`), mas o valor em si (o "quanto") ficava mudo.

**`PrioritiesPanel`/`PriorityRow`** (`priorities-panel.tsx`) já tinha uma
boa base (nome do cliente em destaque + `StatusDot` de severidade), mas o
texto abaixo do nome — que é o motivo real do item estar na lista — vinha
todo no mesmo tom (`text-overview-text-secondary`), sem diferenciar o
único número que importa (o desvio percentual, ex. "42%") do resto da
frase. Ler "CPL 42% acima da meta" exigia ler a frase inteira pra achar o
"42%".

### 1.2 Cliente individual (`/clients/[id]`)

**`SprintFocusBar`** (o primeiro bloco operacional da página, logo após o
seletor de mês) tinha uma inversão clara de ênfase: o rótulo **"Próxima
ação:"** vinha em `font-medium`, mais pesado que o próprio texto da ação
(`nextActionText`, sem peso nenhum). Isso é o oposto do que a leitura
operacional pede — o rótulo é metadado ("o que é isto"), a ação é o
conteúdo que o gestor precisa executar. O olho parava no rótulo, não na
instrução.

**`MonthlyKpiSummary`** (Investimento total / Resultados / Custo por
resultado) — os 3 números mais olhados da página do cliente — renderizavam
a `text-base` (16px). Para comparação: os números equivalentes na Visão
Geral (Planejado/Realizado, `PrimaryInvestmentMetric`) usam 24px/20px
(`text-[24px]`/`text-[20px]`). A mesma categoria de informação (o número
financeiro "chefe" da tela) tinha um salto de escala de quase 50% entre uma
tela e outra, sem justificativa de conteúdo — só porque foi implementada em
etapas diferentes.

**`TaskRow`** já está bem resolvido: data colorida por urgência (vermelho
atrasado / azul-marca hoje / neutro futuro), título em peso médio,
responsável em cinza discreto, badges só quando há algo a dizer ("Hoje",
"Não realizado"). Não há problema de leitura aqui — nenhuma mudança feita.

### 1.3 Sprints (`/sprints`)

A lista já usa um cabeçalho de colunas explícito (`ROW_GRID_CLASSES`) que
comunica "isto é uma tabela" mesmo sendo composta por `<li>`s, boa prática
de scanning. Não foi auditada componente-a-componente com a mesma
profundidade nesta etapa (ver "Limitações"), mas a auditoria de amostragem
não encontrou um problema de mesma gravidade que os das seções acima — os
grupos por cliente (`SprintCurrentClientGroup` etc.) reaproveitam o mesmo
`TaskRow`/`AccountReviewsSection` já bem hierarquizados.

### 1.4 Equipe (`/team`)

**`OperationalActivityPanel`** expõe **11 estatísticas** (`Stat`) lado a
lado na mesma grade, todas com o mesmo peso visual (`text-sm font-medium`
ou `text-xs font-medium` para as "small"). Não há nenhuma que se destaque
como "a" métrica que resume o desempenho do período — "Taxa no prazo",
"Tarefas reabertas" e "Recebeu por reatribuição" competem pela mesma
atenção, forçando leitura completa da grade pra achar o que importa.
**Não implementado nesta etapa** — decidir qual das 11 é a métrica-âncora é
uma escolha de produto (o que a agência realmente usa pra avaliar alguém),
não uma escolha de leitura, e arriscar errar essa hierarquia teria mais
custo do que ganho sem validação com o usuário. Registrado como
"Próximas melhorias".

### 1.5 Relatórios (`/reports`)

A tabela principal tinha o mesmo problema da `ClientObjectiveTable`: a
coluna **"% realizado"** — o número que resume se a conta está no ritmo
certo, e que o gestor usa pra decidir se abre o relatório daquele cliente
primeiro — vinha no mesmo peso (`text-muted-foreground`) que "Gestor" ou o
valor absoluto de investimento. A única cor da linha inteira ficava
concentrada nos dois badges (Situação/Status do relatório), nunca no
número que efetivamente resume "por quanto".

### 1.6 Configurações (`/settings`)

Tela puramente navegacional — uma lista de 3 links (Clientes, Tarefas
padrão de sprint, Clientes excluídos), cada um com título + uma linha de
descrição. Não há "scanning sob pressão" aqui: ninguém abre Configurações
pra decidir algo em 3 segundos, é uma tela de navegação deliberada. Fora de
escopo de Information Design — não há problema de leitura a corrigir.

---

## 2. Heat Map (textual)

| Área | Atenção que recebe hoje | Atenção que deveria receber |
|---|---|---|
| Nome do cliente (todas as tabelas/listas) | Alta (já em destaque) | Alta — correto |
| `StatusDot`/badges de severidade | Alta (cor) | Alta — correto |
| Coluna Investimento (`ClientObjectiveTable`) | Baixa (texto secundário) | **Alta** — corrigido nesta etapa |
| "% realizado" (Relatórios) | Baixa (texto secundário) | **Alta** — corrigido nesta etapa |
| Desvio percentual em "Prioridades de hoje" | Diluída (dentro da frase) | **Alta, pontual** — corrigido nesta etapa |
| Rótulo "Próxima ação:" (SprintFocusBar) | Alta (font-medium) | Baixa — era ruído, corrigido |
| Texto da ação em si (SprintFocusBar) | Baixa (sem peso) | **Alta** — corrigido nesta etapa |
| KPIs do cliente (Investimento/Resultados/Custo) | Média (16px) | **Alta** — corrigido nesta etapa |
| 11 stats de `OperationalActivityPanel` | Uniforme (nenhuma se destaca) | Uma âncora deveria dominar — **não corrigido, decisão de produto pendente** |
| Gestor / Plataforma / Sprint atual (colunas de contexto) | Baixa | Baixa — correto, são contexto, não decisão |

---

## 3. Eye Tracking por tela

**Visão Geral — hoje:** filtros (1) → Prioridades de hoje, nome do
cliente (2) → severidade/dot (3) → desce pra tabela, olha nome (4) → sem
next stop óbvio dentro da linha, olhar varre a linha inteira procurando o
número (5, hesitação).

**Visão Geral — ideal (depois):** (1) filtros → (2) nome do cliente na
prioridade → (3) severidade (dot) → (4) desvio percentual em destaque (o
"quão grave") → (5) na tabela, nome → investimento em negrito (mesmo salto
de atenção que o nome, sem precisar variar coluna).

**Cliente — hoje:** mês (1) → badge de ritmo (2) → rótulo "Próxima ação"
em negrito (3, mas é metadado) → texto da ação sem peso (4, deveria ser o
3) → KPIs pequenos, sem destaque proporcional à importância (5).

**Cliente — ideal (depois):** (1) mês → (2) badge de ritmo → (3) texto da
ação (agora em negrito — é o "faça isto") → (4) rótulo, discreto → (5)
KPIs num tamanho que sinaliza "isto é o resumo financeiro da conta".

**Relatórios — hoje:** nome (1) → varre a linha (2, sem stop) → badges de
situação (3) → sem retorno ao "% realizado" isolado.

**Relatórios — ideal:** (1) nome → (2) % realizado em negrito (resposta
direta a "está no ritmo?") → (3) badges de situação/status, reforçando o
mesmo veredito.

---

## 4. Scanning — teste dos 3 segundos

Simulação: gestor abre a tela por 3 segundos, sem ler nada por completo.

- **Visão Geral / Prioridades:** consegue identificar Cliente (nome em
  negrito) e Severidade (dot colorido) sem interpretar. Antes desta etapa,
  **não** conseguia identificar o "quão grave" sem ler a frase — agora o
  número salta (cor de severidade + negrito).
- **`ClientObjectiveTable`:** conseguia identificar Cliente. Não conseguia
  identificar "quanto investiu" sem procurar a coluna certa — agora o
  valor salta na mesma leitura periférica que o nome.
- **`SprintFocusBar`:** conseguia ver o badge de ritmo. A "próxima ação"
  exigia leitura ativa (sem peso visual) — agora ela é o segundo elemento
  mais forte da barra, depois do badge.
- **Relatórios:** via os badges (cor), mas não o "% realizado" em si —
  agora o número em negrito responde à mesma pergunta sem depender só do
  badge.

---

## 5. Editorial Design — o que foi destacado (e o que não foi)

Regra seguida em toda mudança: **nunca destacar a frase inteira, só o que
reduz esforço mental.**

- Em "Prioridades de hoje", o título completo (ex. "Investimento 38%
  acima do ritmo") **não** foi destacado — só o número "38%", com a cor da
  própria severidade. O resto da frase (rótulo + descrição) continua no
  mesmo peso discreto de sempre.
- Na tabela de clientes e em Relatórios, só o valor numérico (Investimento
  / % realizado) ganhou peso — os rótulos de coluna, nomes de gestor e
  plataforma continuam exatamente como estavam.
- Em `SprintFocusBar`, só o texto da ação (não o badge, não o rótulo)
  ganhou peso.
- Nos KPIs do cliente, só o valor (não o rótulo, que já era discreto de
  propósito) cresceu.

---

## 6. Reading Contrast

Contraste hoje avaliado entre as camadas Título/Número/Descrição/Metadado
nos 3 locais mexidos:

| Camada | Antes | Depois |
|---|---|---|
| Nome do cliente (linha de prioridade) | `font-semibold` `text-overview-text-primary` | inalterado (já correto) |
| Desvio (número) dentro do título | mesmo peso da frase | `font-semibold` + cor de severidade |
| Descrição/gestor (contexto) | `text-overview-text-muted` | inalterado (correto — é contexto) |
| Valor de Investimento na tabela | igual a "Gestor"/"Plataforma" | `font-semibold` + cor primária |
| Rótulo "Próxima ação" | mais forte que a ação | mais fraco que a ação (correto agora) |
| Texto da ação | mais fraco que o rótulo | mais forte (é o conteúdo) |

---

## 7. Color Emphasis

A única cor nova introduzida é a reaplicação, num ponto mais preciso, de
tokens de severidade **que já existem e já são usados na mesma tela**
(`--overview-success/warning/danger`, já usados por `StatusDot` e por
`PrimaryInvestmentMetric`/`SecondaryInvestmentMetric` no mesmo arquivo).
Nenhuma cor nova entrou na paleta. A cor no desvio percentual de
"Prioridades de hoje" não é decorativa: ela repete, no número, o mesmo
significado que o `StatusDot` ao lado já comunica — reforça em vez de
competir.

---

## 8. Information Density e Visual Emphasis

- `ClientObjectiveTable`: 8-10 colunas, todas no mesmo peso, é alta
  densidade sem hierarquia — corrigido parcialmente (Investimento). Meta e
  Custo por resultado continuam no mesmo peso — deliberado, pra não
  diluir o destaque num "todo mundo em negrito" (ver Parte 5).
- `OperationalActivityPanel`: 11 números do mesmo tamanho é o exemplo mais
  claro de densidade sem emphasis na plataforma — identificado, não
  corrigido (decisão de produto pendente, ver seção 1.4).
- `MonthlyKpiSummary`: 3 números, densidade baixa, mas emphasis
  proporcionalmente pequena pro que representam — corrigido.

---

## 9. Operational Reading — Quem? Como está? O que exige atenção? O que faço agora?

| Tela | Quem? | Como está? | O que exige atenção? | O que faço agora? |
|---|---|---|---|---|
| Prioridades de hoje | Nome do cliente (negrito) | Severidade (`StatusDot`) | Desvio % (agora em destaque) | Botão de ação |
| `ClientObjectiveTable` | Nome do cliente | Ritmo (`StatusDot`) | Investimento (agora em destaque) | "Abrir cliente" |
| Cliente → `SprintFocusBar` | (já no cabeçalho da página) | Badge de ritmo | — | Texto da ação (agora em destaque) + CTA |
| Relatórios | Nome do cliente | Badges de situação/status | % realizado (agora em destaque) | "Abrir relatório" |

---

## 10. Problemas encontrados (resumo)

1. Coluna Investimento da `ClientObjectiveTable` sem peso proporcional à
   sua importância decisória. **Corrigido.**
2. Desvio percentual em "Prioridades de hoje" diluído dentro da frase.
   **Corrigido.**
3. Inversão de ênfase entre rótulo e conteúdo em `SprintFocusBar`.
   **Corrigido.**
4. KPIs do cliente com escala tipográfica menor que o equivalente na Visão
   Geral, sem justificativa de conteúdo. **Corrigido.**
5. Coluna "% realizado" em Relatórios sem peso. **Corrigido.**
6. 11 estatísticas de `OperationalActivityPanel` sem hierarquia/âncora.
   **Não corrigido** — decisão de produto, ver "Próximas melhorias".
7. Sprints não recebeu a mesma auditoria componente-a-componente (ver
   "Limitações") — amostragem não encontrou problema de mesma gravidade.

## Mudanças implementadas — Antes e Depois

### 1. `src/app/clients/monthly-kpi-summary.tsx`
- **Antes:** valor do KPI em `text-base font-semibold text-foreground`
  (16px).
- **Depois:** `text-xl font-semibold tracking-tight text-foreground`
  (20px).
- **Por quê:** os 3 números (Investimento total/Resultados/Custo por
  resultado) são a informação mais buscada da página do cliente; 16px os
  colocava visualmente perto demais do próprio rótulo (11px), sem o salto
  de escala que um "número-resumo" merece. Ganho operacional: o gestor
  encontra os 3 números com um olhar periférico, sem precisar focar.

### 2. `src/app/clients/sprint-focus-bar.tsx`
- **Antes:** `<span className="font-medium text-muted-foreground">Próxima
  ação: </span>{nextActionText}` — o rótulo em negrito, a ação sem peso.
- **Depois:** rótulo sem negrito (`text-muted-foreground`), ação em
  `font-semibold text-foreground`.
- **Por quê:** o rótulo é metadado ("o que é este texto"); a ação é a
  instrução que o gestor precisa executar agora. Ter o metadado mais forte
  que o conteúdo invertia a prioridade de leitura. Ganho operacional: a
  instrução real ("Registrar otimização", "Ajustar orçamento" etc.) é o
  primeiro texto que o olho pega na barra, não o rótulo genérico.

### 3. `src/app/client-objective-table.tsx`
- **Antes:** `<td className="... text-overview-text-secondary">` para o
  valor de Investimento — mesmo peso de Gestor/Plataforma.
- **Depois:** `<td className="... font-semibold tabular-nums
  text-overview-text-primary">`.
- **Por quê:** entre as ~9 colunas da tabela, Investimento é o número que
  o gestor mais precisa localizar rapidamente por cliente. Dar-lhe o mesmo
  peso do nome do cliente (que já é a âncora de identidade da linha) cria
  dois pontos de parada por linha em vez de nenhum. Ganho operacional:
  escanear "quanto cada cliente está investindo" não exige mais ler a
  linha inteira.

### 4. `src/app/priorities-panel.tsx`
- **Antes:** título inteiro ("CPL 42% acima da meta") em
  `text-overview-text-secondary`, sem diferenciação interna.
- **Depois:** só o trecho "42%" ganha `font-semibold` + cor de severidade
  (`text-overview-danger`/`warning`/`success`, conforme o mesmo `severity`
  que já colore o `StatusDot` ao lado).
- **Por quê:** o número é literalmente a resposta à pergunta "quão grave é
  isso" — destacar a frase inteira violaria a regra da etapa ("nunca
  destacar frases inteiras"); destacar só o número reduz o esforço mental
  sem adicionar ruído. Ganho operacional: o gestor compara severidade
  entre itens da lista sem ler a frase completa de cada um.

### 5. `src/app/reports/page.tsx`
- **Antes:** `<td className="... text-muted-foreground">` para "%
  realizado".
- **Depois:** `<td className="... font-semibold text-foreground">`.
- **Por quê:** "% realizado" é o número que resume se a conta está no
  ritmo certo — a mesma pergunta que os badges ao lado respondem em
  palavras, mas o número em si não carregava nenhum peso que sinalizasse
  sua importância. Ganho operacional: decidir qual relatório abrir
  primeiro fica mais rápido ao escanear só os números em negrito da
  coluna.

---

## 7. Impacto esperado na leitura

- Redução do número de "paradas" por linha nas tabelas de clientes: hoje o
  olho para em nome + número (2 pontos), antes precisava varrer a linha
  inteira pra achar o valor (sem ponto de parada garantido).
- "Prioridades de hoje" passa a comunicar severidade em dois canais
  reforçando a mesma informação (dot + número colorido), sem introduzir
  uma terceira cor nem competir por atenção.
- `SprintFocusBar` deixa de exigir leitura ativa pra saber "o que fazer
  agora" — a resposta é o elemento mais forte da barra depois do badge.
- Os KPIs do cliente ganham a mesma presença visual que o equivalente já
  tem na Visão Geral, reduzindo a sensação de "a página do cliente esconde
  os números" ao comparar as duas telas.

## 8. Arquivos alterados

- `src/app/clients/monthly-kpi-summary.tsx`
- `src/app/clients/sprint-focus-bar.tsx`
- `src/app/client-objective-table.tsx`
- `src/app/priorities-panel.tsx`
- `src/app/reports/page.tsx`

## 9. Limitações

- A tela Sprints (`/sprints`) e seus grupos (`SprintCurrentClientGroup`,
  `SprintMonthlyConsolidatedGroup`, `SprintMonthlyBySprintsGroup`) não
  foram auditados componente-a-componente com a mesma profundidade das
  demais telas — a amostragem via `TaskRow`/`AccountReviewsSection`
  (reaproveitados ali) não encontrou um problema de mesma gravidade, mas
  isso não é uma auditoria completa dos 3 modos de visão da tela.
- `OperationalActivityPanel` (Equipe) tem um problema real de densidade
  identificado (11 estatísticas sem hierarquia) que não foi corrigido —
  requer uma decisão de produto (qual métrica é a "âncora") que está fora
  do escopo de uma etapa de leitura pura.
- Nenhuma mudança nesta etapa tocou dark mode especificamente além de
  herdar as classes de tema já existentes (`text-foreground`,
  `text-overview-*`) — não houve teste manual em tela real (ambiente sem
  navegador interativo neste momento); a validação foi lint/typecheck/build
  + leitura do código gerado.

## 10. Próximas melhorias

1. Decidir com o usuário qual das 11 estatísticas de
   `OperationalActivityPanel` deve ser a métrica-âncora (provavelmente
   "Taxa no prazo", mas é uma decisão de produto) e dar a ela o mesmo
   tratamento de escala aplicado aqui aos KPIs do cliente.
2. Auditar os 3 modos de visão de Sprints com a mesma profundidade,
   focando em Investimento/Ritmo por card (mesma classe de problema já
   corrigido na Visão Geral).
3. Considerar aplicar o mesmo padrão de "número em destaque, contexto em
   discreto" à coluna "Meta de CPL/CPA" da `ClientObjectiveTable" quando
   houver evidência de que gestores comparam Custo × Meta visualmente (não
   implementado agora para não diluir o destaque já dado a Investimento).
