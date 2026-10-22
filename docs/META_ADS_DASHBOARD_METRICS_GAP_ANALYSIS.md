# Dashboard Meta Ads — levantamento de métricas adicionais (Etapa 2.3, atualizado na Etapa 2.4)

KOFF Analytics Fase 2, Etapa 2.3 — pedido explícito do usuário: "faça um
levantamento dos campos adicionais necessários para futuramente oferecer
mais métricas, especialmente cliques no link, CTR do link, CPC do link,
leads, conversas, compras, receita atribuída e ROAS. Nesta etapa, apenas
documente... Não altere o pipeline sem aprovação."

Este documento só descreve o que falta. Nenhuma linha de ingestão foi
alterada pela Etapa 2.3.

> **Atualização — Etapa 2.4:** o usuário autorizou explicitamente a
> implementação do Gap A ("Pode implementar a extensão necessária para
> cliques no link, CTR do link e CPC do link"). O Gap A foi implementado
> nesta etapa — ver seção "Gap A — status: implementado" abaixo. O Gap B
> ("conversas") foi investigado a fundo, mas permanece documentado e NÃO
> implementado, por decisão do próprio usuário ("Se exigir uma mudança
> estrutural significativa, documente e deixe para aprovação separada") —
> ver seção "Gap B — investigação concluída" abaixo. Duas novas limitações
> estruturais, descobertas durante a implementação da tabela de exploração
> da Etapa 2.4, também foram documentadas no final deste arquivo.

> **Atualização — "Cockpit único por cliente":** a rota separada
> `/clients/[id]/meta-ads` citada ao longo deste documento (Etapas 2.1-2.4.1)
> foi REMOVIDA — a pedido explícito do usuário ("só quero essa página no
> sistema para cada cliente"), todo o conteúdo (cards de KPI, evolução,
> exploração Campanha→Conjunto→Anúncio) passou a viver dentro do Cockpit
> Único do Cliente (`app/clients/[id]/page.tsx`, seção "Performance Meta
> Ads"). Os núcleos puros (`lib/meta-ads-dashboard/*`) e os gaps/limitações
> documentados abaixo continuam os MESMOS, só a página que os consome
> mudou — leia as menções a "Dashboard Meta Ads"/"`/clients/[id]/meta-ads`"
> daqui pra baixo como a seção "Performance Meta Ads" do Cockpit.

## Resumo

| Métrica | Precisa de ingestão nova? | Status |
|---|---|---|
| Cliques no link | Sim | **Implementado na Etapa 2.4** (ver Gap A) |
| CTR do link | Sim (depende do campo acima) | **Implementado na Etapa 2.4** — nenhum cálculo novo, só o campo acima |
| CPC do link | Sim (depende do campo acima) | **Implementado na Etapa 2.4** — nenhum cálculo novo, só o campo acima |
| Leads | Não | Já suportado via `PerformanceGoal = "leads"` + `metric_mappings` por cliente |
| Compras | Não | Já suportado via `PerformanceGoal = "sales"` + `metric_mappings` por cliente |
| Receita atribuída | Não | Já suportado via `metric_mappings.value_column`/`action_values` (já buscado bruto) |
| ROAS | Não | Já calculado (`computeRoas`, `lib/performance.ts`) sempre que há receita |
| Conversas | Sim, a maior | Investigado na Etapa 2.4, **não implementado** — ver Gap B |

## Gap A — Cliques no link / CTR do link / CPC do link — status: implementado (Etapa 2.4)

**Implementado:** `inline_link_clicks` agora é buscado em `INSIGHTS_FIELDS`
(`meta-api-fetch.ts`) e flui ponta a ponta até uma nova coluna
`link_clicks` em `campaign_daily_metrics`, `ad_set_daily_metrics` e
`ad_creative_daily_metrics` (migração `supabase/meta-ads-link-clicks.sql`
— **precisa ser executada manualmente contra o banco**, não se aplica por
conta própria). `CampaignSummary`/`AdSetSummary`/`CreativeSummary` ganharam
`totalLinkClicks`, `cpm`, `linkCtr`, `linkCpc`, sempre calculados
separadamente de `ctr`/`cpc` (cliques totais). Os 3 novos cards de KPI
("Cliques no link", "CTR do link", "CPC do link") e as 3 novas séries do
gráfico de evolução usam exatamente esses campos — nunca uma aproximação a
partir de `clicks`.

**Limitação de histórico, apresentada ao usuário:** `link_clicks` só
existe a partir do dia em que a migração for executada E a sincronização
rodar novamente — qualquer dia já importado antes disso fica com
`link_clicks = null` (ausência de dado, nunca `0` fabricado); os cards/
colunas tratam esse `null` como "sem dado de cliques no link neste
período", nunca como zero real. CTR/CPC do link ficam `null` nesses casos
(nunca calculados a partir de uma base zerada).

**Observação (já válida antes, reconfirmada):** esse campo só afeta a
integração DIRETA Meta API (`meta-api-fetch.ts`). Clientes que usam Stract
pra Meta dependeriam de o Stract também expor essa coluna na extração —
fora do controle direto da MITZA; para esses clientes os cards/colunas de
cliques no link permanecem indisponíveis (nunca um "0" fabricado).

---

### Texto original do Gap A (Etapa 2.3, mantido como registro histórico)

**O que existe hoje:** `meta-api-fetch.ts` busca `clicks` (TODOS os cliques no
anúncio — inclui curtidas, compartilhamentos, visitas ao perfil em alguns
contextos de relatório da própria Meta), nunca `inline_link_clicks`
(cliques especificamente no link/CTA de destino). CPC/CTR hoje exibidos no
Dashboard (`lib/performance.ts`, `computeCtr`/`computeCpc`) são sempre sobre
"todos os cliques", nunca sobre "cliques no link" — são métricas
DIFERENTES, nunca a mesma coisa com nome trocado.

**O que falta:**
1. Adicionar `inline_link_clicks` a `INSIGHTS_FIELDS`
   (`src/lib/meta-api-fetch.ts`) — um campo a mais na mesma chamada que já
   existe, sem custo adicional de cota da API.
2. Nova coluna (ex.: `link_clicks integer`) nas tabelas granulares que
   devem expor essa métrica — pelo menos `campaign_daily_metrics` pra
   alimentar o Dashboard atual; para a futura exploração por campanha/
   conjunto/anúncio (`ad_set_daily_metrics`, `ad_creative_daily_metrics`),
   a mesma coluna também seria necessária lá.
3. Atualizar `MetaApiIngestRow` (`lib/meta-api-ingest.ts`),
   `mapMetaInsightsRowToIngestRow` (`lib/meta-api-fetch.ts`), a agregação e
   os upserts em `meta-api-ingest-run.ts`/`import-sources.ts` pra carregar o
   novo campo ponta a ponta.
4. CTR do link / CPC do link não exigem NENHUM cálculo novo —
   `computeCtr`/`computeCpc` (`lib/performance.ts`) já são genéricos; só
   precisam receber `link_clicks` em vez de `clicks` quando o usuário quiser
   ver a versão "do link".

**Observação:** esse campo só afeta a integração DIRETA Meta API (`meta-api-fetch.ts`).
Clientes que usam Stract pra Meta dependeriam de o Stract também expor essa
coluna na extração — fora do controle direto da MITZA.

## Gap B — "Conversas" como categoria própria — investigação concluída (Etapa 2.4)

**Pergunta do usuário:** "primeiro verifique se é possível expor o dado com
os mapeamentos existentes, sem ampliar desnecessariamente o enum
`PerformanceGoal`."

**O que a investigação encontrou:** existe um precedente direto —
`supabase/secondary-cart-metric.sql` ampliou o CHECK constraint de
`metric_mappings.goal` e `daily_performance.result_type` no BANCO para
incluir `'carts'`, **sem** tocar no enum TypeScript `PerformanceGoal`/
`PerformanceGoalDb` (que continua `"leads" | "sales" | "followers"`). O
comentário desse arquivo é explícito: "os agregados por campanha/público/
criativo (...) já têm guarda explícita 'leads/sales apenas' e continuam
ignorando 'carts' automaticamente nesses níveis — carrinho só existe no
nível de conta" (`daily_performance`, consumido hoje só por
`performance-report/report-data.ts` via um filtro ad-hoc
`(row.resultType as string) === "carts"`).

**Por que esse mesmo caminho NÃO alcança o pedido do usuário sem mudança
estrutural:** o pedido da Etapa 2.4 é expor "conversas" na NOVA tabela de
exploração, que é por CAMPANHA/CONJUNTO/ANÚNCIO — exatamente o nível que o
precedente de 'carts' deliberadamente EXCLUI. Alcançar isso exigiria mais
que ampliar um CHECK constraint: as funções de agregação por campanha/
conjunto/criativo em `import-sources.ts` (`aggregateCampaignDailyRows`/
`aggregateAdSetDailyRows`/`aggregateAdCreativeDailyRows`) recebem
`resultType` tipado estritamente como `PerformanceGoal | null` (o enum
TypeScript, não uma string livre) — ou seja, mesmo que o banco aceitasse
um novo valor de `result_type`, o pipeline de ingestão hoje não tem como
passar esse valor adiante nesses 3 níveis sem ampliar o próprio enum
`PerformanceGoal` (o que o usuário pediu para evitar) OU sem um cast
inseguro (`as PerformanceGoal`) que quebraria a garantia de tipo em todo
consumidor que hoje assume só 3 valores (Cockpit, Metas, Relatório de
Performance, o próprio Dashboard Meta Ads).

**Conclusão:** "conversas" a nível de CONTA poderia seguir exatamente o
padrão de 'carts' (ampliar só o CHECK constraint do banco, sem tocar no
enum TS) — mas o pedido da Etapa 2.4 era especificamente por campanha/
conjunto/anúncio, nível que exige ampliar o enum `PerformanceGoal` em TS e
revisar todo consumidor que assume 3 valores. Por isso, conforme a
instrução do próprio usuário, esse gap permanece documentado e **não
implementado** nesta etapa — fica para aprovação separada.

**O que falta, caso aprovado numa etapa futura (texto original da Etapa
2.3, ainda válido):** `PerformanceGoal`/`PerformanceGoalDb` (`lib/performance-goals.ts`,
`database.types.ts`) só tem três valores: `"leads" | "sales" | "followers"`.
Não existe uma categoria "conversas" (ex.: conversas iniciadas no Messenger/
WhatsApp via anúncio). O array `actions` já é buscado BRUTO e sem filtro
(`meta-api-fetch.ts`/`N8N_META_INGESTION_GUIDE.md` — "repasse bruto do que a
Meta devolveu, nunca filtrado"), então é provável que o `action_type` de
conversas já esteja chegando no payload hoje — só não existe pra onde
mapeá-lo.

**O que falta (mudança de schema, não só de ingestão):**
1. Estender o enum `PerformanceGoalDb` no banco (migração) e o tipo
   `PerformanceGoal` no TypeScript pra incluir um 4º valor (ex.:
   `"conversations"`).
2. Adicionar a entrada correspondente em `PERFORMANCE_GOALS`
   (`lib/performance-goals.ts` — rótulos, `resultMetricLabel`,
   `costMetricShortLabel` etc.).
3. Revisar todo consumidor que hoje assume só 3 valores possíveis (Cockpit,
   Metas, Relatório de Performance, Dashboard Meta Ads) — risco real de
   regressão se algum `switch`/mapa não for atualizado. Isso é bem mais que
   "ingestão": é uma mudança que atravessa o produto inteiro, por isso
   separada do Gap A.
4. **Nome exato do `action_type`** usado pela Meta pra conversa de
   mensagem precisa ser confirmado contra o payload real recebido no
   momento da implementação (mesma disciplina já documentada em
   `docs/N8N_META_INGESTION_GUIDE.md`: "`action_type` varia por tipo de
   campanha/pixel configurado, nunca adivinhe") — este documento
   deliberadamente não assume um valor.

## Já suportado hoje (configuração, não ingestão)

- **Leads**: `metric_mappings` do cliente mapeando o `action_type` de lead
  pra `result_type = "leads"` já funciona — nenhuma mudança de código.
- **Compras**: mesma mecânica, `result_type = "sales"`.
- **Receita atribuída**: `action_values` já é buscado bruto
  (`meta-api-fetch.ts`); aparece quando `metric_mappings.value_column` do
  cliente está configurado pro `action_type` de compra.
- **ROAS**: sempre derivado de receita ÷ investimento
  (`computeRoas`) — automático a partir do item acima, nenhum cálculo
  adicional necessário.

## Fora do escopo deste levantamento (mencionado só por completude)

**Múltiplos objetivos simultâneos**: hoje o Dashboard Meta Ads lê só
`clients.performance_goal` (o objetivo PRINCIPAL). Mostrar, por exemplo,
"Leads" E "Compras" ao mesmo tempo pro mesmo cliente exigiria também ler as
atribuições de objetivo SECUNDÁRIO já existentes em outra parte do produto
(`campaign-goal-assignments.ts`) — uma mudança na camada do Dashboard, não
no pipeline de ingestão. Não implementado nesta etapa.

## Gap C — `ad_creative_daily_metrics` não tem vínculo com conjunto (descoberto na Etapa 2.4)

**O que existe hoje:** a tabela `ad_creative_daily_metrics` (e o tipo
`AdCreativeDailyMetricRow` em `lib/creative-analytics.ts`) tem
`campaignName`/`campaignId`, mas **nenhuma coluna de conjunto**
(`adSetName`/`adSetId` não existem). Não há, portanto, nenhum jeito de
filtrar "anúncios pertencentes a este conjunto específico" — só "anúncios
pertencentes a esta campanha".

**Impacto na tabela de exploração da Etapa 2.4:** o pedido original era um
drill-down Conta → Campanhas → Conjuntos → Anúncios. Como não existe o
vínculo anúncio↔conjunto, "Conjuntos" e "Anúncios" foram implementados como
abas IRMÃS dentro de uma campanha selecionada (as duas filtradas pela MESMA
campanha), em vez de um drill-down real Conjunto → seus Anúncios. A UI
apresenta essa limitação de forma explícita (texto na própria tela), em vez
de fingir um filtro que não funcionaria. Corrigir isso de verdade exigiria
uma migração de schema (nova coluna + preenchê-la na ingestão a partir do
`adset_id` que a Graph API já retorna no nível `level=ad`) — fora do escopo
desta etapa (métricas/tabelas/organização visual), fica para aprovação
separada caso o usuário queira o drill-down completo.

### Gap C — proposta de solução (Etapa 2.4.1, investigação — NÃO implementada)

**Pedido do usuário:** "Investigue a melhor maneira de preservar o vínculo
entre anúncios e conjuntos usando os identificadores existentes da Meta
API... apresente a solução e os impactos antes de implementá-la."

**O que a investigação encontrou — o dado já existe, só não é lido:** a
chamada que já faz a ingestão direta Meta API (`fetchMetaApiInsightsForAccount`,
`meta-api-fetch.ts`, `level=ad`) **já busca `adset_id`** no mesmo payload
(`INSIGHTS_FIELDS` inclui `adset_id` desde sempre) e `mapMetaInsightsRowToIngestRow`
**já mapeia** isso pra `MetaApiIngestRow.adSetId`. `meta-api-ingest.ts`
**já valida e grava** esse campo numa coluna bruta `ad_set_id` em toda
linha achatada (`flattenMetaApiRowToRawSourceRow`). Ou seja: **nenhuma
nova chamada à Graph API é necessária** — o identificador correto já
chega até a camada de agregação hoje, pra TODO cliente na integração
direta Meta API.

**Onde o vínculo se perde:** `aggregateAdCreativeDailyRows`
(`import-sources.ts`, linha ~314) — a única das 3 funções de agregação que
NÃO tem um parâmetro `adSetIdColumn` (compare com `aggregateAdSetDailyRows`,
que já tem). A chamada em `meta-api-ingest-run.ts` (linha ~290) por isso
nunca passa `META_API_COLUMNS.adSetId` pra ela, mesmo a coluna bruta
`ad_set_id` já existindo na linha. O dado chega na porta e é descartado
ali.

**Solução proposta (NÃO implementada nesta etapa):**
1. Adicionar `adSetIdColumn?: string | null` a `AggregateAdCreativeRowsColumns`
   e um campo `adSetId: string | null` a `AggregatedAdCreativeRow` (mesmo
   padrão já usado pra `adIdColumn`/`adId` na mesma função).
2. Nova coluna `ad_set_id text` em `ad_creative_daily_metrics` (migração
   aditiva, mesmo padrão de `link_clicks`) + `buildAdCreativeDailyMetricsUpsertRows`
   gravando-a + `creative-analytics-data.ts`/`AdCreativeDailyMetricRow`/
   `exploration-data.ts` expondo-a até a UI.
3. `meta-api-ingest-run.ts` passa a repassar `adSetIdColumn: META_API_COLUMNS.adSetId`
   pra `aggregateAdCreativeDailyRows` (1 linha).
4. `ExplorationSection` troca o filtro de Anúncios de "mesma campanha" pra
   "mesmo `adSetId`" quando um conjunto estiver selecionado — aí sim um
   drill-down real Conjunto → seus Anúncios, nunca uma lista que mistura
   anúncios de outros conjuntos.

**Impactos a avaliar antes de aprovar:**
- **Histórico**: `ad_set_id` nasceria `null` em toda linha já gravada
  (mesma limitação de `link_clicks`) — anúncios de sincronizações antigas
  só ganhariam o vínculo depois da primeira sincronização seguinte à
  migração. Dashboard precisaria da mesma salvaguarda de
  `requireQueryToleratingMissingColumn` já aplicada nesta etapa.
- **Só integração direta Meta API**: clientes via Stract continuariam sem
  esse vínculo (Stract não expõe `adset_id` na extração hoje) — pra eles,
  "Conjuntos"/"Anúncios" permaneceriam abas irmãs (limitação já documentada
  no Gap C), nunca um drill-down fictício.
- **Caso de borda deliberadamente não resolvido por esta proposta**: a
  identidade de um criativo nesta tabela é o NOME do anúncio
  (`creativeName` = `ad_name`), não o `ad_id` — decisão de design
  pré-existente, documentada em `AggregateAdCreativeRowsColumns.adIdColumn`
  ("ids do Meta não são estáveis entre edições/reuploads"). Se o MESMO
  nome de anúncio existir em DOIS conjuntos diferentes dentro da mesma
  campanha (raro, mas possível — ex.: o mesmo criativo duplicado pra testar
  públicos diferentes), a agregação atual já funde as duas linhas numa só
  (soma o spend das duas) — comportamento pré-existente, sem relação com
  esta proposta. A solução acima anexaria o `adSetId` da PRIMEIRA linha
  vista a essa linha já fundida (mesmo critério de `adIdColumn`/`campaignId`
  hoje), então nesse caso raro o drill-down mostraria o anúncio fundido só
  no conjunto "errado" (o primeiro). Resolver isso de verdade exigiria
  trocar a chave de agrupamento pra incluir `adSetId`
  (`${date} ${campaignName} ${adSetId} ${creativeName}`), o que divide essa
  fusão em linhas separadas — uma mudança de granularidade mais ampla, que
  afetaria a leitura de todo cliente na integração direta Meta API (ainda
  que o Relatório de Performance não pareça depender dessa granularidade
  especificamente). Fica como uma segunda opção, mais completa e mais
  arriscada, pra decisão do usuário — a proposta principal acima (1-4) já
  resolve o caso comum sem essa mudança de granularidade.
- Nenhuma mudança nesta lista foi implementada — aguardando aprovação
  explícita, conforme pedido.

## Gap D — `totalReach` pré-existente soma alcance entre dias (descoberto na Etapa 2.4)

**O que existe hoje:** `CampaignSummary.totalReach`/`AdSetSummary.totalReach`/
`CreativeSummary.totalReach` (em `campaign-analytics.ts`/`ad-set-analytics.ts`/
`creative-analytics.ts`, já existentes antes da Etapa 2.4 e consumidos hoje
pelo Relatório de Performance) são calculados somando `reach` dia a dia
(`sumNullable`) — exatamente a prática que o usuário pediu para NUNCA fazer
("não somar métricas não aditivas, especialmente alcance e frequência"),
porque o mesmo usuário pode ser contado em vários dias do período.

**Decisão nesta etapa:** esse código é PRÉ-EXISTENTE e alimenta hoje o
Relatório de Performance — corrigi-lo está fora do escopo da Etapa 2.4
(que é sobre o Dashboard Meta Ads, não sobre o Relatório) e qualquer
mudança ali exigiria aprovação separada por poder alterar números já
exibidos a clientes. Por isso, a NOVA tabela de exploração desta etapa
(`exploration-data.ts`) **não tem nenhuma coluna de alcance** — assim a
violação pré-existente não é estendida pra uma nova superfície. A única
fonte correta de alcance/frequência no Dashboard Meta Ads continua sendo o
snapshot dedicado de período inteiro via Graph API
(`fetchAccountPeriodReachSnapshot`, já usado pelos cards de KPI desde a
Etapa 2.2), nunca uma soma diária.

### Gap D — exatamente onde ocorre e quais telas são afetadas (Etapa 2.4.1)

**Pedido do usuário:** "Verifique o problema identificado... Documente
exatamente onde ocorre, quais telas são afetadas e como corrigir sem
gerar chamadas excessivas à Graph API. Não amplie o escopo da correção
sem aprovação."

**Onde ocorre exatamente:**
- `lib/campaign-analytics.ts:109`, `lib/ad-set-analytics.ts:107`,
  `lib/creative-analytics.ts:206` — a mesma linha nos 3 arquivos:
  `acc.totalReach = sumNullable(acc.totalReach, row.reach)`, dentro do
  loop que acumula linha-por-dia de `campaign_daily_metrics`/
  `ad_set_daily_metrics`/`ad_creative_daily_metrics`.
- O valor somado só é efetivamente EXIBIDO em
  `lib/performance-report/report-document.ts` — coluna "Alcance" nas 3
  tabelas (`buildCampaignsTable` linha ~274/298, e as equivalentes de
  Conjuntos linha ~335/357 e Criativos linha ~440/465). Nenhuma outra
  lógica (badges, ranking de melhor custo/maior volume, metas) usa
  `totalReach` — só essa coluna de tabela.

**Quais telas são afetadas** (todas as que renderizam essas 3 tabelas,
via `report-document.ts`):
1. `/clients/[id]/relatorio` — Relatório de Performance interno.
2. `/r/[token]` — o mesmo relatório, link público compartilhado.
3. `/api/clients/[id]/performance-report` — rota de API que serve os
   mesmos dados (export/PDF).

O Dashboard Meta Ads (`/clients/[id]/meta-ads`, Etapas 2.1-2.4) **não é
afetado** — ele nunca usa `totalReach`; alcance/frequência já vêm sempre
do snapshot de período inteiro via Graph API (ver acima), e a nova tabela
de exploração desta etapa deliberadamente não tem coluna de alcance.

**Como corrigir sem gerar chamadas excessivas à Graph API (proposta, NÃO
implementada):** `fetchMetaApiPeriodReach(accountId, level, since, until)`
(`meta-api-fetch.ts`, já existe desde a Etapa 2.2) aceita
`level: "campaign" | "adset" | "ad"` e devolve, numa ÚNICA chamada, o
alcance de TODAS as entidades daquele nível de uma vez — exatamente o
mesmo padrão já usado pro alcance de conta no Dashboard
(`fetchAccountPeriodReachSnapshot`). Pra corrigir o Relatório, bastariam
**3 chamadas por geração de relatório** (uma por nível — campanha/
conjunto/anúncio — nunca uma por entidade), substituindo `totalReach`
nas 3 tabelas por esse valor, mesclado por id/nome igual já é feito nas
outras camadas desta etapa.

**Limitação que a correção não resolve (nem deveria, sem aprovação
separada):** esse período-dedup só existe na integração DIRETA Meta API.
Clientes só com Stract não têm um endpoint equivalente — pra eles, a
coluna "Alcance" nas 3 tabelas precisaria ficar oculta (nunca mostrar um
número sabidamente errado), em vez de hoje aparecer somada sempre que há
qualquer dado de alcance.

**Por que não foi implementado nesta etapa:** a correção toca
`report-document.ts`/`report-data.ts` — código que já está em produção e
é usado por clientes reais HOJE, fora do escopo do Dashboard Meta Ads
(Etapas 2.1-2.4). Implementar isso muda um número já exibido a clientes e
exige uma nova chamada de API em um fluxo que hoje não faz nenhuma (custo/
latência adicional do Relatório), por isso fica documentado para
aprovação e implementação separadas, conforme pedido explícito do
usuário.
