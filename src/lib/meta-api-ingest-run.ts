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
  parseSourceNumericValue,
  type RawSourceRow,
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
    linkClicksColumn: META_API_COLUMNS.linkClicks,
    campaignIdColumn: META_API_COLUMNS.campaignId,
  });
  hadInvalidRows = hadInvalidRows || campaignAggregate.some((row) => row.invalidRowCount > 0);

  if (campaignAggregate.length > 0) {
    const { resultTypeByGroup: campaignResultTypeByGroup, resultByGroup, revenueByGroup } = resolveCampaignGroupResult(rows, mappingGroupsByGoal);
    const campaignUpsertRows = buildCampaignDailyMetricsUpsertRows(importSource.client_id, importSourceId, channel, campaignAggregate, {
      resultTypeByGroup: campaignResultTypeByGroup,
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
      linkClicksColumn: META_API_COLUMNS.linkClicks,
      campaignIdColumn: META_API_COLUMNS.campaignId,
      adSetIdColumn: META_API_COLUMNS.adSetId,
    });
    hadInvalidRows = hadInvalidRows || adSetAggregate.some((row) => row.invalidRowCount > 0);

    if (adSetAggregate.length > 0) {
      const { resultTypeByGroup, resultByGroup, revenueByGroup } = resolveAdSetGroupResult(rows, mappingGroupsByGoal);
      const adSetUpsertRows = buildAdSetDailyMetricsUpsertRows(importSource.client_id, importSourceId, channel, adSetAggregate, {
        resultTypeByGroup,
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
      linkClicksColumn: META_API_COLUMNS.linkClicks,
      campaignIdColumn: META_API_COLUMNS.campaignId,
      adIdColumn: META_API_COLUMNS.adId,
    });
    hadInvalidRows = hadInvalidRows || creativeAggregate.some((row) => row.invalidRowCount > 0);

    if (creativeAggregate.length > 0) {
      const { resultTypeByGroup, resultByGroup, revenueByGroup } = resolveCreativeGroupResult(rows, mappingGroupsByGoal);
      const creativeUpsertRows = buildAdCreativeDailyMetricsUpsertRows(importSource.client_id, importSourceId, creativeAggregate, {
        resultTypeByGroup,
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
      const { resultTypeByGroup, resultByGroup, revenueByGroup } = resolvePlacementGroupResult(rows, mappingGroupsByGoal);
      const placementUpsertRows = buildCampaignPlacementDailyMetricsUpsertRows(importSource.client_id, importSourceId, channel, placementAggregate, {
        resultTypeByGroup,
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

  // Antes esse UPDATE rodava DEPOIS do finishRun e descartava o erro em
  // silêncio — uma falha aqui (ex.: `last_success_at` não gravado) não
  // aparecia em lugar nenhum, nem no `data_sync_runs` nem nos logs. Agora
  // roda ANTES, e o erro (se houver) entra em `partialReasons` como
  // qualquer outra falha de gravação — fica registrado na própria execução
  // e visível em "Ver últimas sincronizações" no drawer da conta.
  if (!isEmpty) {
    const { error: importSourceUpdateError } = await supabase
      .from("import_sources")
      .update({ status: "active", last_imported_date: maxDate, last_success_at: nowIso })
      .eq("id", importSourceId);
    if (importSourceUpdateError) {
      partialReasons.push(`status da fonte não atualizado: ${importSourceUpdateError.message}`);
      console.error(`[meta-api-ingest-run] Falha ao atualizar import_sources ${importSourceId}:`, importSourceUpdateError);
    }
  }

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

/**
 * KOFF Analytics — "Reestruturar lógica de mapeamento de objetivos" (pedido
 * explícito do usuário: uma conta Meta pode ter mais de um objetivo ativo
 * ao mesmo tempo, ou o objetivo pode mudar com o tempo — "não faz sentido"
 * a sincronização escolher 1 objetivo vencedor pro lote inteiro e descartar
 * os outros). Ordem de prioridade FIXA (nunca a ordem de inserção do `Map`,
 * que depende da ordem de retorno da query — não determinística) — só
 * entra em jogo no caso raro de a MESMA chave (campanha[+conjunto/anúncio/
 * posicionamento]+dia) ter resultado em MAIS DE UM objetivo mapeado
 * simultaneamente, já que uma linha só aguenta um `result_type` (nunca
 * somar dois objetivos incompatíveis na mesma linha). `followers` segue de
 * fora deste nível granular — mesmo comportamento de antes desta etapa,
 * fora do escopo deste pedido.
 */
const GRANULAR_RESULT_GOAL_PRIORITY: PerformanceGoal[] = ["leads", "sales"];

function rawColumnString(row: RawSourceRow, column: string): string | null {
  const raw = row[column];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** Núcleo genérico reaproveitado pelas 4 granularidades (campanha/conjunto/
 * anúncio/posicionamento) — cada objetivo mapeado contribui o resultado das
 * chaves que efetivamente teve; uma chave já resolvida por um objetivo de
 * prioridade mais alta nunca é sobrescrita por outro. Nenhuma chave de uma
 * campanha é descartada por causa de outra campanha ter um objetivo
 * diferente (o bug corrigido aqui) — só o conflito genuíno MESMA
 * chave+2 objetivos aplica a prioridade.
 *
 * `touchedKeys` (achado desta etapa, ao escrever os testes): os agregados
 * de `aggregateColumnByXGroup` criam uma entrada PRA TODA campanha do lote,
 * com valor 0, mesmo quando a coluna mapeada nunca apareceu naquela linha
 * (0 somado vs. "nunca presente" ficam indistinguíveis no valor agregado) —
 * usar só `combinedResult` pra decidir quem reivindica uma chave faria o
 * primeiro objetivo da prioridade "vencer" TODA campanha do lote de novo
 * (reintroduzindo o bug, só que agora com valor 0 fabricado). Por isso
 * cada objetivo só reivindica as chaves onde pelo menos uma linha BRUTA
 * teve a coluna mapeada de fato presente (`parseSourceNumericValue(...).kind
 * !== "empty"`) — nunca um valor 0 de coluna ausente interpretado como
 * "este objetivo também aconteceu aqui". */
function resolveGroupResultByGoalPriority<TRow extends { date: string; value: number; invalidRowCount: number }>(
  rows: RawSourceRow[],
  mappingGroupsByGoal: Map<PerformanceGoal, { resultColumns: string[]; valueColumns: string[] }>,
  buildKey: (row: TRow) => string,
  buildRawKey: (row: RawSourceRow) => string | null,
  aggregateColumn: (col: string) => TRow[],
  combineAggregates: (aggregates: TRow[][]) => TRow[],
) {
  const resultTypeByGroup = new Map<string, PerformanceGoal>();
  const resultByGroup = new Map<string, number>();
  const revenueByGroup = new Map<string, number>();

  for (const goal of GRANULAR_RESULT_GOAL_PRIORITY) {
    const mapping = mappingGroupsByGoal.get(goal);
    if (!mapping) continue;
    const { resultColumns, valueColumns } = mapping;

    const touchedKeys = new Set<string>();
    for (const row of rows) {
      const key = buildRawKey(row);
      if (key === null) continue;
      if (resultColumns.some((col) => parseSourceNumericValue(row[col]).kind !== "empty")) touchedKeys.add(key);
    }
    if (touchedKeys.size === 0) continue;

    const combinedResult = combineAggregates(resultColumns.map((col) => aggregateColumn(col)));

    let valueByKey: Map<string, number> | null = null;
    if (valueColumns.length > 0) {
      const combinedValue = combineAggregates(valueColumns.map((col) => aggregateColumn(col)));
      valueByKey = new Map(combinedValue.map((row) => [buildKey(row), row.value]));
    }

    for (const row of combinedResult) {
      const key = buildKey(row);
      if (!touchedKeys.has(key)) continue;
      if (resultTypeByGroup.has(key)) continue;
      resultTypeByGroup.set(key, goal);
      resultByGroup.set(key, row.value);
      if (valueByKey?.has(key)) revenueByGroup.set(key, valueByKey.get(key) as number);
    }
  }

  return {
    resultTypeByGroup: resultTypeByGroup.size > 0 ? resultTypeByGroup : null,
    resultByGroup: resultByGroup.size > 0 ? resultByGroup : null,
    revenueByGroup: revenueByGroup.size > 0 ? revenueByGroup : null,
  };
}

export function resolveCampaignGroupResult(
  rows: ReturnType<typeof flattenMetaApiRowsToRawSourceRows>,
  mappingGroupsByGoal: Map<PerformanceGoal, { resultColumns: string[]; valueColumns: string[] }>,
) {
  return resolveGroupResultByGoalPriority(
    rows,
    mappingGroupsByGoal,
    (row) => `${row.date} ${row.campaignName}`,
    (row) => {
      const date = rawColumnString(row, META_API_COLUMNS.date);
      const campaignName = rawColumnString(row, META_API_COLUMNS.campaignName);
      return date && campaignName ? `${date} ${campaignName}` : null;
    },
    (col) => aggregateColumnByCampaignGroup(rows, META_API_COLUMNS.date, META_API_COLUMNS.campaignName, col),
    combineCampaignGroupValues,
  );
}

export function resolveAdSetGroupResult(
  rows: ReturnType<typeof flattenMetaApiRowsToRawSourceRows>,
  mappingGroupsByGoal: Map<PerformanceGoal, { resultColumns: string[]; valueColumns: string[] }>,
) {
  return resolveGroupResultByGoalPriority(
    rows,
    mappingGroupsByGoal,
    (row) => `${row.date} ${row.campaignName} ${row.adSetName}`,
    (row) => {
      const date = rawColumnString(row, META_API_COLUMNS.date);
      const campaignName = rawColumnString(row, META_API_COLUMNS.campaignName);
      const adSetName = rawColumnString(row, META_API_COLUMNS.adSetName);
      return date && campaignName && adSetName ? `${date} ${campaignName} ${adSetName}` : null;
    },
    (col) => aggregateColumnByAdSetGroup(rows, META_API_COLUMNS.date, META_API_COLUMNS.campaignName, META_API_COLUMNS.adSetName, col),
    combineAdSetGroupValues,
  );
}

export function resolveCreativeGroupResult(
  rows: ReturnType<typeof flattenMetaApiRowsToRawSourceRows>,
  mappingGroupsByGoal: Map<PerformanceGoal, { resultColumns: string[]; valueColumns: string[] }>,
) {
  return resolveGroupResultByGoalPriority(
    rows,
    mappingGroupsByGoal,
    (row) => `${row.date} ${row.campaignName} ${row.creativeName}`,
    (row) => {
      const date = rawColumnString(row, META_API_COLUMNS.date);
      const campaignName = rawColumnString(row, META_API_COLUMNS.campaignName);
      const creativeName = rawColumnString(row, META_API_COLUMNS.adName);
      return date && campaignName && creativeName ? `${date} ${campaignName} ${creativeName}` : null;
    },
    (col) => aggregateColumnByAdCreativeGroup(rows, META_API_COLUMNS.date, META_API_COLUMNS.campaignName, META_API_COLUMNS.adName, col),
    combineAdCreativeGroupValues,
  );
}

export function resolvePlacementGroupResult(
  rows: ReturnType<typeof flattenMetaApiRowsToRawSourceRows>,
  mappingGroupsByGoal: Map<PerformanceGoal, { resultColumns: string[]; valueColumns: string[] }>,
) {
  return resolveGroupResultByGoalPriority(
    rows,
    mappingGroupsByGoal,
    (row) => `${row.date} ${row.campaignName} ${row.platformPosition}`,
    (row) => {
      const date = rawColumnString(row, META_API_COLUMNS.date);
      const campaignName = rawColumnString(row, META_API_COLUMNS.campaignName);
      const platformPosition = rawColumnString(row, META_API_COLUMNS.platformPosition);
      return date && campaignName && platformPosition ? `${date} ${campaignName} ${platformPosition}` : null;
    },
    (col) => aggregateColumnByPlacementGroup(rows, META_API_COLUMNS.date, META_API_COLUMNS.campaignName, META_API_COLUMNS.platformPosition, col),
    combinePlacementGroupValues,
  );
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
