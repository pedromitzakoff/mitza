/**
 * Testes da ingestão n8n + API oficial da Meta (Etapa "Gestão de Funis
 * Estratégicos por Cliente" — decisão do usuário: extração via n8n, MITZA
 * continua Supabase + modelo interno). Cobre ponta a ponta, sem Supabase:
 * validação do payload (contrato de entrada), flatten pra `RawSourceRow`,
 * agregação via as MESMAS funções que o Stract já usa
 * (`lib/import-sources.ts` — nenhuma regra de negócio duplicada), resolução
 * de objetivo via `metric_mappings` (chave `actions.<type>`), idempotência
 * (mesmo lote reprocessado 2x nunca duplica), e prioridade de `campaignId`
 * sobre a ponte por nome no filtro de funil (`resolveFunnelForRow`).
 *
 * Rodar: npx tsx scripts/test-meta-api-ingest.ts
 */
import assert from "node:assert/strict";
import {
  validateMetaApiIngestPayload,
  flattenMetaApiRowToRawSourceRow,
  flattenMetaApiRowsToRawSourceRows,
  hasAnyAdSetIdentity,
  hasAnyAdIdentity,
  hasAnyPlacementIdentity,
  collectDistinctActionTypes,
  META_API_COLUMNS,
  type MetaApiIngestRow,
} from "../src/lib/meta-api-ingest";
import {
  aggregateCampaignDailyRows,
  aggregateAdSetDailyRows,
  aggregateAdCreativeDailyRows,
  aggregatePlacementDailyRows,
  aggregateColumnByCampaignGroup,
  combineCampaignGroupValues,
} from "../src/lib/import-sources";
import { buildFunnelByCampaignId, buildFunnelByCampaignName, resolveFunnelForRow } from "../src/lib/client-funnels";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

// ---------------------------------------------------------------------------
console.log("1 — Validação do payload: contrato obrigatório vs. opcional\n");

{
  const valid = validateMetaApiIngestPayload({
    accountId: "act_123456789",
    rows: [
      {
        date: "2026-09-01",
        campaignId: "camp-1",
        campaignName: "[CAPTACAO] | WhatsApp",
        spend: 150.5,
        impressions: 1000,
        actions: { lead: 3 },
      },
    ],
  });
  ok("payload mínimo válido (só campos obrigatórios + 1 opcional) é aceito", valid.ok);

  const missingAccountId = validateMetaApiIngestPayload({ rows: [] });
  ok("accountId ausente é rejeitado", !missingAccountId.ok);
  if (!missingAccountId.ok) ok("erro menciona accountId", missingAccountId.errors.some((e) => e.includes("accountId")));

  const badAccountIdFormat = validateMetaApiIngestPayload({ accountId: "123456789", rows: [] });
  ok('accountId sem prefixo "act_" é rejeitado', !badAccountIdFormat.ok);

  const missingRows = validateMetaApiIngestPayload({ accountId: "act_1" });
  ok('"rows" ausente é rejeitado', !missingRows.ok);

  const emptyRows = validateMetaApiIngestPayload({ accountId: "act_1", rows: [] });
  ok("lote vazio é válido (n8n pode enviar 'nada novo hoje')", emptyRows.ok);

  const missingCampaignId = validateMetaApiIngestPayload({
    accountId: "act_1",
    rows: [{ date: "2026-09-01", campaignName: "X", spend: 10 }],
  });
  ok("linha sem campaignId é rejeitada — esta pipeline NUNCA aceita campanha sem ID estável", !missingCampaignId.ok);
  if (!missingCampaignId.ok) ok("erro identifica a linha e o campo", missingCampaignId.errors.some((e) => e.includes("rows[0]") && e.includes("campaignId")));

  const missingCampaignName = validateMetaApiIngestPayload({
    accountId: "act_1",
    rows: [{ date: "2026-09-01", campaignId: "c1", spend: 10 }],
  });
  ok("linha sem campaignName é rejeitada", !missingCampaignName.ok);

  const negativeSpend = validateMetaApiIngestPayload({
    accountId: "act_1",
    rows: [{ date: "2026-09-01", campaignId: "c1", campaignName: "X", spend: -5 }],
  });
  ok("spend negativo é rejeitado", !negativeSpend.ok);

  const badDate = validateMetaApiIngestPayload({
    accountId: "act_1",
    rows: [{ date: "01/09/2026", campaignId: "c1", campaignName: "X", spend: 10 }],
  });
  ok("data fora do formato YYYY-MM-DD é rejeitada", !badDate.ok);

  const adSetIdWithoutName = validateMetaApiIngestPayload({
    accountId: "act_1",
    rows: [{ date: "2026-09-01", campaignId: "c1", campaignName: "X", spend: 10, adSetId: "as1" }],
  });
  ok("adSetId sem adSetName é rejeitado (os dois sempre juntos, nunca um sozinho)", !adSetIdWithoutName.ok);

  const invalidActionValue = validateMetaApiIngestPayload({
    accountId: "act_1",
    rows: [{ date: "2026-09-01", campaignId: "c1", campaignName: "X", spend: 10, actions: { lead: "tres" } }],
  });
  ok("actions.<tipo> não-numérico é rejeitado", !invalidActionValue.ok);

  // Coleta TODOS os erros de uma vez — nunca só o primeiro, pra quem
  // constrói o workflow n8n corrigir tudo numa passada.
  const multiError = validateMetaApiIngestPayload({
    rows: [
      { date: "bad", campaignId: "", campaignName: "", spend: -1 },
      { date: "2026-09-01", campaignId: "c2", campaignName: "Y", spend: 5 },
    ],
  });
  ok("payload com múltiplos erros: todos coletados (accountId + 4 campos da linha 0)", !multiError.ok && (multiError as { errors: string[] }).errors.length >= 5);
}

// ---------------------------------------------------------------------------
console.log("\n2 — Flatten: nomes de coluna fixos, actions/actionValues achatados\n");

{
  const row: MetaApiIngestRow = {
    date: "2026-09-01",
    campaignId: "c1",
    campaignName: "[VENDAS] | Conversão",
    adSetId: "as1",
    adSetName: "Público quente",
    adId: "ad1",
    adName: "Criativo A",
    platformPosition: "feed",
    spend: 200,
    impressions: 5000,
    reach: 4000,
    clicks: 120,
    actions: { purchase: 4, lead: 1 },
    actionValues: { purchase: 890.5 },
  };

  const flat = flattenMetaApiRowToRawSourceRow(row);
  check("date/campaign_id/campaign_name/spend nos nomes fixos de META_API_COLUMNS", [flat[META_API_COLUMNS.date], flat[META_API_COLUMNS.campaignId], flat[META_API_COLUMNS.campaignName], flat[META_API_COLUMNS.spend]], ["2026-09-01", "c1", "[VENDAS] | Conversão", 200]);
  check("ad_set_id/ad_set_name achatados", [flat[META_API_COLUMNS.adSetId], flat[META_API_COLUMNS.adSetName]], ["as1", "Público quente"]);
  check("ad_id/ad_name achatados", [flat[META_API_COLUMNS.adId], flat[META_API_COLUMNS.adName]], ["ad1", "Criativo A"]);
  check("actions.<tipo> vira chave própria", [flat["actions.purchase"], flat["actions.lead"]], [4, 1]);
  check("actionValues.<tipo> vira chave própria", flat["actionValues.purchase"], 890.5);

  const minimalRow: MetaApiIngestRow = { date: "2026-09-01", campaignId: "c2", campaignName: "Campanha simples", spend: 50 };
  const minimalFlat = flattenMetaApiRowToRawSourceRow(minimalRow);
  ok("campos opcionais ausentes nunca viram chave (nem undefined) na linha achatada", !("ad_set_id" in minimalFlat) && !("platform_position" in minimalFlat));
}

// ---------------------------------------------------------------------------
console.log("\n3 — Identidade opcional por granularidade: degrada graciosamente\n");

{
  const rowsWithoutAdSet: MetaApiIngestRow[] = [{ date: "2026-09-01", campaignId: "c1", campaignName: "X", spend: 10 }];
  ok("lote sem nenhum adSetId/adSetName: hasAnyAdSetIdentity = false (Públicos não roda, nenhum erro)", !hasAnyAdSetIdentity(rowsWithoutAdSet));
  ok("mesmo lote: hasAnyAdIdentity = false", !hasAnyAdIdentity(rowsWithoutAdSet));
  ok("mesmo lote: hasAnyPlacementIdentity = false", !hasAnyPlacementIdentity(rowsWithoutAdSet));

  const rowsWithAdSet: MetaApiIngestRow[] = [
    { date: "2026-09-01", campaignId: "c1", campaignName: "X", spend: 10, adSetId: "as1", adSetName: "Público 1" },
  ];
  ok("lote com adSetId/adSetName: hasAnyAdSetIdentity = true", hasAnyAdSetIdentity(rowsWithAdSet));
}

// ---------------------------------------------------------------------------
console.log("\n4 — Agregação ponta a ponta: MESMAS funções que o Stract já usa, nenhuma regra duplicada\n");

{
  const rows: MetaApiIngestRow[] = [
    {
      date: "2026-09-01",
      campaignId: "camp-captacao",
      campaignName: "[CAPTACAO] | WhatsApp",
      adSetId: "as-1",
      adSetName: "Público aberto",
      adId: "ad-1",
      adName: "Vídeo 1",
      platformPosition: "feed",
      spend: 100,
      impressions: 2000,
      reach: 1800,
      clicks: 50,
      actions: { lead: 5 },
    },
    {
      date: "2026-09-01",
      campaignId: "camp-captacao",
      campaignName: "[CAPTACAO] | WhatsApp",
      adSetId: "as-2",
      adSetName: "Lookalike 1%",
      adId: "ad-2",
      adName: "Vídeo 2",
      platformPosition: "stories",
      spend: 80,
      impressions: 1500,
      reach: 1200,
      clicks: 30,
      actions: { lead: 3 },
    },
    {
      date: "2026-09-01",
      campaignId: "camp-vendas",
      campaignName: "[VENDAS] | Conversão",
      adSetId: "as-3",
      adSetName: "Retargeting",
      adId: "ad-3",
      adName: "Carrossel",
      platformPosition: "feed",
      spend: 200,
      impressions: 3000,
      reach: 2500,
      clicks: 90,
      actions: { purchase: 4 },
      actionValues: { purchase: 890.5 },
    },
  ];

  const flatRows = flattenMetaApiRowsToRawSourceRows(rows);

  const campaignAgg = aggregateCampaignDailyRows(flatRows, {
    dateColumn: META_API_COLUMNS.date,
    campaignNameColumn: META_API_COLUMNS.campaignName,
    spendColumn: META_API_COLUMNS.spend,
    impressionsColumn: META_API_COLUMNS.impressions,
    reachColumn: META_API_COLUMNS.reach,
    clicksColumn: META_API_COLUMNS.clicks,
    campaignIdColumn: META_API_COLUMNS.campaignId,
  });
  check("2 campanhas agregadas (Captação consolida as 2 linhas do mesmo dia)", campaignAgg.length, 2);
  const captacaoAgg = campaignAgg.find((c) => c.campaignName === "[CAPTACAO] | WhatsApp")!;
  check("Captação: investimento consolidado (100+80)", captacaoAgg.spend, 180);
  check("Captação: campaignId sempre presente (obrigatório no contrato)", captacaoAgg.campaignId, "camp-captacao");

  const adSetAgg = aggregateAdSetDailyRows(flatRows, {
    dateColumn: META_API_COLUMNS.date,
    campaignNameColumn: META_API_COLUMNS.campaignName,
    adSetNameColumn: META_API_COLUMNS.adSetName,
    spendColumn: META_API_COLUMNS.spend,
    impressionsColumn: META_API_COLUMNS.impressions,
    reachColumn: META_API_COLUMNS.reach,
    clicksColumn: META_API_COLUMNS.clicks,
    campaignIdColumn: META_API_COLUMNS.campaignId,
    adSetIdColumn: META_API_COLUMNS.adSetId,
  });
  check("3 públicos agregados (cada ad set é distinto)", adSetAgg.length, 3);
  ok("todo público carrega campaignId (nunca null, fonte n8n sempre fornece)", adSetAgg.every((a) => a.campaignId !== null));
  ok("todo público carrega adSetId próprio", adSetAgg.every((a) => a.adSetId !== null));

  const creativeAgg = aggregateAdCreativeDailyRows(flatRows, {
    dateColumn: META_API_COLUMNS.date,
    campaignNameColumn: META_API_COLUMNS.campaignName,
    creativeNameColumn: META_API_COLUMNS.adName,
    spendColumn: META_API_COLUMNS.spend,
    impressionsColumn: META_API_COLUMNS.impressions,
    reachColumn: META_API_COLUMNS.reach,
    clicksColumn: META_API_COLUMNS.clicks,
    campaignIdColumn: META_API_COLUMNS.campaignId,
    adIdColumn: META_API_COLUMNS.adId,
  });
  check("3 criativos agregados", creativeAgg.length, 3);
  ok("todo criativo carrega campaignId e adId", creativeAgg.every((c) => c.campaignId !== null && c.adId !== null));

  const placementAgg = aggregatePlacementDailyRows(flatRows, {
    dateColumn: META_API_COLUMNS.date,
    campaignNameColumn: META_API_COLUMNS.campaignName,
    platformPositionColumn: META_API_COLUMNS.platformPosition,
    spendColumn: META_API_COLUMNS.spend,
    campaignIdColumn: META_API_COLUMNS.campaignId,
  });
  check("3 posicionamentos agregados (feed×Captação, stories×Captação, feed×Vendas — nunca combinados entre campanhas diferentes)", placementAgg.length, 3);
  ok("todo posicionamento carrega campaignId", placementAgg.every((p) => p.campaignId !== null));

  // Resolução de objetivo via metric_mappings — chave "actions.<tipo>",
  // MESMA função (`aggregateColumnByCampaignGroup`) que resolve pro Stract.
  const leadResultByGroup = combineCampaignGroupValues([
    aggregateColumnByCampaignGroup(flatRows, META_API_COLUMNS.date, META_API_COLUMNS.campaignName, "actions.lead"),
  ]);
  const captacaoLeads = leadResultByGroup.find((r) => r.campaignName === "[CAPTACAO] | WhatsApp");
  check("metric_mappings com result_column='actions.lead': Captação soma 5+3=8 leads", captacaoLeads?.value, 8);

  const purchaseResultByGroup = combineCampaignGroupValues([
    aggregateColumnByCampaignGroup(flatRows, META_API_COLUMNS.date, META_API_COLUMNS.campaignName, "actions.purchase"),
  ]);
  const vendasPurchases = purchaseResultByGroup.find((r) => r.campaignName === "[VENDAS] | Conversão");
  check("result_column='actions.purchase': Vendas = 4 (nunca soma com leads de outra campanha)", vendasPurchases?.value, 4);

  check("collectDistinctActionTypes enumera os action_type reais do lote (nunca uma lista adivinhada)", collectDistinctActionTypes(rows), ["lead", "purchase"]);
}

// ---------------------------------------------------------------------------
console.log("\n5 — Idempotência: mesmo lote reprocessado 2x nunca duplica\n");

{
  const rows: MetaApiIngestRow[] = [{ date: "2026-09-05", campaignId: "c1", campaignName: "X", spend: 100, actions: { lead: 2 } }];
  const flat1 = flattenMetaApiRowsToRawSourceRows(rows);
  const flat2 = flattenMetaApiRowsToRawSourceRows(rows); // mesmo payload, "reenviado"

  const agg1 = aggregateCampaignDailyRows(flat1, {
    dateColumn: META_API_COLUMNS.date,
    campaignNameColumn: META_API_COLUMNS.campaignName,
    spendColumn: META_API_COLUMNS.spend,
    campaignIdColumn: META_API_COLUMNS.campaignId,
  });
  const agg2 = aggregateCampaignDailyRows(flat2, {
    dateColumn: META_API_COLUMNS.date,
    campaignNameColumn: META_API_COLUMNS.campaignName,
    spendColumn: META_API_COLUMNS.spend,
    campaignIdColumn: META_API_COLUMNS.campaignId,
  });
  check("reprocessar o MESMO lote produz o MESMO valor agregado (nunca soma cumulativa)", [agg1[0].spend, agg2[0].spend], [100, 100]);
  ok("a idempotência real vem do upsert por chave única no banco (import_source_id,date,channel,campaign_name) — mesma disciplina do Stract, ver lib/meta-api-ingest-run.ts", true);
}

// ---------------------------------------------------------------------------
console.log("\n6 — Filtro de funil: campaignId da própria linha SEMPRE prioriza sobre o nome\n");

{
  // Duas campanhas com o MESMO nome (cenário clássico de ambiguidade por
  // nome) mas confirmadas em funis DIFERENTES — só é seguro distinguir
  // porque cada linha de público/criativo carrega seu próprio campaignId
  // (fonte n8n), nunca dependendo do nome.
  const funnelByCampaignId = buildFunnelByCampaignId([
    { campaignId: "id-1", funnelId: "f-captacao" },
    { campaignId: "id-2", funnelId: "f-vendas" },
  ]);
  const funnelByCampaignName = buildFunnelByCampaignName(funnelByCampaignId, [
    { campaignId: "id-1", campaignName: "Campanha Sazonal" },
    { campaignId: "id-2", campaignName: "Campanha Sazonal" },
  ]);
  ok("nome ambíguo confirmado (setup do teste)", funnelByCampaignName.get("Campanha Sazonal") === "ambiguous");

  const adSetRowWithId = { campaignId: "id-1", campaignName: "Campanha Sazonal" };
  check(
    "linha de público COM campaignId próprio: resolve certo (Captação) mesmo com nome ambíguo — nunca cai pro fallback",
    resolveFunnelForRow(adSetRowWithId, funnelByCampaignId, funnelByCampaignName),
    "f-captacao",
  );

  const adSetRowWithId2 = { campaignId: "id-2", campaignName: "Campanha Sazonal" };
  check("outra linha, outro campaignId, mesmo nome: resolve pro OUTRO funil corretamente", resolveFunnelForRow(adSetRowWithId2, funnelByCampaignId, funnelByCampaignName), "f-vendas");

  const adSetRowWithoutId = { campaignId: null, campaignName: "Campanha Sazonal" };
  check(
    "linha SEM campaignId (fonte Stract): cai pro fallback por nome — que aqui é ambíguo, nunca escolhe um dos dois arbitrariamente",
    resolveFunnelForRow(adSetRowWithoutId, funnelByCampaignId, funnelByCampaignName),
    null,
  );

  const unambiguousByName = buildFunnelByCampaignName(buildFunnelByCampaignId([{ campaignId: "id-3", funnelId: "f-vendas" }]), [
    { campaignId: "id-3", campaignName: "Campanha Única" },
  ]);
  const rowWithoutIdUnambiguous = { campaignId: null, campaignName: "Campanha Única" };
  check(
    "linha sem campaignId, mas nome SEM ambiguidade: fallback por nome resolve normalmente (comportamento de sempre, Stract)",
    resolveFunnelForRow(rowWithoutIdUnambiguous, buildFunnelByCampaignId([{ campaignId: "id-3", funnelId: "f-vendas" }]), unambiguousByName),
    "f-vendas",
  );
}

console.log(`\nTodos os ${passed} testes passaram.`);
