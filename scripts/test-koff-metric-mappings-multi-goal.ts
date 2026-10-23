/**
 * Testes da Etapa "KOFF Analytics — Reestruturar lógica de mapeamento de
 * objetivos" (pedido explícito do usuário, a partir da tela "Conexão
 * Meta"): "tem contas que tem mais de um objetivo ou então mudam com o
 * tempo" — corrige o bug real encontrado na auditoria: a sincronização
 * escolhia UM objetivo "vencedor" pra TODO o lote (primeiro objetivo
 * mapeado com qualquer dado, `break`) e descartava silenciosamente as
 * campanhas de qualquer outro objetivo mapeado simultaneamente, nas 4
 * tabelas granulares (`campaign_daily_metrics`/`ad_set_daily_metrics`/
 * `ad_creative_daily_metrics`/`campaign_placement_daily_metrics`).
 *
 * A correção resolve o objetivo POR CHAVE (data+campanha[+conjunto/
 * anúncio/posicionamento]) em vez de uma vez só pro lote inteiro — nenhuma
 * mudança de schema, nenhum consumidor downstream precisou mudar (ver
 * `resolveGroupResultByGoalPriority`, `lib/meta-api-ingest-run.ts`).
 *
 * Rodar: npx tsx scripts/test-koff-metric-mappings-multi-goal.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveCampaignGroupResult,
  resolveAdSetGroupResult,
} from "../src/lib/meta-api-ingest-run";
import { flattenMetaApiRowsToRawSourceRows, type MetaApiIngestRow } from "../src/lib/meta-api-ingest";
import { buildCampaignDailyMetricsUpsertRows, aggregateCampaignDailyRows } from "../src/lib/import-sources";
import type { PerformanceGoal } from "../src/lib/performance-goals";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

function row(overrides: Partial<MetaApiIngestRow> & { date: string; campaignId: string; campaignName: string }): MetaApiIngestRow {
  return { spend: 0, ...overrides };
}

type MappingGroups = Map<PerformanceGoal, { resultColumns: string[]; valueColumns: string[] }>;

function mappings(entries: [PerformanceGoal, string[], string[]?][]): MappingGroups {
  const map: MappingGroups = new Map();
  for (const [goal, resultColumns, valueColumns] of entries) map.set(goal, { resultColumns, valueColumns: valueColumns ?? [] });
  return map;
}

// ---------------------------------------------------------------------------
console.log("\nA — O bug real: conta com 2 objetivos mapeados simultaneamente, campanhas DIFERENTES\n");
{
  const rows = flattenMetaApiRowsToRawSourceRows([
    row({ date: "2026-10-01", campaignId: "1", campaignName: "Campanha Leads", actions: { lead: 5 } }),
    row({ date: "2026-10-01", campaignId: "2", campaignName: "Campanha Vendas", actions: { purchase: 3 } }),
  ]);
  const mappingGroupsByGoal = mappings([
    ["leads", ["actions.lead"]],
    ["sales", ["actions.purchase"]],
  ]);

  const { resultTypeByGroup, resultByGroup } = resolveCampaignGroupResult(rows, mappingGroupsByGoal);

  ok(
    "Campanha Leads resolve 'leads' (nunca descartada por causa do objetivo da outra campanha)",
    resultTypeByGroup?.get("2026-10-01 Campanha Leads") === "leads",
  );
  ok("Campanha Vendas resolve 'sales' — o bug antigo descartava essa campanha inteira", resultTypeByGroup?.get("2026-10-01 Campanha Vendas") === "sales");
  ok("Campanha Leads: resultCount=5, a contagem certa, nunca 0/descartada", resultByGroup?.get("2026-10-01 Campanha Leads") === 5);
  ok("Campanha Vendas: resultCount=3", resultByGroup?.get("2026-10-01 Campanha Vendas") === 3);

  // Fecha o laço: o builder de upsert (consumidor real) também grava as DUAS
  // campanhas corretamente, nunca só a do objetivo "vencedor" de antes.
  const aggregated = aggregateCampaignDailyRows(rows, {
    dateColumn: "date",
    campaignNameColumn: "campaign_name",
    spendColumn: "spend",
    impressionsColumn: "impressions",
    reachColumn: "reach",
    clicksColumn: "clicks",
    linkClicksColumn: "link_clicks",
    campaignIdColumn: "campaign_id",
  });
  const upsertRows = buildCampaignDailyMetricsUpsertRows("client-1", "source-1", "meta", aggregated, {
    resultTypeByGroup,
    resultByGroup,
    revenueByGroup: null,
  });
  const leadsRow = upsertRows.find((r) => r.campaign_name === "Campanha Leads");
  const salesRow = upsertRows.find((r) => r.campaign_name === "Campanha Vendas");
  ok("linha de upsert da Campanha Leads: result_type=leads, result_count=5", leadsRow?.result_type === "leads" && leadsRow?.result_count === 5);
  ok(
    "linha de upsert da Campanha Vendas: result_type=sales, result_count=3 (as DUAS campanhas sobrevivem na mesma sincronização)",
    salesRow?.result_type === "sales" && salesRow?.result_count === 3,
  );
}

// ---------------------------------------------------------------------------
console.log("\nB — Objetivo muda com o tempo: MESMA campanha, datas diferentes, objetivos diferentes\n");
{
  const rows = flattenMetaApiRowsToRawSourceRows([
    row({ date: "2026-08-01", campaignId: "1", campaignName: "Campanha Sazonal", actions: { lead: 10 } }),
    row({ date: "2026-10-01", campaignId: "1", campaignName: "Campanha Sazonal", actions: { purchase: 4 } }),
  ]);
  const mappingGroupsByGoal = mappings([
    ["leads", ["actions.lead"]],
    ["sales", ["actions.purchase"]],
  ]);

  const { resultTypeByGroup, resultByGroup } = resolveCampaignGroupResult(rows, mappingGroupsByGoal);

  ok("agosto (quando o objetivo era leads) resolve 'leads'", resultTypeByGroup?.get("2026-08-01 Campanha Sazonal") === "leads");
  ok("outubro (quando o objetivo virou vendas) resolve 'sales' — nenhuma reconfiguração manual necessária", resultTypeByGroup?.get("2026-10-01 Campanha Sazonal") === "sales");
  ok("cada data carrega o resultCount certo do SEU objetivo", resultByGroup?.get("2026-08-01 Campanha Sazonal") === 10 && resultByGroup?.get("2026-10-01 Campanha Sazonal") === 4);
}

// ---------------------------------------------------------------------------
console.log("\nC — Conflito genuíno: MESMA campanha+dia com resultado pra 2 objetivos mapeados ao mesmo tempo\n");
{
  const rows = flattenMetaApiRowsToRawSourceRows([row({ date: "2026-10-01", campaignId: "1", campaignName: "Campanha Mista", actions: { lead: 5, purchase: 3 } })]);
  const mappingGroupsByGoal = mappings([
    ["leads", ["actions.lead"]],
    ["sales", ["actions.purchase"]],
  ]);

  const { resultTypeByGroup, resultByGroup } = resolveCampaignGroupResult(rows, mappingGroupsByGoal);

  ok("prioridade determinística decide (leads, nesta ordem fixa) — nunca arbitrário/dependente de ordem de query", resultTypeByGroup?.get("2026-10-01 Campanha Mista") === "leads");
  ok(
    "o resultCount é o do objetivo vencedor (5), NUNCA a soma dos dois objetivos incompatíveis (5+3=8 seria errado)",
    resultByGroup?.get("2026-10-01 Campanha Mista") === 5,
  );

  // Trocando a ordem de inserção no Map (sales primeiro) não muda o
  // resultado — a prioridade é uma constante fixa no código, nunca a ordem
  // de iteração do Map (que dependeria da ordem de retorno da query,
  // Etapa anterior já tinha esse achado documentado).
  const mappingGroupsReversed = mappings([
    ["sales", ["actions.purchase"]],
    ["leads", ["actions.lead"]],
  ]);
  const reversed = resolveCampaignGroupResult(rows, mappingGroupsReversed);
  ok("determinístico independente da ordem de inserção dos mapeamentos", reversed.resultTypeByGroup?.get("2026-10-01 Campanha Mista") === "leads");
}

// ---------------------------------------------------------------------------
console.log("\nD — 'Seguidores' continua fora do nível granular (comportamento preexistente, fora do escopo deste pedido)\n");
{
  const rows = flattenMetaApiRowsToRawSourceRows([row({ date: "2026-10-01", campaignId: "1", campaignName: "Campanha Seguidores", actions: { follow: 20 } })]);
  const mappingGroupsByGoal = mappings([["followers", ["actions.follow"]]]);

  const { resultTypeByGroup, resultByGroup } = resolveCampaignGroupResult(rows, mappingGroupsByGoal);
  ok("followers não aparece nas tabelas granulares (campanha) — mesmo comportamento de antes desta correção", resultTypeByGroup === null && resultByGroup === null);
}

// ---------------------------------------------------------------------------
console.log("\nE — Receita (value_column) continua resolvida POR CHAVE, nunca vazando pra campanha de outro objetivo\n");
{
  const rows = flattenMetaApiRowsToRawSourceRows([
    row({ date: "2026-10-01", campaignId: "1", campaignName: "Campanha Leads", actions: { lead: 5 } }),
    row({ date: "2026-10-01", campaignId: "2", campaignName: "Campanha Vendas", actions: { purchase: 3 }, actionValues: { purchase: 300 } }),
  ]);
  const mappingGroupsByGoal = mappings([
    ["leads", ["actions.lead"]],
    ["sales", ["actions.purchase"], ["actionValues.purchase"]],
  ]);

  const { revenueByGroup } = resolveCampaignGroupResult(rows, mappingGroupsByGoal);
  ok("Campanha Vendas recebe a receita mapeada (300)", revenueByGroup?.get("2026-10-01 Campanha Vendas") === 300);
  ok("Campanha Leads nunca recebe receita (objetivo leads não tem value_column mapeado)", revenueByGroup?.get("2026-10-01 Campanha Leads") === undefined);
}

// ---------------------------------------------------------------------------
console.log("\nF — Mesma correção vale pra Conjuntos (ad sets) — chave com outro formato, mesma lógica compartilhada\n");
{
  const rows = flattenMetaApiRowsToRawSourceRows([
    row({ date: "2026-10-01", campaignId: "1", campaignName: "Campanha X", adSetId: "as1", adSetName: "Público Leads", actions: { lead: 7 } }),
    row({ date: "2026-10-01", campaignId: "1", campaignName: "Campanha X", adSetId: "as2", adSetName: "Público Vendas", actions: { purchase: 2 } }),
  ]);
  const mappingGroupsByGoal = mappings([
    ["leads", ["actions.lead"]],
    ["sales", ["actions.purchase"]],
  ]);

  const { resultTypeByGroup, resultByGroup } = resolveAdSetGroupResult(rows, mappingGroupsByGoal);
  ok("Público Leads resolve 'leads'", resultTypeByGroup?.get("2026-10-01 Campanha X Público Leads") === "leads");
  ok("Público Vendas resolve 'sales' — dois conjuntos de objetivos diferentes na MESMA campanha, nenhum descartado", resultTypeByGroup?.get("2026-10-01 Campanha X Público Vendas") === "sales");
  ok("contagens corretas por conjunto", resultByGroup?.get("2026-10-01 Campanha X Público Leads") === 7 && resultByGroup?.get("2026-10-01 Campanha X Público Vendas") === 2);
}

// ---------------------------------------------------------------------------
console.log("\nH — 0 real nunca vira ausência: campanha com resultado GENUINAMENTE 0 (coluna presente, valor '0') continua distinta de campanha sem a coluna\n");
{
  const rows = flattenMetaApiRowsToRawSourceRows([
    row({ date: "2026-10-01", campaignId: "1", campaignName: "Campanha Zero Real", actions: { lead: 0 } }),
    row({ date: "2026-10-01", campaignId: "2", campaignName: "Campanha Sem Coluna" }),
  ]);
  const mappingGroupsByGoal = mappings([["leads", ["actions.lead"]]]);

  const { resultTypeByGroup, resultByGroup } = resolveCampaignGroupResult(rows, mappingGroupsByGoal);

  ok("campanha com 0 real (coluna presente, valor 0) resolve 'leads' normalmente — mesmo comportamento de sempre", resultTypeByGroup?.get("2026-10-01 Campanha Zero Real") === "leads");
  ok("resultCount é 0 de verdade (não null/ausente) pra quem teve a coluna presente com valor 0", resultByGroup?.get("2026-10-01 Campanha Zero Real") === 0);
  ok(
    "campanha SEM a coluna mapeada (nunca rodou pra esse objetivo) não aparece — nunca um 0 fabricado pra ela",
    !resultTypeByGroup?.has("2026-10-01 Campanha Sem Coluna") && !resultByGroup?.has("2026-10-01 Campanha Sem Coluna"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nG — checagem estrutural: o padrão antigo (1 objetivo vencedor + break, descartando os outros) foi removido\n");
{
  const ingestRunSource = loadSource("src", "lib", "meta-api-ingest-run.ts");
  ok(
    "resolveGroupResultByGoalPriority existe e é reaproveitado pelas 4 granularidades (nenhuma lógica duplicada/divergente)",
    (ingestRunSource.match(/return resolveGroupResultByGoalPriority\(/g) ?? []).length === 4,
  );
  ok("prioridade é uma ordem FIXA, nunca a ordem de iteração do Map vindo da query", ingestRunSource.includes("const GRANULAR_RESULT_GOAL_PRIORITY: PerformanceGoal[]"));
  ok(
    "nenhuma chave já resolvida por um objetivo é sobrescrita por outro (resolve por prioridade, nunca substitui)",
    ingestRunSource.includes("if (resultTypeByGroup.has(key)) continue;"),
  );

  const importSourcesSource = loadSource("src", "lib", "import-sources.ts");
  ok(
    "os 4 builders de upsert recebem resultType POR CHAVE (Map), nunca mais um único objetivo escalar pro lote inteiro",
    (importSourcesSource.match(/resultTypeByGroup\?: Map<string, PerformanceGoal> \| null;/g) ?? []).length === 4,
  );
}

console.log(`\n${passed} verificações OK.\n`);
