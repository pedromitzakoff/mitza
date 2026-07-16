# MITZA Operational Tables 1.0 — Auditoria e Implementação

**Escopo:** organização da leitura das tabelas operacionais. Nenhuma
funcionalidade, dado, consulta, banco, filtro, permissão ou arquitetura foi
alterada — só a posição e a repetição da informação dentro das linhas.

**Princípio seguido em toda decisão:** uma informação global nunca se repete
em cada linha; uma informação importante nunca muda de posição entre telas;
a estrutura da tabela é fixa, só o conteúdo muda.

---

## 1. Auditoria completa

Tabelas operacionais revisadas: **Sprint Atual**, **Mensal Consolidado** e
**Mensal por Sprints** (as 3 visões de `/sprints`, todas construídas sobre o
mesmo `AccountCardSummary` + `ROW_GRID_CLASSES`), **Visão Geral**
(`ClientObjectiveTable`), **Relatórios** (`reports/page.tsx`), **Equipe**
(`TeamTable`) e **Cliente** (listas internas da página individual — tarefas
e revisões de conta).

### Existe consistência?

Parcialmente. As 3 visões de Sprints já compartilhavam literalmente o mesmo
grid (`ROW_GRID_CLASSES`), então entre elas a posição das colunas já era
idêntica — mas a ORDEM escolhida (Cliente/Gestor · Período · Investimento ·
Tarefas · Otimizações · Status) não seguia o padrão pedido (Status por
último, não logo após Investimento). A Visão Geral e Relatórios são tabelas
`<table>` de verdade, com uma ordem de colunas própria, diferente da ordem
de Sprints e diferente entre si (cada uma tinha "Gestor" na 2ª posição,
"Investimento" só na 4ª, "Status" espalhado no meio do meio ou perto do
fim). Um gestor que aprende "Investimento é a 2ª coisa que eu leio" na tela
Sprints não podia aplicar esse mesmo hábito em Relatórios ou Visão Geral.

### Existe repetição?

Sim — a mais grave encontrada nesta etapa. Nas visões **Mensal Consolidado**
e **Mensal por Sprints**, toda linha da lista mostrava o mesmo `monthLabel`
("Julho de 2026") na coluna Período — literalmente o mesmo texto repetido
em N linhas, quando o mês já está visível uma única vez no navegador de mês
no topo da tela e no nome da aba ativa ("Mensal consolidado"/"Mensal por
sprints"). Esse é exatamente o caso descrito no princípio da etapa.

### Existe desperdício?

Sim, na mesma coluna: nas visões Mensais, os 84px reservados a "Período" não
agregavam nenhuma informação nova em nenhuma linha — espaço morto repetido
verticalmente em toda a lista.

### Existe coluna que ocupa espaço sem agregar informação?

Sim: a coluna "Período" nas visões Mensais (ver acima). Na visão Sprint
atual, o período por cliente até variava (cada sprint tem sua própria
janela), mas essa data não está entre as informações que o gestor precisa
pra decidir algo em 3 segundos (Cliente, Investimento, Status, Tarefas,
Otimizações) — é um detalhe disponível ao abrir o card (`SprintCardBody` já
mostra o período da sprint com destaque), não algo que precisa de uma
coluna própria na leitura fechada.

---

## 2. Problemas encontrados

1. Coluna "Período" repetida em toda linha nas visões Mensal Consolidado e
   Mensal por Sprints — informação já global à tela.
2. Coluna "Período" presente na leitura fechada de todas as 3 visões de
   Sprints mesmo quando não carrega decisão nenhuma — ocupava a 3ª posição,
   adiando Investimento pra 4ª.
3. "Status" (Ritmo financeiro / situação do mês) aparecia por último em
   Sprints e no meio de Relatórios/Visão Geral — nenhuma posição fixa entre
   telas.
4. `ClientObjectiveTable` (Visão Geral) tinha Gestor e Plataforma antes de
   Investimento — a informação de identidade/contexto competia com o
   indicador operacional mais importante da linha.
5. `reports/page.tsx` tinha Gestor entre Investimento/% e o resto — mesma
   inconsistência.
6. `TeamTable` (Equipe) não representa contas/sprints (é um roster de
   pessoas — Membro/Cargo/Papel/Clientes/Status/Acesso) — a ordem canônica
   Cliente→Investimento→Status→Tarefas→Revisões não tem equivalente direto
   ali; forçá-la exigiria inventar colunas que não existem. **Não alterado**
   — ver "Limitações".
7. Página do Cliente (listas de tarefas/revisões): já não repete o nome do
   cliente por linha (contexto único da página) — nenhuma mudança
   necessária ali.

---

## 3. Nova arquitetura das tabelas

Ordem fixa adotada em toda tabela cujas linhas representam **contas/
clientes** (Sprints × 3 visões, Visão Geral, Relatórios):

**Cliente → Investimento → Status → (Tarefas → Revisões, quando existirem
no nível da linha) → outras informações (Gestor, Plataforma, Meta, Sprint
atual etc.) → Ação**

O "Período", quando é informação global (mesmo valor em toda linha),
deixa de ser coluna: passa a existir só no contexto da tela (aba ativa +
navegador de mês, já visíveis, sem necessidade de repetir a frase). Quando
o período de fato diferencia elementos de uma mesma lista — as sprints
individuais dentro do card expandido de "Mensal por Sprints" — ele
continua existindo, ocupando a única posição que já ficava vazia na linha
filha (a coluna "Cliente/Gestor", ociosa porque a indentação já identifica
o cliente).

---

## 4. Memória espacial

Auditoria: Investimento, Status, Tarefas e Revisões mudavam de posição
entre as 3 visões de Sprints (Status era sempre a última coluna) e entre
Sprints/Visão Geral/Relatórios (cada tabela tinha sua própria ordem). Depois
da padronização, as 3 visões de Sprints usam literalmente o mesmo
`ROW_GRID_CLASSES` (garantia estrutural, não só visual) e Visão Geral/
Relatórios seguem a mesma sequência conceitual (Cliente, Investimento,
Status, depois contexto, depois ação) — um gestor que aprende onde olhar
numa tela aplica o mesmo hábito nas outras.

---

## 5. Scan — teste dos 3 segundos

- **Sprints (as 3 visões):** Cliente (nome em negrito) → Investimento (2ª
  coluna, valor + barra) → Status (badge, 3ª coluna) → Tarefas → Otimizações.
  Antes, o olho precisava pular a coluna Período (sem sinal nenhum) pra
  chegar em Investimento; agora Investimento é a próxima coisa depois do
  nome.
- **Visão Geral:** Cliente → Investimento (valor em negrito, ver Information
  Design 1.0) → Ritmo financeiro (StatusDot) → Gestor/Plataforma (contexto)
  → métricas de objetivo → Sprint atual → Abrir cliente.
- **Relatórios:** Cliente → Investimento/% realizado → Situação do mês →
  Gestor → Status do relatório → Abrir relatório.

Em todas as três, as 3 primeiras colunas depois do nome respondem
Investimento/Status sem precisar procurar.

---

## 6. Information Density

- Removida a coluna "Período" das 3 visões de Sprints na leitura fechada
  (recuperando ~84px de largura útil, redistribuídos entre Cliente/Gestor e
  Investimento).
- Nenhuma coluna nova foi criada — a densidade caiu (menos colunas), nunca
  subiu.
- O espaço da coluna "Cliente/Gestor" nas linhas filhas de sprint (antes
  vazio, só indentação) passou a carregar a única informação de período que
  ainda faz sentido mostrar — zero desperdício, zero coluna nova.

---

## Mudanças implementadas — Antes e Depois

### 1. `src/app/sprints/row-grid.ts` (`ROW_GRID_CLASSES`)
- **Antes:** `caret · Cliente/Gestor(1.4fr) · Período(84px) · Investimento(1.3fr) · Tarefas(84px) · Otimizações(76px) · Status(104px)`.
- **Depois:** `caret · Cliente/Gestor(1.5fr) · Investimento(1.3fr) · Status(104px) · Tarefas(76px) · Otimizações(84px)`.
- **Por quê:** aplica a ordem canônica (Cliente→Investimento→Status→Tarefas→Revisões) e remove a coluna de período redundante, liberando espaço.

### 2. `src/app/sprints/account-card-summary.tsx`
- **Antes:** exibia `periodLabel` (mês ou data da sprint) como coluna própria, com Status por último.
- **Depois:** `periodLabel` removido do componente inteiramente (prop e renderização, mobile e desktop); Status passou a ser a 3ª coluna, logo após Investimento.
- **Por quê:** nas visões Mensais, `periodLabel` era sempre o mesmo texto em toda linha; na Sprint atual, não carrega decisão. O contexto de período continua visível na tela (aba + navegador de mês) e, quando relevante, no card aberto.

### 3. `src/app/clients/sprint-card.tsx` (modo `flat`, usado só em Mensal por Sprints)
- **Antes:** coluna "Cliente/Gestor" vazia (só indentação); coluna "Período" própria mostrando a data da sprint; Status por último.
- **Depois:** a data da sprint ("01–05 jul" etc.) ocupa a coluna "Cliente/Gestor" (antes ociosa); coluna "Período" dedicada removida; Status movido para logo após Investimento.
- **Por quê:** esta é a única lista da plataforma onde o período de fato diferencia elementos entre si (cada sprint do mês tem sua própria janela) — a exceção explícita do princípio da etapa. Reaproveitar a coluna já vazia evita criar uma coluna nova só pra isso.

### 4. `src/app/sprints/page.tsx` (cabeçalho de colunas)
- **Antes:** `Cliente / Gestor · Período · Investimento · Tarefas · Otimiz. · Status`.
- **Depois:** `Cliente / Gestor · Investimento · Status · Tarefas · Otimiz.`.
- **Por quê:** o cabeçalho precisa refletir exatamente as colunas da leitura fechada, que perdeu "Período" e reordenou "Status".

### 5. `src/app/client-objective-table.tsx` (Visão Geral)
- **Antes:** `Cliente · Gestor · Plataforma · Investimento · [Resultado/Custo/Meta] · Ritmo financeiro · Sprint atual · Abrir cliente`.
- **Depois:** `Cliente · Investimento · Ritmo financeiro · Gestor · Plataforma · [Resultado/Custo/Meta] · Sprint atual · Abrir cliente`.
- **Por quê:** aplica a mesma ordem canônica das tabelas de Sprints — Investimento e Status (Ritmo financeiro) sobem para logo depois do nome do cliente; Gestor/Plataforma (contexto, não decisão) descem.

### 6. `src/app/reports/page.tsx`
- **Antes:** `Cliente · Gestor · Investimento · % realizado · Situação do mês · Status do relatório · Ação`.
- **Depois:** `Cliente · Investimento · % realizado · Situação do mês · Gestor · Status do relatório · Ação`.
- **Por quê:** mesma padronização — Investimento e a situação do mês (Status) ficam adjacentes ao nome; Gestor vira contexto, não abre a sequência.

---

## 7. Ganho esperado de velocidade de leitura

- Nas 3 visões de Sprints, o gestor não precisa mais pular uma coluna sem
  sinal (Período repetido) pra chegar em Investimento — a 2ª coisa que o
  olho encontra depois do nome já é o número que importa.
- Status (a classificação operacional mais usada pra decidir onde olhar
  primeiro) ocupa a mesma posição relativa (logo após Investimento) nas 4
  tabelas de contas da plataforma — o gestor deixa de precisar "re-aprender"
  a tela ao trocar entre Sprints, Visão Geral e Relatórios.
- Eliminar a repetição do mês em toda linha das visões Mensais remove uma
  leitura redundante por linha — em uma lista de 20 clientes, isso é 20
  leituras de um texto que não muda nunca.

## 8. Arquivos alterados

- `src/app/sprints/row-grid.ts`
- `src/app/sprints/account-card-summary.tsx`
- `src/app/sprints/current-client-group.tsx`
- `src/app/sprints/monthly-consolidated-group.tsx`
- `src/app/sprints/monthly-sprints-group.tsx`
- `src/app/sprints/page.tsx`
- `src/app/clients/sprint-card.tsx`
- `src/app/client-objective-table.tsx`
- `src/app/reports/page.tsx`

## 9. Limitações

- `TeamTable` (Equipe) não foi alterada: suas linhas representam pessoas
  (Membro/Cargo/Papel/Clientes/Status/Acesso), não contas/clientes — a
  ordem canônica Cliente→Investimento→Status→Tarefas→Revisões não tem
  equivalente direto nesse domínio. Forçar essa ordem exigiria inventar
  colunas sem sentido, o que a etapa proíbe explicitamente ("apenas
  reorganizar leitura", não criar informação nova.
- As listas internas da página do Cliente (tarefas, revisões de conta) já
  não repetiam informação global por linha (o nome do cliente é contexto
  único da página) — auditadas, nenhuma mudança foi necessária.
- Validação de Desktop/Mobile feita por leitura de código e lint/typecheck/
  build — sem navegador interativo disponível neste ambiente para captura
  de tela real; a estrutura do grid (`ROW_GRID_CLASSES`) permanece
  `hidden sm:grid`, então o comportamento mobile (linha corrida, sem grid)
  não foi tocado por esta etapa além da remoção do texto de período.

## 10. Próximas melhorias

1. Avaliar se `TeamTable` deveria ganhar uma coluna "Ação" fixa antes de
   "Status"/"Acesso" pra também seguir um padrão de "ação sempre no fim,
   identidade sempre no início" — hoje ela já segue isso parcialmente
   (Membro primeiro, Ação por último), mas não foi formalizado nesta etapa.
2. Levar a mesma auditoria de "informação repetida por linha" para
   `/clients` (lista de clientes) e `/settings`, não cobertas explicitamente
   nesta etapa por não terem sido citadas no escopo pedido.
