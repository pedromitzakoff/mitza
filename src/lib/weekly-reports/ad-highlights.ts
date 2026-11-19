import type { CreativeSummary } from "@/lib/creative-analytics";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { AdHighlightThresholds } from "@/lib/weekly-reports/report-thresholds";
import type { AdHighlights, BestCostHighlight, BestLinkCtrHighlight } from "@/lib/weekly-reports/report-types";

/**
 * Aba "Reports" (pedido, seção 3) — núcleo puro dos 2 destaques de anúncio,
 * calculado SÓ com os dados do período do report (`creatives` já vem
 * recortado pro período por quem chama, via `buildCreativeSummaries` sobre
 * `getAdCreativeDailyMetricsForPeriod` — nenhum cálculo de agregação
 * reimplementado aqui, só seleção/ranking sobre o que já existe).
 *
 * "Formato quando disponível" (pedido): a plataforma não rastreia formato
 * de criativo hoje (achado da pesquisa) — `format` sai sempre `null`
 * (`AdHighlightEntry.format`), nunca um valor fabricado.
 */

/** Elegível ao destaque de custo: do objetivo principal do cliente, com
 * `totalResultCount` confiável (>= mínimo) e custo computável (`cpa`
 * não-nulo — garantido junto por construção em `creative-analytics.ts`,
 * nunca resultCount>0 com cpa null). */
function isCostEligible(summary: CreativeSummary, goal: PerformanceGoal, thresholds: AdHighlightThresholds): boolean {
  return summary.resultType === goal && summary.totalResultCount !== null && summary.totalResultCount >= thresholds.minResults && summary.cpa !== null;
}

/** Elegível ao destaque de CTR de link: impressões confiáveis (>= mínimo) e
 * CTR de link computável. */
function isLinkCtrEligible(summary: CreativeSummary, thresholds: AdHighlightThresholds): boolean {
  return summary.totalImpressions !== null && summary.totalImpressions >= thresholds.minImpressions && summary.linkCtr !== null;
}

/** Desempate determinístico — sempre o mesmo vencedor pra o mesmo conjunto
 * de dados, nunca dependente da ordem de chegada das linhas. */
function compareByNameAsc(a: CreativeSummary, b: CreativeSummary): number {
  return a.creativeName.localeCompare(b.creativeName, "pt-BR");
}

/** Menor custo por resultado primeiro; empate no custo -> maior volume de
 * resultado primeiro (mais confiável); empate total -> nome (determinístico). */
function pickBestCost(eligible: CreativeSummary[]): CreativeSummary {
  return [...eligible].sort((a, b) => {
    if (a.cpa! !== b.cpa!) return a.cpa! - b.cpa!;
    if (a.totalResultCount! !== b.totalResultCount!) return b.totalResultCount! - a.totalResultCount!;
    return compareByNameAsc(a, b);
  })[0];
}

/** Maior CTR de link primeiro; empate -> maior volume de impressões
 * primeiro; empate total -> nome. */
function pickBestLinkCtr(eligible: CreativeSummary[]): CreativeSummary {
  return [...eligible].sort((a, b) => {
    if (a.linkCtr! !== b.linkCtr!) return b.linkCtr! - a.linkCtr!;
    if (a.totalImpressions! !== b.totalImpressions!) return b.totalImpressions! - a.totalImpressions!;
    return compareByNameAsc(a, b);
  })[0];
}

export function computeAdHighlights(creatives: CreativeSummary[], goal: PerformanceGoal, thresholds: AdHighlightThresholds): AdHighlights {
  const costEligible = creatives.filter((c) => isCostEligible(c, goal, thresholds));
  const linkCtrEligible = creatives.filter((c) => isLinkCtrEligible(c, thresholds));

  // Nenhum anúncio elegível pra um indicador -> omite esse destaque
  // inteiramente (pedido, seção 3) — nunca um "nenhum anúncio qualificado"
  // fabricado como se fosse um resultado.
  const bestCostSummary = costEligible.length > 0 ? pickBestCost(costEligible) : null;
  const bestLinkCtrSummary = linkCtrEligible.length > 0 ? pickBestLinkCtr(linkCtrEligible) : null;

  const bestCost: BestCostHighlight | null = bestCostSummary
    ? {
        adName: bestCostSummary.creativeName,
        format: null,
        permalinkUrl: bestCostSummary.permalinkUrl,
        resultCount: bestCostSummary.totalResultCount!,
        cost: bestCostSummary.cpa!,
      }
    : null;
  const bestLinkCtr: BestLinkCtrHighlight | null = bestLinkCtrSummary
    ? {
        adName: bestLinkCtrSummary.creativeName,
        format: null,
        permalinkUrl: bestLinkCtrSummary.permalinkUrl,
        linkCtr: bestLinkCtrSummary.linkCtr!,
        impressions: bestLinkCtrSummary.totalImpressions!,
      }
    : null;

  // Mesmo anúncio lidera os dois -> combina numa linha só (pedido, seção 3).
  const combined = bestCost !== null && bestLinkCtr !== null && bestCost.adName === bestLinkCtr.adName;

  return { bestCost, bestLinkCtr, combined };
}
