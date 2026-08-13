import { createClient as createRawClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  aggregateAdCreativeDailyRows,
  aggregateCampaignDailyRows,
  aggregateColumnByAdCreativeGroup,
  aggregateColumnByCampaignGroup,
  aggregateDailyColumn,
  buildAdCreativeDailyMetricsUpsertRows,
  buildCampaignDailyMetricsUpsertRows,
  buildDailyPerformanceUpsertRows,
  buildDailySpendUpsertRows,
  combineAdCreativeGroupValues,
  combineAggregatedDailyValues,
  combineCampaignGroupValues,
  excludeRowsByCampaignName,
  filterRowsByCampaignName,
  validateAccountIdColumn,
  type RawSourceRow,
} from "@/lib/import-sources";
import type { PerformanceGoal } from "@/lib/performance-goals";

export interface ImportDateRange {
  since: string; // YYYY-MM-DD, inclusive
  until: string; // YYYY-MM-DD, inclusive
}

/** Nenhuma sincronização real de UMA fonte deveria levar perto disso —
 * usado só pra distinguir "execução realmente em andamento agora" de
 * "execução travou num timeout de função serverless e nunca chegou em
 * `finishRun`", ficando presa em `status = "running"` pra sempre. */
const STALE_RUNNING_RUN_THRESHOLD_MS = 30 * 60 * 1000;

/** Campos comuns a toda a fonte (ver comentário de `import_sources` em
 * `supabase/stract-integration.sql`) sem os quais nem faz sentido tentar ler
 * a tabela de origem. `not null` no banco já impede NULL, mas não impede
 * string vazia — validado aqui pra falhar rápido com uma mensagem clara
 * (achado no levantamento "estado geral do sistema": hoje configuração
 * inválida só se manifesta como falha silenciosa ou um erro confuso de
 * leitura mais adiante, nunca um aviso direto sobre QUAL campo falta). */
function findMissingRequiredFields(importSource: {
  table_name: string;
  account_id_column: string;
  date_column: string;
  spend_column: string;
}): string[] {
  const requiredFields: Array<[string, string]> = [
    ["table_name", importSource.table_name],
    ["account_id_column", importSource.account_id_column],
    ["date_column", importSource.date_column],
    ["spend_column", importSource.spend_column],
  ];
  return requiredFields.filter(([, value]) => typeof value !== "string" || value.trim().length === 0).map(([key]) => key);
}

export interface ImportSourceRunResult {
  importSourceId: string;
  runId: string;
  /** `"empty"` = a leitura da fonte não teve nenhum erro, mas voltou com
   * ZERO linhas — só acontece numa releitura completa (nunca filtrada por
   * data), então nunca é confundido com "um dia sem gasto" (haveria outras
   * linhas históricas nesse caso). Sinal real de que a fonte pode ter
   * parado de enviar dado — ver `import_sources.status = "no_data"` abaixo. */
  status: "success" | "partial" | "failed" | "empty";
  rowsRead: number;
  spendRowsWritten: number;
  performanceRowsWritten: number;
  creativeRowsWritten: number;
  campaignRowsWritten: number;
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
      "id, client_id, provider, channel, external_account_id, table_name, account_id_column, date_column, spend_column, campaign_name_column, campaign_name_filter, campaign_name_exclude, ad_name_column, creative_permalink_column, preview_image_column, preview_image_fallback_column, impressions_column, reach_column, clicks_column",
    )
    .eq("id", importSourceId)
    .single();

  if (importSourceError || !importSource) {
    throw new Error(`import_source ${importSourceId} não encontrada: ${importSourceError?.message ?? "sem dados"}`);
  }

  const { data: mappings, error: mappingsError } = await supabase
    .from("metric_mappings")
    .select("goal, result_column, value_column")
    .eq("import_source_id", importSourceId)
    .eq("active", true);

  if (mappingsError) {
    throw new Error(`Falha ao ler metric_mappings de ${importSourceId}: ${mappingsError.message}`);
  }

  // Prevenção de execução concorrente da MESMA fonte (ex.: cron e
  // "Sincronizar agora" clicado no mesmo instante, ou duplo clique) — as
  // escritas já são idempotentes (upsert), então concorrência nunca corrompe
  // dado, mas gastaria API/DB à toa e deixaria duas linhas de
  // `data_sync_runs` concorrentes reportando a mesma janela.
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
    if (startedAgoMs < STALE_RUNNING_RUN_THRESHOLD_MS) {
      const concurrencyMessage = `Sincronização já em andamento para esta fonte (iniciada há ${Math.round(startedAgoMs / 1000)}s) — nova execução não iniciada para evitar concorrência.`;
      const { data: skippedRun } = await supabase
        .from("data_sync_runs")
        .insert({ import_source_id: importSourceId, status: "failed", finished_at: new Date().toISOString(), error_message: concurrencyMessage })
        .select("id")
        .single();
      return {
        importSourceId,
        runId: skippedRun?.id ?? activeRun.id,
        status: "failed",
        rowsRead: 0,
        spendRowsWritten: 0,
        performanceRowsWritten: 0,
        creativeRowsWritten: 0,
        campaignRowsWritten: 0,
        errorMessage: concurrencyMessage,
      };
    }

    // "running" há mais tempo do que qualquer sincronização real levaria —
    // provável timeout de função serverless que nunca chegou em
    // `finishRun`, ficando presa pra sempre. Fecha como falha antes de
    // seguir, pra nunca deixar uma linha órfã confundindo o histórico.
    await finishRun(supabase, activeRun.id, {
      status: "failed",
      rowsRead: 0,
      spendRowsWritten: 0,
      performanceRowsWritten: 0,
      creativeRowsWritten: 0,
      campaignRowsWritten: 0,
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

  const nowIso = new Date().toISOString();
  let rows: RawSourceRow[] = [];
  let errorMessage: string | null = null;

  const missingRequiredFields = findMissingRequiredFields(importSource);
  if (missingRequiredFields.length > 0) {
    errorMessage = `Configuração incompleta: ${missingRequiredFields.join(", ")} não definido(s) em import_sources — corrija via SQL antes de sincronizar de novo.`;
  }

  if (!errorMessage) {
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
  }

  if (!errorMessage && rows.length > 0) {
    const accountValidation = validateAccountIdColumn(rows, importSource.account_id_column, importSource.external_account_id);
    if (!accountValidation.valid) {
      errorMessage = `external_account_id divergente: esperado "${importSource.external_account_id}", encontrado(s) ${accountValidation.distinctValuesFound.join(", ")} em ${accountValidation.mismatchCount} linha(s). Importação abortada — nunca inferimos o cliente pelo nome da tabela.`;
    }
  }

  if (errorMessage) {
    await finishRun(supabase, run.id, {
      status: "failed",
      rowsRead: rows.length,
      spendRowsWritten: 0,
      performanceRowsWritten: 0,
      creativeRowsWritten: 0,
      campaignRowsWritten: 0,
      errorMessage,
    });
    await supabase.from("import_sources").update({ status: "error" }).eq("id", importSourceId);
    return {
      importSourceId,
      runId: run.id,
      status: "failed",
      rowsRead: rows.length,
      spendRowsWritten: 0,
      performanceRowsWritten: 0,
      creativeRowsWritten: 0,
      campaignRowsWritten: 0,
      errorMessage,
    };
  }

  // Filtro de campanha (opcional): nunca depende do provedor externo aplicar
  // o filtro certo na extração — quando configurado, a MITZA garante isso
  // por conta própria, antes de qualquer agregação (investimento e
  // resultado usam a mesma lista de linhas já filtrada). Inclusão e exclusão
  // são independentes — uma fonte pode usar as duas, uma só, ou nenhuma.
  if (importSource.campaign_name_column && importSource.campaign_name_filter) {
    rows = filterRowsByCampaignName(rows, importSource.campaign_name_column, importSource.campaign_name_filter);
  }
  if (importSource.campaign_name_column && importSource.campaign_name_exclude) {
    rows = excludeRowsByCampaignName(rows, importSource.campaign_name_column, importSource.campaign_name_exclude);
  }

  let hadInvalidRows = false;
  let spendRowsWritten = 0;
  let performanceRowsWritten = 0;
  let creativeRowsWritten = 0;
  let campaignRowsWritten = 0;
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

  // Um objetivo pode ser alimentado por MAIS DE UMA coluna de origem (ex.:
  // leads via formulário + leads via WhatsApp — métricas diferentes no
  // Meta/Stract, mas o mesmo objetivo na MITZA) — por isso agrupamos por
  // `goal` e somamos (`combineAggregatedDailyValues`) antes de gravar.
  // Gravar cada mapeamento separadamente, na mesma chave de upsert
  // `(client_id, date, channel, result_type)`, faria o último sobrescrever
  // os anteriores em vez de somar.
  const mappingGroupsByGoal = new Map<PerformanceGoal, { resultColumns: string[]; valueColumns: string[] }>();
  for (const mapping of mappings ?? []) {
    const goal = mapping.goal as PerformanceGoal;
    const group = mappingGroupsByGoal.get(goal) ?? { resultColumns: [], valueColumns: [] };
    group.resultColumns.push(mapping.result_column);
    if (mapping.value_column) group.valueColumns.push(mapping.value_column);
    mappingGroupsByGoal.set(goal, group);
  }

  for (const [goal, { resultColumns, valueColumns }] of mappingGroupsByGoal) {
    const resultColumnAggregates = resultColumns.map((resultColumn) => aggregateDailyColumn(rows, importSource.date_column, resultColumn));
    for (const columnAggregate of resultColumnAggregates) {
      hadInvalidRows = hadInvalidRows || columnAggregate.some((row) => row.invalidRowCount > 0);
    }

    const combinedResultAggregate = combineAggregatedDailyValues(resultColumnAggregates);
    if (combinedResultAggregate.length === 0) continue;

    // Receita é uma agregação SEPARADA (unidade diferente de result_count —
    // nunca somada junto via combineAggregatedDailyValues, que é pra somar
    // colunas da MESMA unidade). Só roda quando o objetivo tiver
    // value_column configurado (na prática, só vendas — reforçado também
    // pela constraint metric_mappings_value_column_only_for_sales).
    let revenueByDate: Map<string, number> | null = null;
    if (valueColumns.length > 0) {
      const valueColumnAggregates = valueColumns.map((valueColumn) => aggregateDailyColumn(rows, importSource.date_column, valueColumn));
      for (const columnAggregate of valueColumnAggregates) {
        hadInvalidRows = hadInvalidRows || columnAggregate.some((row) => row.invalidRowCount > 0);
      }
      const combinedValueAggregate = combineAggregatedDailyValues(valueColumnAggregates);
      revenueByDate = new Map(combinedValueAggregate.map((row) => [row.date, row.value]));
    }

    const performanceUpsertRows = buildDailyPerformanceUpsertRows(
      importSource.client_id,
      importSource.channel,
      goal,
      combinedResultAggregate,
      nowIso,
      revenueByDate,
    );
    const { error: performanceUpsertError } = await supabase
      .from("daily_performance")
      .upsert(performanceUpsertRows, { onConflict: "client_id,date,channel,result_type" });

    if (performanceUpsertError) {
      partialReasons.push(`resultado (${goal}) não gravado: ${performanceUpsertError.message}`);
    } else {
      performanceRowsWritten += performanceUpsertRows.length;
    }
  }

  // Módulo de Criativos (Creative Analytics) — arquitetura aprovada:
  // identidade do criativo é sempre `creative_name` (= ad_name do Meta),
  // nunca ad_id. Só roda quando a fonte tiver `ad_name_column` E
  // `campaign_name_column` configurados (campanha é obrigatória na tabela
  // ad_creative_daily_metrics) — sem isso, degrada graciosamente: nenhum
  // erro, só não escreve nada aqui (a fonte pode continuar servindo
  // investimento/resultado normalmente pro resto da plataforma).
  if (importSource.ad_name_column && importSource.campaign_name_column) {
    const creativeAggregate = aggregateAdCreativeDailyRows(rows, {
      dateColumn: importSource.date_column,
      campaignNameColumn: importSource.campaign_name_column,
      creativeNameColumn: importSource.ad_name_column,
      permalinkColumn: importSource.creative_permalink_column,
      previewImageColumn: importSource.preview_image_column,
      previewImageFallbackColumn: importSource.preview_image_fallback_column,
      spendColumn: importSource.spend_column,
      impressionsColumn: importSource.impressions_column,
      reachColumn: importSource.reach_column,
      clicksColumn: importSource.clicks_column,
    });
    hadInvalidRows = hadInvalidRows || creativeAggregate.some((row) => row.invalidRowCount > 0);

    if (creativeAggregate.length > 0) {
      // ad_creative_daily_metrics guarda só UM result_type por linha —
      // pega o primeiro objetivo leads/sales com dado real (followers nunca
      // vem do Meta Ads, então nunca se aplica aqui). Mesma resolução de
      // metric_mappings já usada pra daily_performance, nunca uma segunda
      // lógica de mapeamento.
      let creativeResultType: PerformanceGoal | null = null;
      let resultByGroup: Map<string, number> | null = null;
      let revenueByGroup: Map<string, number> | null = null;

      for (const [goal, { resultColumns, valueColumns }] of mappingGroupsByGoal) {
        if (goal !== "leads" && goal !== "sales") continue;

        const resultColumnAggregates = resultColumns.map((resultColumn) =>
          aggregateColumnByAdCreativeGroup(
            rows,
            importSource.date_column,
            importSource.campaign_name_column!,
            importSource.ad_name_column!,
            resultColumn,
          ),
        );
        for (const columnAggregate of resultColumnAggregates) {
          hadInvalidRows = hadInvalidRows || columnAggregate.some((row) => row.invalidRowCount > 0);
        }

        const combinedResult = combineAdCreativeGroupValues(resultColumnAggregates);
        if (combinedResult.length === 0) continue;

        creativeResultType = goal;
        resultByGroup = new Map(combinedResult.map((row) => [`${row.date} ${row.campaignName} ${row.creativeName}`, row.value]));

        if (valueColumns.length > 0) {
          const valueColumnAggregates = valueColumns.map((valueColumn) =>
            aggregateColumnByAdCreativeGroup(
              rows,
              importSource.date_column,
              importSource.campaign_name_column!,
              importSource.ad_name_column!,
              valueColumn,
            ),
          );
          for (const columnAggregate of valueColumnAggregates) {
            hadInvalidRows = hadInvalidRows || columnAggregate.some((row) => row.invalidRowCount > 0);
          }
          const combinedValue = combineAdCreativeGroupValues(valueColumnAggregates);
          revenueByGroup = new Map(combinedValue.map((row) => [`${row.date} ${row.campaignName} ${row.creativeName}`, row.value]));
        }
        break;
      }

      const creativeUpsertRows = buildAdCreativeDailyMetricsUpsertRows(importSource.client_id, importSourceId, creativeAggregate, {
        resultType: creativeResultType,
        resultByGroup,
        revenueByGroup,
      });

      const { error: creativeUpsertError } = await supabase
        .from("ad_creative_daily_metrics")
        .upsert(creativeUpsertRows, { onConflict: "import_source_id,date,campaign_name,creative_name" });

      if (creativeUpsertError) {
        partialReasons.push(`criativos não gravados: ${creativeUpsertError.message}`);
      } else {
        creativeRowsWritten = creativeUpsertRows.length;
      }
    }
  } else if ((mappings ?? []).length > 0) {
    // Antes degradava 100% silencioso (nenhum erro, só nunca escrevia
    // nada aqui — achado real em produção: vendas sumindo da Análise de
    // Criativos sem nenhuma explicação). Só sinaliza quando a fonte tem
    // pelo menos um objetivo mapeado (senão a fonte nem pretende rastrear
    // resultado, e a ausência dessas colunas não é uma lacuna real).
    partialReasons.push(
      "Configuração incompleta: ad_name_column e/ou campaign_name_column não definidos nesta fonte — rastreamento por criativo (Análise de Criativos) fica sem dado; investimento e resultado no nível da conta continuam normais.",
    );
  }

  // Camada normalizada de CAMPANHA (`campaign_daily_metrics`, achado da
  // auditoria da integração Google Ads) — independente de Criativos: roda
  // sempre que `campaign_name_column` existir, nunca condicionada a
  // `ad_name_column`. Nunca fabrica creative_name/usa ad_creative_daily_metrics
  // como atalho — é uma agregação própria por (date, campaign_name).
  if (importSource.campaign_name_column) {
    const campaignAggregate = aggregateCampaignDailyRows(rows, {
      dateColumn: importSource.date_column,
      campaignNameColumn: importSource.campaign_name_column,
      spendColumn: importSource.spend_column,
      impressionsColumn: importSource.impressions_column,
      reachColumn: importSource.reach_column,
      clicksColumn: importSource.clicks_column,
    });
    hadInvalidRows = hadInvalidRows || campaignAggregate.some((row) => row.invalidRowCount > 0);

    if (campaignAggregate.length > 0) {
      // Mesma resolução de metric_mappings já usada por daily_performance/
      // ad_creative_daily_metrics — nunca uma segunda lógica de mapeamento.
      // Um objetivo por campanha (mesma limitação de ad_creative_daily_metrics).
      let campaignResultType: PerformanceGoal | null = null;
      let resultByGroup: Map<string, number> | null = null;
      let revenueByGroup: Map<string, number> | null = null;

      for (const [goal, { resultColumns, valueColumns }] of mappingGroupsByGoal) {
        if (goal !== "leads" && goal !== "sales") continue;

        const resultColumnAggregates = resultColumns.map((resultColumn) =>
          aggregateColumnByCampaignGroup(rows, importSource.date_column, importSource.campaign_name_column!, resultColumn),
        );
        for (const columnAggregate of resultColumnAggregates) {
          hadInvalidRows = hadInvalidRows || columnAggregate.some((row) => row.invalidRowCount > 0);
        }

        const combinedResult = combineCampaignGroupValues(resultColumnAggregates);
        if (combinedResult.length === 0) continue;

        campaignResultType = goal;
        resultByGroup = new Map(combinedResult.map((row) => [`${row.date} ${row.campaignName}`, row.value]));

        if (valueColumns.length > 0) {
          const valueColumnAggregates = valueColumns.map((valueColumn) =>
            aggregateColumnByCampaignGroup(rows, importSource.date_column, importSource.campaign_name_column!, valueColumn),
          );
          for (const columnAggregate of valueColumnAggregates) {
            hadInvalidRows = hadInvalidRows || columnAggregate.some((row) => row.invalidRowCount > 0);
          }
          const combinedValue = combineCampaignGroupValues(valueColumnAggregates);
          revenueByGroup = new Map(combinedValue.map((row) => [`${row.date} ${row.campaignName}`, row.value]));
        }
        break;
      }

      const campaignUpsertRows = buildCampaignDailyMetricsUpsertRows(importSource.client_id, importSourceId, importSource.channel, campaignAggregate, {
        resultType: campaignResultType,
        resultByGroup,
        revenueByGroup,
      });

      const { error: campaignUpsertError } = await supabase
        .from("campaign_daily_metrics")
        .upsert(campaignUpsertRows, { onConflict: "import_source_id,date,channel,campaign_name" });

      if (campaignUpsertError) {
        partialReasons.push(`campanhas não gravadas: ${campaignUpsertError.message}`);
      } else {
        campaignRowsWritten = campaignUpsertRows.length;
      }
    }
  }

  const isEmpty = rows.length === 0;
  const status: ImportSourceRunResult["status"] = partialReasons.length > 0 ? "partial" : hadInvalidRows ? "partial" : isEmpty ? "empty" : "success";
  const finalErrorMessage = partialReasons.length > 0
    ? partialReasons.join(" | ")
    : hadInvalidRows
      ? "Uma ou mais linhas foram ignoradas por valor inválido (não numérico ou negativo)."
      : isEmpty
        ? "A leitura da fonte não teve erro, mas voltou com zero linhas."
        : null;

  await finishRun(supabase, run.id, {
    status,
    rowsRead: rows.length,
    spendRowsWritten,
    performanceRowsWritten,
    creativeRowsWritten,
    campaignRowsWritten,
    errorMessage: finalErrorMessage,
  });

  // Bug real encontrado em produção: antes, `import_sources.status`/
  // `last_success_at` eram sempre bumpados pra "active"/agora, mesmo quando
  // a fonte voltava com zero linhas — uma conexão que parou de trazer dado
  // novo continuava parecendo "ativa e sincronizada agora" pra sempre.
  //
  // `!dateRange` = releitura completa (o cron nunca filtra por data — ver
  // comentário da função). Só nesse caso zero linhas é um sinal real de
  // problema (a tabela de origem inteira veio vazia); um gatilho manual com
  // recorte de data que não achou nada NAQUELE recorte é normal (ex.:
  // reprocessar só um dia sem gasto) e nunca deve mexer na saúde persistente
  // da fonte. `last_success_at`/`last_imported_date` só avançam quando há
  // dado real — continuam apontando pra última sincronização de verdade.
  if (!isEmpty) {
    await supabase
      .from("import_sources")
      .update({
        status: "active",
        last_imported_date: maxDateValue(rows, importSource.date_column),
        last_success_at: nowIso,
      })
      .eq("id", importSourceId);
  } else if (!dateRange) {
    await supabase.from("import_sources").update({ status: "no_data" }).eq("id", importSourceId);
  }

  return {
    importSourceId,
    runId: run.id,
    status,
    rowsRead: rows.length,
    spendRowsWritten,
    performanceRowsWritten,
    creativeRowsWritten,
    campaignRowsWritten,
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
    creativeRowsWritten: number;
    campaignRowsWritten: number;
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
 *
 * Pagina via `.range()` até uma página vir com menos linhas que `pageSize`
 * — o PostgREST limita `select("*")` sem paginação a um teto por requisição
 * (achado real: uma conta com 2131 linhas trazia só as primeiras 707, sem
 * erro nenhum, cortando silenciosamente os meses mais recentes). Sem isso,
 * qualquer fonte que crescer além desse teto perderia histórico recente sem
 * nenhum aviso.
 */
async function readSourceTable(tableName: string): Promise<RawSourceRow[]> {
  const rawClient = createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const pageSize = 1000;
  const rows: RawSourceRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await rawClient.from(tableName).select("*").range(from, from + pageSize - 1);
    if (error) {
      throw new Error(error.message);
    }
    const page = (data ?? []) as RawSourceRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}
