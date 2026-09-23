"use client";

import { useId, useMemo, useState } from "react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { buildAnalyticsKpiCards } from "@/lib/analytics";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { buildAdSetSummaries } from "@/lib/ad-set-analytics";
import { buildCreativeSummaries } from "@/lib/creative-analytics";
import { buildPlacementSummaries } from "@/lib/campaign-placement-analytics";
import {
  buildDailyTable,
  buildAdSetsTable,
  buildCreativesTable,
  buildPlacementsTable,
  type PerformanceReportDocument,
  type PerformanceReportTable,
} from "@/lib/performance-report/report-document";
import { flattenPeriodReadingLines } from "@/lib/performance-report/report-derivatives";
import {
  matchesNameFilter,
  recomputeDailyRows,
  recomputeFilteredSummary,
  type NameFilterMode,
  type FilterableDailyRow,
} from "@/lib/performance-report/report-filter-recompute";
import { ReportKpiGrid } from "./report-kpi-grid";
import { ReportTableSection } from "./report-table-section";

/** `ReportFilterableTables` só renderiza a visão "principal" (a visão
 * "secundario" usa `ReportSecondaryView`, sem este filtro — ver
 * `report-body.tsx`), então o único id de Campanhas possível aqui é este. */
const CAMPAIGNS_TABLE_ID = "campanhas";

/**
 * "Leitura do período" — movida de `report-body.tsx` pra cá (Etapa "Filtro
 * no topo afeta o dashboard inteiro") porque agora vive dentro do mesmo
 * componente que decide o Resumo real vs. filtrado. Comportamento e visual
 * intocados — só a localização do código mudou.
 */
function PeriodReading({ document }: { document: PerformanceReportDocument }) {
  const reading = document.periodReading;
  if (!reading) return null;

  const desktopLines = flattenPeriodReadingLines(reading);
  if (desktopLines.length === 0) return null;

  return (
    <>
      <div className="hidden sm:mt-4 sm:block sm:border-l-[3px] sm:border-[#D8F238] sm:bg-white/55 sm:px-4 sm:py-3.5">
        <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#6F6B65]">Leitura do período</div>
        <div className="flex flex-col gap-1">
          {desktopLines.map((sentence, index) => (
            <p key={index} className="max-w-xl text-sm leading-snug text-[#1E1E20]">
              {sentence}
            </p>
          ))}
        </div>
      </div>

      <div className="mt-6 sm:hidden">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#6F6B65]">Leitura do período</div>
        {reading.kind === "neutral" ? (
          <p className="mt-1.5 text-[15px] text-[#1E1E20]">{reading.message}</p>
        ) : (
          <div className="mt-1.5 flex flex-col gap-2">
            <p className="text-[15px] font-semibold leading-snug text-[#17171A]">{reading.summaryLine}</p>
            {reading.targetLine &&
              (reading.targetStatus === "better" ? (
                <span className="inline-block w-fit rounded-full bg-[#D8F238] px-2.5 py-1 text-[13px] font-bold text-[#17171A]">
                  {reading.targetLine}
                </span>
              ) : (
                <p className="text-[13px] font-semibold text-[#17171A]">{reading.targetLine}</p>
              ))}
            {reading.bestCampaignLine && (
              <p className="border-t border-[#D9D3C9] pt-2 text-[13px] text-[#6F6B65]">{reading.bestCampaignLine}</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Taxa de conversão (vendas ÷ carrinhos) — pedido explícito do usuário
 * ("carrinho é uma métrica secundária, só pra calcular a conversão").
 * `null` sem nenhum carrinho registrado no período (caso comum: só clientes
 * com a coluna de carrinho mapeada no Stract têm isso, hoje só Leonardo
 * Darcadia) — some por inteiro nesse caso, nunca um card com "—"/0%. Só
 * existe no nível de CONTA (`report-data.ts`), então nunca aparece enquanto
 * o filtro de Campanha/Público/Criativo está ativo — mesmo tratamento de
 * `PeriodReading`, evita mostrar um número que o filtro não afeta ao lado
 * de números que afeta.
 */
function ConversionRateNote({ conversionRate }: { conversionRate: number | null }) {
  if (conversionRate === null) return null;
  return (
    <div className="mt-3 inline-flex w-fit items-center gap-2 rounded-full border border-[#D9D3C9] bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#17171A]">
      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#6F6B65]">Taxa de conversão</span>
      <span>{formatPercent(conversionRate * 100)}</span>
    </div>
  );
}

/** Normaliza as 3 formas de linha bruta diária (campanha/público/criativo)
 * pra forma comum que `report-filter-recompute.ts` entende — só troca o
 * nome do campo de identidade (`campaignName`/`adSetName`/`creativeName`),
 * nenhum dado é perdido/alterado. */
function toFilterableRows(document: PerformanceReportDocument, dimensionId: string): FilterableDailyRow[] {
  if (dimensionId === "campanhas") {
    return document.campaignDailyRows.map((row) => ({ date: row.date, name: row.campaignName, spend: row.spend, resultCount: row.resultCount, revenue: row.revenue }));
  }
  if (dimensionId === "publicos") {
    return document.adSetDailyRows.map((row) => ({ date: row.date, name: row.adSetName, spend: row.spend, resultCount: row.resultCount, revenue: row.revenue }));
  }
  if (dimensionId === "criativos") {
    return document.creativeDailyRows.map((row) => ({ date: row.date, name: row.creativeName, spend: row.spend, resultCount: row.resultCount, revenue: row.revenue }));
  }
  return [];
}

/**
 * Etapa "Filtro no topo afeta o dashboard inteiro" — pedido explícito do
 * usuário depois da 1ª versão (que só filtrava as 3 tabelas de entidade):
 * "quero que o filtro faça o dash todo mudar... os big numbers e também a
 * tabela de resultado diário", com o controle subindo pra cima do Resumo
 * do período.
 *
 * Único dono do estado do filtro (modo/dimensão/texto) e agora também do
 * Resumo do período inteiro — porque as duas coisas (Resumo real vs.
 * recalculado) nunca podem ficar dessincronizadas. Quando filtrando:
 * - "Resultado Diário" é RECONSTRUÍDO via `buildDailyTable` (a MESMA
 *   função de sempre) a partir de linhas recalculadas por
 *   `recomputeDailyRows` — nunca uma segunda formatação de tabela.
 * - A tabela da dimensão selecionada (Campanhas/Públicos/Criativos) é
 *   filtrada por nome; as outras 2 passam intocadas.
 * - O Resumo do período (KPIs + resultado principal) é recalculado via
 *   `recomputeFilteredSummary` + a MESMA `buildAnalyticsKpiCards` que
 *   monta o Resumo real — nunca uma segunda fórmula/rótulo. Sem meta pra
 *   comparar contra (subconjunto filtrado nunca é comparado com a meta da
 *   carteira inteira) e sem "Leitura do período" (narrativa calculada pro
 *   período inteiro, ficaria contraditória com números filtrados).
 * - Um selo "Mostrando só: ..." deixa claro, sempre visível, que os
 *   números não são mais o total real da conta — nunca deixa a leitura
 *   parecer o resultado completo por engano.
 *
 * Sem `performanceGoal` configurado, o Resumo do período NUNCA é
 * recalculado (continua mostrando a mensagem de sempre) mesmo com o
 * filtro ativo nas tabelas — não existe rótulo de objetivo pra construir
 * um Resumo com sentido nesse caso.
 */
export function ReportFilterableTables({ document }: { document: PerformanceReportDocument }) {
  const filterableTables = useMemo(() => document.tables.filter((table) => table.nameFilterable), [document.tables]);
  const [mode, setMode] = useState<NameFilterMode>("contains");
  const [dimensionId, setDimensionId] = useState<string>(filterableTables[0]?.id ?? "");
  const [text, setText] = useState("");
  const formId = useId();

  const normalizedText = text.trim().toLowerCase();
  const isFiltering = dimensionId !== "" && normalizedText !== "";
  const dimensionTable = filterableTables.find((table) => table.id === dimensionId);

  // Etapa "Filtro por campanha afeta o Relatório inteiro" (pedido explícito
  // do usuário: "se eu colocar campanha contém WPP, então todas infos do
  // relatório devem ser das campanhas que contém WPP no nome") — só quando
  // a dimensão filtrada é CAMPANHA (Público/Criativo não têm uma campanha
  // única pra propagar a partir deles, continuam com o comportamento de
  // sempre: só a própria tabela filtra). O nome que decide é sempre o de
  // `campaignDailyRows` (a mesma fonte que já resolve "Resultado Diário"/
  // Resumo pra esse caso) — nunca uma segunda lista de nomes.
  const isFilteringByCampaign = isFiltering && dimensionId === CAMPAIGNS_TABLE_ID;
  const matchingCampaignNames = useMemo(() => {
    if (!isFilteringByCampaign) return null;
    return new Set(
      document.campaignDailyRows.filter((row) => matchesNameFilter(row.campaignName, mode, normalizedText)).map((row) => row.campaignName),
    );
  }, [document, isFilteringByCampaign, mode, normalizedText]);

  const effectiveTables = useMemo(() => {
    if (!isFiltering) return document.tables;
    const rawRows = toFilterableRows(document, dimensionId);

    return document.tables.map((table): PerformanceReportTable => {
      if (table.id === "resultado-diario") {
        const recomputedDaily = recomputeDailyRows(document.period, rawRows, mode, normalizedText);
        return buildDailyTable(recomputedDaily, document.performanceGoal);
      }
      if (table.id === dimensionId) {
        const rows = table.rows.filter((row) => matchesNameFilter(row.name, mode, normalizedText));
        if (rows.length === table.rows.length) return table;
        return { ...table, rows, emptyMessage: rows.length === 0 ? "Sem resultado para esse filtro." : table.emptyMessage };
      }
      // Reconstroem a partir das linhas BRUTAS (têm `campaignName`, ao
      // contrário das linhas já resumidas que a tabela original usou) via os
      // MESMOS agregadores/builders canônicos de sempre — nunca uma segunda
      // fórmula, só um subconjunto de linhas diferente entrando neles.
      if (matchingCampaignNames && table.id === "publicos") {
        return buildAdSetsTable(buildAdSetSummaries(document.adSetDailyRows.filter((row) => matchingCampaignNames.has(row.campaignName))));
      }
      if (matchingCampaignNames && table.id === "criativos") {
        return buildCreativesTable(buildCreativeSummaries(document.creativeDailyRows.filter((row) => matchingCampaignNames.has(row.campaignName))));
      }
      if (matchingCampaignNames && table.id === "posicionamentos") {
        return buildPlacementsTable(buildPlacementSummaries(document.placementDailyRows.filter((row) => matchingCampaignNames.has(row.campaignName))));
      }
      return table;
    });
  }, [document, isFiltering, dimensionId, mode, normalizedText, matchingCampaignNames]);

  const filteredSummary = useMemo(() => {
    if (!isFiltering || !document.performanceGoal) return null;
    const rawRows = toFilterableRows(document, dimensionId);
    return recomputeFilteredSummary(document.performanceGoal, rawRows, mode, normalizedText);
  }, [document, isFiltering, dimensionId, mode, normalizedText]);

  const summaryBlock =
    filteredSummary && document.performanceGoal
      ? {
          status: "ok" as const,
          kpis: buildAnalyticsKpiCards(document.performanceGoal, filteredSummary.actualSpend ?? 0, filteredSummary, null, formatCurrency),
          note: document.summary.status === "ok" ? document.summary.note : "",
        }
      : document.summary;

  const hero =
    filteredSummary && document.performanceGoal
      ? { value: String(filteredSummary.resultCount), label: PERFORMANCE_GOALS[document.performanceGoal].resultMetricLabel }
      : document.hero;

  const isSummaryFiltered = filteredSummary !== null;

  return (
    <>
      {filterableTables.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Modo do filtro"
            value={mode}
            onChange={(event) => setMode(event.target.value as NameFilterMode)}
            className="min-h-9 rounded-lg border border-[#D9D3C9] bg-white px-2 text-xs text-[#17171A]"
          >
            <option value="contains">contém</option>
            <option value="not_contains">não contém</option>
          </select>
          <select
            aria-label="Dimensão do filtro"
            value={dimensionId}
            onChange={(event) => setDimensionId(event.target.value)}
            className="min-h-9 rounded-lg border border-[#D9D3C9] bg-white px-2 text-xs text-[#17171A]"
          >
            {filterableTables.map((table) => (
              <option key={table.id} value={table.id}>
                {table.nameColumnHeader}
              </option>
            ))}
          </select>
          <input
            id={`${formId}-filter-text`}
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Digite o que procura"
            aria-label="Texto do filtro"
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-[#D9D3C9] bg-white px-2.5 text-xs text-[#17171A] placeholder:text-[#9C978D] sm:w-56 sm:flex-none"
          />
          {text !== "" && (
            <button
              type="button"
              onClick={() => setText("")}
              className="text-xs font-semibold text-[#6F6B65] underline underline-offset-2 hover:text-[#17171A]"
            >
              Limpar
            </button>
          )}
        </div>
      )}

      {isFiltering && dimensionTable && (
        <p className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-[#17171A] bg-[#17171A] px-3 py-1.5 text-xs font-semibold text-white">
          Mostrando só: {dimensionTable.nameColumnHeader} {mode === "contains" ? "contém" : "não contém"} &ldquo;{text.trim()}&rdquo;
        </p>
      )}

      <section id="resumo" className={`pb-6 sm:pb-9 ${filterableTables.length > 0 ? "mt-6 border-t border-[#D9D3C9] pt-6" : ""}`}>
        <h2 className="hidden text-2xl font-bold tracking-tight text-[#17171A] sm:block">
          {isSummaryFiltered ? "Resumo filtrado" : "Resumo do período"}
        </h2>
        <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#6F6B65] sm:hidden">
          {isSummaryFiltered ? "Resumo filtrado" : "Resumo do período"}
        </div>
        <div className="mt-2 sm:mt-5">
          <ReportKpiGrid summary={summaryBlock} hero={hero} />
        </div>
        {!isFiltering && <ConversionRateNote conversionRate={document.conversionRate} />}
        {/* "Leitura do período" é uma narrativa calculada pro período INTEIRO
            (melhor campanha, variação vs. meta da carteira inteira) — some
            enquanto o filtro está ativo pra nunca ficar contraditória com um
            Resumo que já mudou de números. */}
        {!isFiltering && <PeriodReading document={document} />}
      </section>

      {effectiveTables.map((table) => (
        <ReportTableSection key={table.id} table={table} />
      ))}
    </>
  );
}
