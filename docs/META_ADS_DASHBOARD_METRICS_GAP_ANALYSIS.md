# Dashboard Meta Ads — levantamento de métricas adicionais (Etapa 2.3)

KOFF Analytics Fase 2, Etapa 2.3 — pedido explícito do usuário: "faça um
levantamento dos campos adicionais necessários para futuramente oferecer
mais métricas, especialmente cliques no link, CTR do link, CPC do link,
leads, conversas, compras, receita atribuída e ROAS. Nesta etapa, apenas
documente... Não altere o pipeline sem aprovação."

Este documento só descreve o que falta. Nenhuma linha de ingestão foi
alterada por esta etapa.

## Resumo

| Métrica | Precisa de ingestão nova? | O que falta |
|---|---|---|
| Cliques no link | **Sim** | Novo campo `inline_link_clicks` (ver Gap A) |
| CTR do link | **Sim** (depende do campo acima) | Nenhum cálculo novo — só o campo acima |
| CPC do link | **Sim** (depende do campo acima) | Nenhum cálculo novo — só o campo acima |
| Leads | **Não** | Já suportado via `PerformanceGoal = "leads"` + `metric_mappings` por cliente |
| Compras | **Não** | Já suportado via `PerformanceGoal = "sales"` + `metric_mappings` por cliente |
| Receita atribuída | **Não** | Já suportado via `metric_mappings.value_column`/`action_values` (já buscado bruto) |
| ROAS | **Não** | Já calculado (`computeRoas`, `lib/performance.ts`) sempre que há receita |
| Conversas | **Sim, a maior** | Categoria de resultado inexistente hoje (ver Gap B) |

## Gap A — Cliques no link / CTR do link / CPC do link

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

## Gap B — "Conversas" como categoria própria (o maior gap)

**O que existe hoje:** `PerformanceGoal`/`PerformanceGoalDb` (`lib/performance-goals.ts`,
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
