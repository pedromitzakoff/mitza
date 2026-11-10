/**
 * Testes da Etapa "Configuração inteligente de métricas por cliente" —
 * Etapas 1 e 2 do plano aprovado: dois objetivos novos ("conversations"/
 * "registrations") somados aos 3 já existentes (leads/sales/followers),
 * sem quebrar nenhum deles, e corretamente incluídos no nível GRANULAR
 * (campanha/conjunto/anúncio/posicionamento) — ao contrário de "followers",
 * que nunca entrou lá (não é atribuível a uma campanha individual).
 *
 * Cobre:
 *  A. `performance-goals.ts`: os 5 objetivos têm config completa, na ordem
 *     certa em `PERFORMANCE_GOAL_OPTIONS`; `parsePerformanceGoal` aceita os
 *     5 e rejeita qualquer outro valor (incluindo 'carts', que NUNCA é um
 *     PerformanceGoal de cliente).
 *  B. `resolveCampaignGroupResult`/`resolveAdSetGroupResult`: um objetivo
 *     novo ("conversations") se comporta EXATAMENTE como leads/sales no
 *     nível granular — nunca descartado, nunca somado com outro objetivo.
 *  C. Migração SQL (`performance-goal-conversations-registrations.sql`):
 *     os 3 grupos de constraint (puro/com 'carts'/granular) têm a lista de
 *     valores certa, cada um só com o que deveria ter — 'carts' nunca entra
 *     nas colunas puras, 'followers' nunca entra nas granulares.
 *  D. As 3 duplicações antigas de validação ("leads"/"sales"/"followers"
 *     hardcoded em 3 arquivos diferentes) viraram UMA fonte só
 *     (`parsePerformanceGoal`) — nunca mais um 4º lugar pra esquecer de
 *     atualizar na próxima vez que um objetivo for adicionado.
 *
 * Rodar: npx tsx scripts/test-koff-performance-goal-conversations-registrations.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PERFORMANCE_GOALS, PERFORMANCE_GOAL_OPTIONS, parsePerformanceGoal, type PerformanceGoal } from "../src/lib/performance-goals";
import { resolveCampaignGroupResult, resolveAdSetGroupResult } from "../src/lib/meta-api-ingest-run";
import { flattenMetaApiRowsToRawSourceRows, type MetaApiIngestRow } from "../src/lib/meta-api-ingest";

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
function mappings(entries: [PerformanceGoal, string[], string[]?][]) {
  const map = new Map<PerformanceGoal, { resultColumns: string[]; valueColumns: string[] }>();
  for (const [goal, resultColumns, valueColumns] of entries) map.set(goal, { resultColumns, valueColumns: valueColumns ?? [] });
  return map;
}

// ---------------------------------------------------------------------------
console.log("\nA — performance-goals.ts: 5 objetivos, config completa, parser único\n");
{
  ok("PERFORMANCE_GOAL_OPTIONS tem 5 objetivos", PERFORMANCE_GOAL_OPTIONS.length === 5);
  ok(
    "ordem: leads, sales, conversations, registrations, followers",
    PERFORMANCE_GOAL_OPTIONS.map((o) => o.value).join(",") === "leads,sales,conversations,registrations,followers",
  );

  for (const goal of ["conversations", "registrations"] as PerformanceGoal[]) {
    const config = PERFORMANCE_GOALS[goal];
    ok(`${goal}: tem resultMetricLabel`, typeof config.resultMetricLabel === "string" && config.resultMetricLabel.length > 0);
    ok(`${goal}: tem costMetricLabel ("Custo por X")`, config.costMetricLabel.toLowerCase().startsWith("custo por"));
    ok(`${goal}: tem costMetricShortLabel`, config.costMetricShortLabel.length > 0);
  }

  ok("costMetricLabel de 'conversations' é 'Custo por conversa' (pedido do usuário)", PERFORMANCE_GOALS.conversations.costMetricLabel === "Custo por conversa");
  ok("costMetricLabel de 'registrations' é 'Custo por cadastro' (pedido do usuário)", PERFORMANCE_GOALS.registrations.costMetricLabel === "Custo por cadastro");

  ok("parsePerformanceGoal aceita os 5 valores", (["leads", "sales", "followers", "conversations", "registrations"] as const).every((g) => parsePerformanceGoal(g) === g));
  ok("parsePerformanceGoal rejeita 'carts' — nunca um PerformanceGoal de cliente", parsePerformanceGoal("carts") === null);
  ok("parsePerformanceGoal rejeita lixo/vazio", parsePerformanceGoal("xyz") === null && parsePerformanceGoal(null) === null);
}

// ---------------------------------------------------------------------------
console.log("\nB — Nível granular: 'conversations' se comporta como leads/sales, nunca como followers\n");
{
  const rows = flattenMetaApiRowsToRawSourceRows([
    row({ date: "2026-11-01", campaignId: "1", campaignName: "Campanha Leads", actions: { lead: 5 } }),
    row({ date: "2026-11-01", campaignId: "2", campaignName: "Campanha WhatsApp", actions: { onsite_conversion_messaging_conversation_started_7d: 8 } }),
  ]);
  const mappingGroupsByGoal = mappings([
    ["leads", ["actions.lead"]],
    ["conversations", ["actions.onsite_conversion_messaging_conversation_started_7d"]],
  ]);

  const { resultTypeByGroup, resultByGroup } = resolveCampaignGroupResult(rows, mappingGroupsByGoal);

  ok("Campanha Leads resolve 'leads', intocada", resultTypeByGroup?.get("2026-11-01 Campanha Leads") === "leads");
  ok(
    "Campanha WhatsApp resolve 'conversations' — objetivo novo chega às tabelas de campanha, igual leads/sales",
    resultTypeByGroup?.get("2026-11-01 Campanha WhatsApp") === "conversations",
  );
  ok("Campanha WhatsApp: resultCount=8, nunca descartado por não ser leads/sales", resultByGroup?.get("2026-11-01 Campanha WhatsApp") === 8);

  // Mesmo comportamento no nível de conjunto (segunda granularidade real).
  const adSetRows = flattenMetaApiRowsToRawSourceRows([
    row({ date: "2026-11-01", campaignId: "1", campaignName: "Campanha Leads", adSetId: "as1", adSetName: "Conjunto A", actions: { lead: 2 } }),
    row({ date: "2026-11-01", campaignId: "2", campaignName: "Campanha WhatsApp", adSetId: "as2", adSetName: "Conjunto B", actions: { onsite_conversion_messaging_conversation_started_7d: 4 } }),
  ]);
  const { resultTypeByGroup: adSetResultTypeByGroup } = resolveAdSetGroupResult(adSetRows, mappingGroupsByGoal);
  ok(
    "Nível de CONJUNTO: 'conversations' também resolve corretamente, nunca só no nível de campanha",
    Array.from(adSetResultTypeByGroup?.values() ?? []).includes("conversations"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nC — Migração SQL: cada grupo de constraint com a lista certa (nunca misturando 'carts'/'followers' onde não deveriam estar)\n");
{
  const sql = loadSource("supabase", "performance-goal-conversations-registrations.sql");

  const pureColumns = [
    "clients_performance_goal_check",
    "client_goals_result_type_check",
    "monthly_budget_changes_result_type_check",
    "client_campaign_goal_assignments_result_type_check",
    "client_funnels_linked_result_type_check",
    "client_reports_performance_goal_check",
    "performance_records_result_type_check",
  ];
  for (const constraintName of pureColumns) {
    const re = new RegExp(`add constraint ${constraintName}\\s*\\n?\\s*check \\([^)]*in \\('leads', 'sales', 'followers', 'conversations', 'registrations'\\)`);
    const start = sql.indexOf(`add constraint ${constraintName}`);
    const statementEnd = sql.indexOf(";", start);
    ok(`${constraintName}: 5 valores puros, sem 'carts'`, re.test(sql) && !sql.slice(start, statementEnd).includes("'carts'"));
  }

  ok(
    "metric_mappings.goal: 5 valores + 'carts' preservado",
    sql.includes("check (goal in ('leads', 'sales', 'followers', 'conversations', 'registrations', 'carts'))"),
  );
  ok(
    "daily_performance.result_type: 5 valores + 'carts' preservado",
    sql.includes("check (result_type in ('leads', 'sales', 'followers', 'conversations', 'registrations', 'carts'))"),
  );

  const granularTables = ["campaign_daily_metrics", "ad_set_daily_metrics", "campaign_placement_daily_metrics", "ad_creative_daily_metrics"];
  for (const table of granularTables) {
    ok(
      `${table}.result_type: só leads/sales/conversations/registrations — 'followers' continua de fora`,
      sql.includes(`alter table ${table} add constraint ${table}_result_type_check\n  check (result_type in ('leads', 'sales', 'conversations', 'registrations'))`),
    );
  }

  ok("os 2 guards inline (PL/pgSQL) também foram ampliados", (sql.match(/'leads', 'sales', 'followers', 'conversations', 'registrations'/g) ?? []).length >= pureColumns.length + 2);
  ok("arquivo documenta 'NÃO EXECUTAR sem aprovação' (mesma disciplina de toda migration deste projeto)", sql.includes("NÃO EXECUTAR sem aprovação"));
}

// ---------------------------------------------------------------------------
console.log("\nD — Duplicações antigas convergidas numa fonte só (parsePerformanceGoal)\n");
{
  const funnelSource = loadSource("src", "app", "clients", "funnel-actions.ts");
  const goalActionsSource = loadSource("src", "app", "clients", "goal-actions.ts");
  const metaActionsSource = loadSource("src", "app", "settings", "meta-connections", "actions.ts");
  const actionTypePickerSource = loadSource("src", "app", "settings", "meta-connections", "action-type-picker.tsx");

  ok("funnel-actions.ts usa parsePerformanceGoal, não mais uma lista hardcoded própria", funnelSource.includes("parsePerformanceGoal(formData.get(\"linked_result_type\"))") && !funnelSource.includes('"leads" || raw === "sales"'));
  ok("goal-actions.ts usa parsePerformanceGoal por baixo", goalActionsSource.includes("parsePerformanceGoal(value)"));
  ok("settings/meta-connections/actions.ts usa parsePerformanceGoal, não mais 3 comparações soltas", metaActionsSource.includes("parsePerformanceGoal(formData.get(\"goal\"))") && !metaActionsSource.includes('goal !== "leads"'));
  ok("ActionTypePicker deriva as opções de PERFORMANCE_GOAL_OPTIONS, nunca mais um <option> hardcoded a mais", actionTypePickerSource.includes("PERFORMANCE_GOAL_OPTIONS.map"));
}

console.log(`\n${passed} verificações OK.\n`);
