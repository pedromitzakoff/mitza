import { createAdminClient } from "@/lib/supabase/admin";
import {
  aggregateAdCreativeDailyRows,
  aggregateAdSetDailyRows,
  aggregateCampaignDailyRows,
  aggregateColumnByAdCreativeGroup,
  aggregateColumnByAdSetGroup,
  aggregateColumnByCampaignGroup,
  aggregateColumnByPlacementGroup,
  aggregateDailyColumn,
  aggregatePlacementDailyRows,
  buildAdCreativeDailyMetricsUpsertRows,
  buildAdSetDailyMetricsUpsertRows,
  buildCampaignDailyMetricsUpsertRows,
  buildCampaignPlacementDailyMetricsUpsertRows,
  buildDailyPerformanceUpsertRows,
  buildDailySpendUpsertRows,
  combineAdCreativeGroupValues,
  combineAdSetGroupValues,
  combineAggregatedDailyValues,
  combineCampaignGroupValues,
  combinePlacementGroupValues,
} from "@/lib/import-sources";
import {
  META_API_COLUMNS,
  flattenMetaApiRowsToRawSourceRows,
  hasAnyAdIdentity,
  hasAnyAdSetIdentity,
  hasAnyPlacementIdentity,
  type MetaApiIngestPayload,
} from "@/lib/meta-api-ingest";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { DataSyncRunStatusDb } from "@/lib/supabase/database.types";

/** Mesmo limiar de `stract-sync.ts` — distingue "sincronização travada num
 * timeout" de "sincronização realmente em andamento agora". */
const STALE_RUNNING_RUN_THRESHOLD_MS = 30 * 60 * 1000;

export interface MetaApiIngestRunResult {
  importSourceId: string;
  runId: string;
  status: "success" | "partial" | "empty";
  rowsRead: number;
  spendRowsWritten: number;
  performanceRowsWritten: number;
  campaignRowsWritten: number;
  adSetRowsWritten: number;
  creativeRowsWritten: number;
  placementRowsWritten: number;
  errorMessage: string | null;
}

export type MetaApiIngestOutcome =
  | { kind: "unregistered_account" }
  | { kind: "disabled_source" }
  | { kind: "concurrent_run" }
  | { kind: "ok"; result: MetaApiIngestRunResult };

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Orquestração da ingestão n8n + API oficial da Meta — irmã de
 * `runImportForSource` (`lib/stract-sync.ts`), mesma disciplina (mesmas
 * tabelas de destino, mesmo `data_sync_runs`, mesmo `metric_mappings`),
 * caminho de leitura diferente: em vez de ler uma tabela física, recebe o
 * payload JÁ VALIDADO (`lib/meta-api-ingest.ts`) e converte pra
 * `RawSourceRow` com nomes de coluna FIXOS (`META_API_COLUMNS`) — nunca lê
 * `import_sources.*_column` (esses campos são `null` pra `provider =
 * 'meta_api'`, ver `supabase/meta-api-import-source.sql`).
 *
 * `campaignId` é SEMPRE populado aqui (obrigatório no contrato de entrada,
 * `lib/meta-api-ingest.ts`) — diferente do Stract, onde é opcional e
 * raramente configurado. Isso é o que permite ao Relatório/funis filtrar
 * Públicos/Criativos/Posicionamentos por ID real em vez de só pela ponte por
 * nome (`lib/client-funnels.ts`), sempre que a fonte do cliente for esta.
 *
 * Nenhuma regra de negócio de relatório é decidida aqui além do que
 * `runImportForSource` já decide pra Stract: resolução de objetivo via
 * `metric_mappings` (a MESMA tabela, a MESMA lógica — nunca uma segunda),
 * soma/upsert idempotente. O n8n nunca grava nestas tabelas diretamente.
 */
export async function ingestMetaApiPayload(payload: MetaApiIngestPayload): Promise<MetaApiIngestOutcome> {
  const supabase = createAdminClient();

  const { data: importSource, error: importSourceError } = await supabase
    .from("import_sources")
    .select("id, client_id, channel, enabled")
    .eq("provider", "meta_api")
    .eq("external_account_id", payload.accountId)
    .maybeSingle();

  if (importSourceError) {
    throw new Error(`Falha ao resolver import_source pra ${payload.accountId}: ${importSourceError.message}`);
  }
  if (!importSource) return { kind: "unregistered_account" };
  if (!importSource.enabled) return { kind: "disabled_source" };

  const importSourceId = importSource.id;
  const channel = importSource.channel;

  const { data: activeRun } = await supabase
    .from("data_sync_runs")
    .select("id, started_at")
    .eq("import_source_id", importSourceId)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeRun) {
    const startedAgoMs = Date.now() - new Date(activeRun.started_at).getTime();
    if (startedAgoMs < STALE_RUNNING_RUN_THRESHOLD_MS) return { kind: "concurrent_run" };

    await finishRun(supabase, activeRun.id, {
      status: "failed",
      rowsRead: 0,
      spendRowsWritten: 0,
      performanceRowsWritten: 0,
      creativeRowsWritten: 0,
      campaignRowsWritten: 0,
      adSetRowsWritten: 0,
      placementRowsWritten: 0,
      errorMessage: "Execução interrompida sem finalizar (provável timeout) — marcada como falha automaticamente ao iniciar uma nova tentativa.",
    });
  }

  const { data: run, error: runInsertError } = await supabase
    .from("data_sync_runs")
    .insert({ import_source_id: importSourceId, status: "running" })
    .select("id")
    .single();

  if (runInsertError || !run) {
    throw new Error(`Falha ao criar data_sync_runs pra ${importSourceId}: ${runInsertError?.message ?? "sem dados"}`);
  }

  const { data: mappings, error: mappingsError } = await supabase
    .from("metric_mappings")
    .select("goal, result_column, value_column")
    .eq("import_source_id", importSourceId)
    .eq("active", true);

  if (mappingsError) {
    await finishRun(supabase, run.id, {
      status: "failed",
      rowsRead: 0,
      spendRowsWritten: 0,
      performanceRowsWritten: 0,
      creativeRowsWritten: 0,
      campaignRowsWritten: 0,
      adSetRowsWritten: 0,
      placementRowsWritten: 0,
      errorMessage: `Falha ao ler metric_mappings: ${mappingsError.message}`,
    });
    throw new Error(`Falha ao ler metric_mappings de ${importSourceId}: ${mappingsError.message}`);
  }

  const nowIso = new Date().toISOString();
  const rows = flattenMetaApiRowsToRawSourceRows(payload.rows);

  let hadInvalidRows = false;
  let spendRowsWritten = 0;
  let performanceRowsWritten = 0;
  let creativeRowsWritten = 0;
  let campaignRowsWritten = 0;
  let adSetRowsWritten = 0;
  let placementRowsWritten = 0;
  const partialReasons: string[] = [];

  // Backfill automático de Sprints históricas — mesmo achado/mesma correção
  // de `runImportForSource`: dado importado de um mês sem Sprint cadastrada
  // não aparece em nenhuma tela.
  const minDate = minDateValue(payload.rows);
  const maxDate = maxDateValue(payload.rows);
  if (minDate && maxDate) {
    const { error: sprintBackfillError } = await supabase.rpc("ensure_client_sprints_for_range", {
      p_client_id: importSource.client_id,
      p_start_date: minDate,
      p_end_date: maxDate,
    });
    if (sprintBackfillError) partialReasons.push(`sprints históricas não criadas: ${sprintBackfillError.message}`);
  }

  const spendAggregate = aggregateDailyColumn(rows, META_API_COLUMNS.date, META_API_COLUMNS.spend);
  hadInvalidRows = hadInvalidRows || spendAggregate.some((row) => row.invalidRowCount > 0);

  if (spendAggregate.length > 0) {
    const spendUpsertRows = buildDailySpendUpsertRows(importSource.client_id, channel, spendAggregate, nowIso);
    const { error } = await supabase.from("daily_spend").upsert(spendUpsertRows, { onConflict: "client_id,date,channel" });
    if (error) partialReasons.push(`investimento não gravado: ${error.message}`);
    else spendRowsWritten = spendUpsertRows.length;
  }

  // Mesmo agrupamento por objetivo de `runImportForSource` — um objetivo
  // pode somar mais de um `action_type` (ex.: "lead" + "onsite_conversion.lead_grouped"),
  // por isso agrupa por goal antes de gravar (nunca sobrescreve).
  const mappingGroupsByGoal = new Map<PerformanceGoal, { resultColumns: string[]; valueColumns: string[] }>();
  for (const mapping of mappings ?? []) {
    const goal = mapping.goal as PerformanceGoal;
    const group = mappingGroupsByGoal.get(goal) ?? { resultColumns: [], valueColumns: [] };
    group.resultColumns.push(mapping.result_column);
    if (mapping.value_column) group.valueColumns.push(mapping.value_column);
    mappingGroupsByGoal.set(goal, group);
  }

  for (const [goal, { resultColumns, valueColumns }] of mappingGroupsByGoal) {
    const resultColumnAggregates = resultColumns.map((col) => aggregateDailyColumn(rows, META_API_COLUMNS.date, col));
    for (const agg of resultColumnAggregates) hadInvalidRows = hadInvalidRows || agg.some((row) => row.invalidRowCount > 0);

    const combinedResultAggregate = combineAggregatedDailyValues(resultColumnAggregates);
    if (combinedResultAggregate.length === 0) continue;

    let revenueByDate: Map<string, number> | null = null;
    if (valueColumns.length > 0) {
      const valueColumnAggregates = valueColumns.map((col) => aggregateDailyColumn(rows, META_API_COLUMNS.date, col));
      for (const agg of valueColumnAggregates) hadInvalidRows = hadInvalidRows || agg.some((row) => row.invalidRowCount > 0);
      const combinedValueAggregate = combineAggregatedDailyValues(valueColumnAggregates);
      revenueByDate = new Map(combinedValueAggregate.map((row) => [row.date, row.value]));
    }

    const performanceUpsertRows = buildDailyPerformanceUpsertRows(importSource.client_id, channel, goal, combinedResultAggregate, nowIso, revenueByDate, "meta_api");
    const { error } = await supabase.from("daily_performance").upsert(performanceUpsertRows, { onConflict: "client_id,date,channel,result_type" });
    if (error) partialReasons.push(`resultado (${goal}) não gravado: ${error.message}`);
    else performanceRowsWritten += performanceUpsertRows.length;
  }

  // Campanha — SEMPRE roda (campaignId/campaignName são obrigatórios no
  // contrato de entrada, nunca opcional como no Stract).
  const campaignAggregate = aggregateCampaignDailyRows(rows, {
    dateColumn: META_API_COLUMNS.date,
    campaignNameColumn: META_API_COLUMNS.campaignName,
    spendColumn: META_API_COLUMNS.spend,
    impressionsColumn: META_API_COLUMNS.impressions,
    reachColumn: META_API_COLUMNS.reach,
    clicksColumn: META_API_COLUMNS.clicks,
    campaignIdColumn: META_API_COLUMNS.campaignId,
  });
  hadInvalidRows = hadInvalidRows || campaignAggregate.some((row) => row.invalidRowCount > 0);

  if (campaignAggregate.length > 0) {
    const { resultType: campaignResultType, resultByGroup, revenueByGroup } = resolveCampaignGroupResult(rows, mappingGroupsByGoal);
    const campaignUpsertRows = buildCampaignDailyMetricsUpsertRows(importSource.client_id, importSourceId, channel, campaignAggregate, {
      resultType: campaignResultType,
      resultByGroup,
      revenueByGroup,
    });
    const { error } = await supabase
      .from("campaign_daily_metrics")
      .upsert(campaignUpsertRows, { onConflict: "import_source_id,date,channel,campaign_name" });
    if (error) partialReasons.push(`campanhas não gravadas: ${error.message}`);
    else campaignRowsWritten = campaignUpsertRows.length;
  }

  // Públicos — só quando o lote trouxer identidade de ad set (nem toda
  // extração do n8n precisa incluir esse nível, mesma degradação graciosa
  // do Stract).
  if (hasAnyAdSetIdentity(payload.rows)) {
    const adSetAggregate = aggregateAdSetDailyRows(rows, {
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
    hadInvalidRows = hadInvalidRows || adSetAggregate.some((row) => row.invalidRowCount > 0);

    if (adSetAggregate.length > 0) {
      const { resultType, resultByGroup, revenueByGroup } = resolveAdSetGroupResult(rows, mappingGroupsByGoal);
      const adSetUpsertRows = buildAdSetDailyMetricsUpsertRows(importSource.client_id, importSourceId, channel, adSetAggregate, {
        resultType,
        resultByGroup,
        revenueByGroup,
      });
      const { error } = await supabase
        .from("ad_set_daily_metrics")
        .upsert(adSetUpsertRows, { onConflict: "import_source_id,date,channel,campaign_name,ad_set_name" });
      if (error) partialReasons.push(`públicos (ad sets) não gravados: ${error.message}`);
      else adSetRowsWritten = adSetUpsertRows.length;
    }
  }

  // Criativos — só quando o lote trouxer identidade de anúncio.
  if (hasAnyAdIdentity(payload.rows)) {
    const creativeAggregate = aggregateAdCreativeDailyRows(rows, {
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
    hadInvalidRows = hadInvalidRows || creativeAggregate.some((row) => row.invalidRowCount > 0);

    if (creativeAggregate.length > 0) {
      const { resultType, resultByGroup, revenueByGroup } = resolveCreativeGroupResult(rows, mappingGroupsByGoal);
      const creativeUpsertRows = buildAdCreativeDailyMetricsUpsertRows(importSource.client_id, importSourceId, creativeAggregate, {
        resultType,
        resultByGroup,
        revenueByGroup,
      });
      const { error } = await supabase
        .from("ad_creative_daily_metrics")
        .upsert(creativeUpsertRows, { onConflict: "import_source_id,date,campaign_name,creative_name" });
      if (error) partialReasons.push(`criativos não gravados: ${error.message}`);
      else creativeRowsWritten = creativeUpsertRows.length;
    }
  }

  // Posicionamentos — só quando o lote trouxer platformPosition.
  if (hasAnyPlacementIdentity(payload.rows)) {
    const placementAggregate = aggregatePlacementDailyRows(rows, {
      dateColumn: META_API_COLUMNS.date,
      campaignNameColumn: META_API_COLUMNS.campaignName,
      platformPositionColumn: META_API_COLUMNS.platformPosition,
      spendColumn: META_API_COLUMNS.spend,
      campaignIdColumn: META_API_COLUMNS.campaignId,
    });
    hadInvalidRows = hadInvalidRows || placementAggregate.some((row) => row.invalidRowCount > 0);

    if (placementAggregate.length > 0) {
      const { resultType, resultByGroup, revenueByGroup } = resolvePlacementGroupResult(rows, mappingGroupsByGoal);
      const placementUpsertRows = buildCampaignPlacementDailyMetricsUpsertRows(importSource.client_id, importSourceId, channel, placementAggregate, {
        resultType,
        resultByGroup,
        revenueByGroup,
      });
      const { error } = await supabase
        .from("campaign_placement_daily_metrics")
        .upsert(placementUpsertRows, { onConflict: "import_source_id,date,channel,campaign_name,platform_position" });
      if (error) partialReasons.push(`posicionamentos não gravados: ${error.message}`);
      else placementRowsWritten = placementUpsertRows.length;
    }
  }

  const isEmpty = rows.length === 0;
  const status: MetaApiIngestRunResult["status"] = partialReasons.length > 0 ? "partial" : hadInvalidRows ? "partial" : isEmpty ? "empty" : "success";
  const finalErrorMessage = partialReasons.length > 0
    ? partialReasons.join(" | ")
    : hadInvalidRows
      ? "Uma ou mais linhas foram ignoradas por valor inválido (não numérico ou negativo)."
      : isEmpty
        ? "O lote recebido não tinha nenhuma linha."
        : null;

  await finishRun(supabase, run.id, {
    status,
    rowsRead: rows.length,
    spendRowsWritten,
    performanceRowsWritten,
    creativeRowsWritten,
    campaignRowsWritten,
    adSetRowsWritten,
    placementRowsWritten,
    errorMessage: finalErrorMessage,
  });

  if (!isEmpty) {
    await supabase
      .from("import_sources")
      .update({ status: "active", last_imported_date: maxDate, last_success_at: nowIso })
      .eq("id", importSourceId);
  }

  return {
    kind: "ok",
    result: {
      importSourceId,
      runId: run.id,
      status,
      rowsRead: rows.length,
      spendRowsWritten,
      performanceRowsWritten,
      creativeRowsWritten,
      campaignRowsWritten,
      adSetRowsWritten,
      placementRowsWritten,
      errorMessage: finalErrorMessage,
    },
  };
}

function resolveCampaignGroupResult(
  rows: ReturnType<typeof flattenMetaApiRowsToRawSourceRows>,
  mappingGroupsByGoal: Map<PerformanceGoal, { resultColumns: string[]; valueColumns: string[] }>,
) {
  let resultType: PerformanceGoal | null = null;
  let resultByGroup: Map<string, number> | null = null;
  let revenueByGroup: Map<string, number> | null = null;

  for (const [goal, { resultColumns, valueColumns }] of mappingGroupsByGoal) {
    if (goal !== "leads" && goal !== "sales") continue;
    const resultColumnAggregates = resultColumns.map((col) =>
      aggregateColumnByCampaignGroup(rows, META_API_COLUMNS.date, META_API_COLUMNS.campaignName, col),
    );
    const combinedResult = combineCampaignGroupValues(resultColumnAggregates);
    if (combinedResult.length === 0) continue;

    resultType = goal;
    resultByGroup = new Map(combinedResult.map((row) => [`${row.date} ${row.campaignName}`, row.value]));

    if (valueColumns.length > 0) {
      const valueColumnAggregates = valueColumns.map((col) => aggregateColumnByCampaignGroup(rows, META_API_COLUMNS.date, META_API_COLUMNS.campaignName, col));
      const combinedValue = combineCampaignGroupValues(valueColumnAggregates);
      revenueByGroup = new Map(combinedValue.map((row) => [`${row.date} ${row.campaignName}`, row.value]));
    }
    break;
  }

  return { resultType, resultByGroup, revenueByGroup };
}

function resolveAdSetGroupResult(
  rows: ReturnType<typeof flattenMetaApiRowsToRawSourceRows>,
  mappingGroupsByGoal: Map<PerformanceGoal, { resultColumns: string[]; valueColumns: string[] }>,
) {
  let resultType: PerformanceGoal | null = null;
  let resultByGroup: Map<string, number> | null = null;
  let revenueByGroup: Map<string, number> | null = null;

  for (const [goal, { resultColumns, valueColumns }] of mappingGroupsByGoal) {
    if (goal !== "leads" && goal !== "sales") continue;
    const resultColumnAggregates = resultColumns.map((col) =>
      aggregateColumnByAdSetGroup(rows, META_API_COLUMNS.date, META_API_COLUMNS.campaignName, META_API_COLUMNS.adSetName, col),
    );
    const combinedResult = combineAdSetGroupValues(resultColumnAggregates);
    if (combinedResult.length === 0) continue;

    resultType = goal;
    resultByGroup = new Map(combinedResult.map((row) => [`${row.date} ${row.campaignName} ${row.adSetName}`, row.value]));

    if (valueColumns.length > 0) {
      const valueColumnAggregates = valueColumns.map((col) =>
        aggregateColumnByAdSetGroup(rows, META_API_COLUMNS.date, META_API_COLUMNS.campaignName, META_API_COLUMNS.adSetName, col),
      );
      const combinedValue = combineAdSetGroupValues(valueColumnAggregates);
      revenueByGroup = new Map(combinedValue.map((row) => [`${row.date} ${row.campaignName} ${row.adSetName}`, row.value]));
    }
    break;
  }

  return { resultType, resultByGroup, revenueByGroup };
}

function resolveCreativeGroupResult(
  rows: ReturnType<typeof flattenMetaApiRowsToRawSourceRows>,
  mappingGroupsByGoal: Map<PerformanceGoal, { resultColumns: string[]; valueColumns: string[] }>,
) {
  let resultType: PerformanceGoal | null = null;
  let resultByGroup: Map<string, number> | null = null;
  let revenueByGroup: Map<string, number> | null = null;

  for (const [goal, { resultColumns, valueColumns }] of mappingGroupsByGoal) {
    if (goal !== "leads" && goal !== "sales") continue;
    const resultColumnAggregates = resultColumns.map((col) =>
      aggregateColumnByAdCreativeGroup(rows, META_API_COLUMNS.date, META_API_COLUMNS.campaignName, META_API_COLUMNS.adName, col),
    );
    const combinedResult = combineAdCreativeGroupValues(resultColumnAggregates);
    if (combinedResult.length === 0) continue;

    resultType = goal;
    resultByGroup = new Map(combinedResult.map((row) => [`${row.date} ${row.campaignName} ${row.creativeName}`, row.value]));

    if (valueColumns.length > 0) {
      const valueColumnAggregates = valueColumns.map((col) =>
        aggregateColumnByAdCreativeGroup(rows, META_API_COLUMNS.date, META_API_COLUMNS.campaignName, META_API_COLUMNS.adName, col),
      );
      const combinedValue = combineAdCreativeGroupValues(valueColumnAggregates);
      revenueByGroup = new Map(combinedValue.map((row) => [`${row.date} ${row.campaignName} ${row.creativeName}`, row.value]));
    }
    break;
  }

  return { resultType, resultByGroup, revenueByGroup };
}

function resolvePlacementGroupResult(
  rows: ReturnType<typeof flattenMetaApiRowsToRawSourceRows>,
  mappingGroupsByGoal: Map<PerformanceGoal, { resultColumns: string[]; valueColumns: string[] }>,
) {
  let resultType: PerformanceGoal | null = null;
  let resultByGroup: Map<string, number> | null = null;
  let revenueByGroup: Map<string, number> | null = null;

  for (const [goal, { resultColumns, valueColumns }] of mappingGroupsByGoal) {
    if (goal !== "leads" && goal !== "sales") continue;
    const resultColumnAggregates = resultColumns.map((col) =>
      aggregateColumnByPlacementGroup(rows, META_API_COLUMNS.date, META_API_COLUMNS.campaignName, META_API_COLUMNS.platformPosition, col),
    );
    const combinedResult = combinePlacementGroupValues(resultColumnAggregates);
    if (combinedResult.length === 0) continue;

    resultType = goal;
    resultByGroup = new Map(combinedResult.map((row) => [`${row.date} ${row.campaignName} ${row.platformPosition}`, row.value]));

    if (valueColumns.length > 0) {
      const valueColumnAggregates = valueColumns.map((col) =>
        aggregateColumnByPlacementGroup(rows, META_API_COLUMNS.date, META_API_COLUMNS.campaignName, META_API_COLUMNS.platformPosition, col),
      );
      const combinedValue = combinePlacementGroupValues(valueColumnAggregates);
      revenueByGroup = new Map(combinedValue.map((row) => [`${row.date} ${row.campaignName} ${row.platformPosition}`, row.value]));
    }
    break;
  }

  return { resultType, resultByGroup, revenueByGroup };
}

async function finishRun(
  supabase: AdminClient,
  runId: string,
  result: {
    status: DataSyncRunStatusDb;
    rowsRead: number;
    spendRowsWritten: number;
    performanceRowsWritten: number;
    creativeRowsWritten: number;
    campaignRowsWritten: number;
    adSetRowsWritten: number;
    placementRowsWritten: number;
    errorMessage: string | null;
  },
) {
  await supabase
    .from("data_sync_runs")
    .update({
      status: result.status,
      finished_at: new Date().toISOString(),
      rows_read: result.rowsRead,
      spend_rows_written: result.spendRowsWritten,
      performance_rows_written: result.performanceRowsWritten,
      creative_rows_written: result.creativeRowsWritten,
      campaign_rows_written: result.campaignRowsWritten,
      ad_set_rows_written: result.adSetRowsWritten,
      placement_rows_written: result.placementRowsWritten,
      error_message: result.errorMessage,
    })
    .eq("id", runId);
}

function maxDateValue(rows: MetaApiIngestPayload["rows"]): string | null {
  let max: string | null = null;
  for (const row of rows) if (max === null || row.date > max) max = row.date;
  return max;
}

function minDateValue(rows: MetaApiIngestPayload["rows"]): string | null {
  let min: string | null = null;
  for (const row of rows) if (min === null || row.date < min) min = row.date;
  return min;
}
