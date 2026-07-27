import { createClient as createRawClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  aggregateDailyColumn,
  buildDailyPerformanceUpsertRows,
  buildDailySpendUpsertRows,
  validateAccountIdColumn,
  type RawSourceRow,
} from "@/lib/import-sources";
import type { PerformanceGoal } from "@/lib/performance-goals";

export interface ImportDateRange {
  since: string; // YYYY-MM-DD, inclusive
  until: string; // YYYY-MM-DD, inclusive
}

export interface ImportSourceRunResult {
  importSourceId: string;
  runId: string;
  status: "success" | "partial" | "failed";
  rowsRead: number;
  spendRowsWritten: number;
  performanceRowsWritten: number;
  errorMessage: string | null;
}

/**
 * Import Service — camada de sincronização Stract → Supabase → MITZA
 * (arquitetura aprovada após 3 rodadas de revisão, ver DECISIONS.md).
 *
 * Nunca descobre schema em tempo de execução (introspecção só acontece uma
 * vez, manualmente, quando um admin configura a `import_sources` — fora
 * deste arquivo). Aqui, `table_name`/`account_id_column`/`date_column`/
 * `spend_column`/`result_column` chegam sempre já resolvidos do banco —
 * nenhum nome de coluna do Stract é hardcoded neste arquivo nem em nenhum
 * outro lugar da MITZA.
 *
 * Relê sempre a janela completa configurada (nunca usa `last_imported_date`
 * como cursor) — o Stract reprocessa o histórico inteiro diariamente, então
 * bloquear releitura impediria correções retroativas de chegarem à MITZA.
 * Idempotente por construção: escreve sempre via upsert nas mesmas chaves
 * únicas de `daily_spend`/`daily_performance`.
 *
 * Mesma função serve o cron (todas as fontes ativas, sem `dateRange`) e
 * qualquer gatilho manual (uma fonte, um intervalo específico) — só varia
 * o argumento, no mesmo espírito de `syncClientMetaSpend`/
 * `syncAllClientsMetaSpend` (`lib/meta-sync.ts`).
 */
export async function runImportForSource(importSourceId: string, dateRange?: ImportDateRange): Promise<ImportSourceRunResult> {
  const supabase = createAdminClient();

  const { data: importSource, error: importSourceError } = await supabase
    .from("import_sources")
    .select(
      "id, client_id, provider, channel, external_account_id, table_name, account_id_column, date_column, spend_column",
    )
    .eq("id", importSourceId)
    .single();

  if (importSourceError || !importSource) {
    throw new Error(`import_source ${importSourceId} não encontrada: ${importSourceError?.message ?? "sem dados"}`);
  }

  const { data: mappings, error: mappingsError } = await supabase
    .from("metric_mappings")
    .select("goal, result_column")
    .eq("import_source_id", importSourceId)
    .eq("active", true);

  if (mappingsError) {
    throw new Error(`Falha ao ler metric_mappings de ${importSourceId}: ${mappingsError.message}`);
  }

  const { data: run, error: runInsertError } = await supabase
    .from("data_sync_runs")
    .insert({ import_source_id: importSourceId, status: "running" })
    .select("id")
    .single();

  if (runInsertError || !run) {
    throw new Error(`Falha ao criar data_sync_runs pra ${importSourceId}: ${runInsertError?.message ?? "sem dados"}`);
  }

  const nowIso = new Date().toISOString();
  let rows: RawSourceRow[] = [];
  let errorMessage: string | null = null;

  try {
    rows = await readSourceTable(importSource.table_name);
    if (dateRange) {
      rows = rows.filter((row) => {
        const value = row[importSource.date_column];
        return typeof value === "string" && value >= dateRange.since && value <= dateRange.until;
      });
    }
  } catch (err) {
    errorMessage = `Falha ao ler a tabela de origem "${importSource.table_name}": ${err instanceof Error ? err.message : String(err)}`;
  }

  if (!errorMessage && rows.length > 0) {
    const accountValidation = validateAccountIdColumn(rows, importSource.account_id_column, importSource.external_account_id);
    if (!accountValidation.valid) {
      errorMessage = `external_account_id divergente: esperado "${importSource.external_account_id}", encontrado(s) ${accountValidation.distinctValuesFound.join(", ")} em ${accountValidation.mismatchCount} linha(s). Importação abortada — nunca inferimos o cliente pelo nome da tabela.`;
    }
  }

  if (errorMessage) {
    await finishRun(supabase, run.id, { status: "failed", rowsRead: rows.length, spendRowsWritten: 0, performanceRowsWritten: 0, errorMessage });
    await supabase.from("import_sources").update({ status: "error" }).eq("id", importSourceId);
    return { importSourceId, runId: run.id, status: "failed", rowsRead: rows.length, spendRowsWritten: 0, performanceRowsWritten: 0, errorMessage };
  }

  let hadInvalidRows = false;
  let spendRowsWritten = 0;
  let performanceRowsWritten = 0;
  const partialReasons: string[] = [];

  // Backfill automático de Sprints históricas (achado na validação: dado
  // importado de um mês sem Sprint cadastrada não aparece em nenhuma tela).
  // Cobre o intervalo de datas que a própria extração trouxe — assim,
  // qualquer cliente novo já ganha o histórico inteiro visível, sem
  // precisar de um script manual por cliente (ver
  // supabase/stract-sprint-backfill.sql).
  const minDate = minDateValue(rows, importSource.date_column);
  const maxDate = maxDateValue(rows, importSource.date_column);
  if (minDate && maxDate) {
    const { error: sprintBackfillError } = await supabase.rpc("ensure_client_sprints_for_range", {
      p_client_id: importSource.client_id,
      p_start_date: minDate,
      p_end_date: maxDate,
    });
    if (sprintBackfillError) {
      partialReasons.push(`sprints históricas não criadas: ${sprintBackfillError.message}`);
    }
  }

  const spendAggregate = aggregateDailyColumn(rows, importSource.date_column, importSource.spend_column);
  hadInvalidRows = hadInvalidRows || spendAggregate.some((row) => row.invalidRowCount > 0);

  if (spendAggregate.length > 0) {
    const spendUpsertRows = buildDailySpendUpsertRows(importSource.client_id, importSource.channel, spendAggregate, nowIso);
    const { error: spendUpsertError } = await supabase
      .from("daily_spend")
      .upsert(spendUpsertRows, { onConflict: "client_id,date,channel" });

    if (spendUpsertError) {
      partialReasons.push(`investimento não gravado: ${spendUpsertError.message}`);
    } else {
      spendRowsWritten = spendUpsertRows.length;
    }
  }

  for (const mapping of mappings ?? []) {
    const resultAggregate = aggregateDailyColumn(rows, importSource.date_column, mapping.result_column);
    hadInvalidRows = hadInvalidRows || resultAggregate.some((row) => row.invalidRowCount > 0);

    if (resultAggregate.length === 0) continue;

    const performanceUpsertRows = buildDailyPerformanceUpsertRows(
      importSource.client_id,
      importSource.channel,
      mapping.goal as PerformanceGoal,
      resultAggregate,
      nowIso,
    );
    const { error: performanceUpsertError } = await supabase
      .from("daily_performance")
      .upsert(performanceUpsertRows, { onConflict: "client_id,date,channel,result_type" });

    if (performanceUpsertError) {
      partialReasons.push(`resultado (${mapping.goal}) não gravado: ${performanceUpsertError.message}`);
    } else {
      performanceRowsWritten += performanceUpsertRows.length;
    }
  }

  const status: ImportSourceRunResult["status"] = partialReasons.length > 0 ? "partial" : hadInvalidRows ? "partial" : "success";
  const finalErrorMessage = partialReasons.length > 0 ? partialReasons.join(" | ") : hadInvalidRows ? "Uma ou mais linhas foram ignoradas por valor inválido (não numérico ou negativo)." : null;

  await finishRun(supabase, run.id, { status, rowsRead: rows.length, spendRowsWritten, performanceRowsWritten, errorMessage: finalErrorMessage });

  const lastImportedDate = rows.length > 0 ? maxDateValue(rows, importSource.date_column) : null;
  await supabase
    .from("import_sources")
    .update({
      status: "active",
      last_imported_date: lastImportedDate,
      last_success_at: nowIso,
    })
    .eq("id", importSourceId);

  return {
    importSourceId,
    runId: run.id,
    status,
    rowsRead: rows.length,
    spendRowsWritten,
    performanceRowsWritten,
    errorMessage: finalErrorMessage,
  };
}

/** Roda a importação de todas as fontes com `enabled = true` — usado pelo
 * cron. Uma fonte falhando nunca trava as demais (mesmo padrão defensivo de
 * `syncAllClientsMetaSpend`). */
export async function runImportForAllEnabledSources(): Promise<ImportSourceRunResult[]> {
  const supabase = createAdminClient();
  const { data: sources, error } = await supabase.from("import_sources").select("id").eq("enabled", true);

  if (error) {
    throw new Error(`Falha ao listar import_sources ativas: ${error.message}`);
  }

  const results: ImportSourceRunResult[] = [];
  for (const source of sources ?? []) {
    try {
      results.push(await runImportForSource(source.id));
    } catch (err) {
      console.error(`Falha ao importar import_source ${source.id}:`, err);
    }
  }
  return results;
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function finishRun(
  supabase: AdminClient,
  runId: string,
  result: {
    status: ImportSourceRunResult["status"];
    rowsRead: number;
    spendRowsWritten: number;
    performanceRowsWritten: number;
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
      error_message: result.errorMessage,
    })
    .eq("id", runId);
}

function maxDateValue(rows: RawSourceRow[], dateColumn: string): string | null {
  let max: string | null = null;
  for (const row of rows) {
    const value = row[dateColumn];
    if (typeof value === "string" && (max === null || value > max)) max = value;
  }
  return max;
}

function minDateValue(rows: RawSourceRow[], dateColumn: string): string | null {
  let min: string | null = null;
  for (const row of rows) {
    const value = row[dateColumn];
    if (typeof value === "string" && (min === null || value < min)) min = value;
  }
  return min;
}

/**
 * Lê a tabela de origem do Stract (nome dinâmico, schema `public`, colunas
 * variáveis conforme a extração configurada) — usa um client SEM o generic
 * `Database` (deliberado: essa tabela nunca faz parte do contrato tipado da
 * MITZA, só `import_sources.table_name` sabe o nome dela em tempo de
 * execução). Credenciais são as mesmas de `createAdminClient` (mesmo
 * projeto Supabase, service role).
 */
async function readSourceTable(tableName: string): Promise<RawSourceRow[]> {
  const rawClient = createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await rawClient.from(tableName).select("*");
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as RawSourceRow[];
}
