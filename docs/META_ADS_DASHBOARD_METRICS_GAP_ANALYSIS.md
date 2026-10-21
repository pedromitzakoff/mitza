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
