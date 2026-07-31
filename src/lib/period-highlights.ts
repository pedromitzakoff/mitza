import { PERFORMANCE_GOALS, type PerformanceGoal } from "./performance-goals";
import type { AnalyticsTrend } from "./analytics";
import type { CreativeSummary } from "./creative-analytics";
import type { CampaignSummary } from "./campaign-analytics";

/**
 * "Destaques do período" — Etapa "Resumo Executivo". Substitui a leitura
 * "aqui estão todos os números" por "aqui está o que realmente chamou
 * atenção": cada card conta UM fato específico e verificável, nunca um
 * indicador solto. Puro (sem Supabase), reaproveita 100% dos agregados que
 * já existem em `lib/creative-analytics.ts`/`lib/campaign-analytics.ts`/
 * `lib/analytics.ts` (`AnalyticsTrend`) — nenhum dado novo, nenhuma tabela
 * nova.
 *
 * Mesma disciplina de degradação graciosa do resto do módulo: um destaque
 * só existe quando há base real pra afirmá-lo (resultado > 0, CPA
 * calculável, granularidade diária disponível). Sem base, o card
 * simplesmente não aparece no array — nunca um card vazio/fabricado.
 *
 * Primeira versão deliberadamente simples (regras determinísticas, sem IA)
 * — mesmo espírito de `buildExecutiveSummaryNarrative`. Pode ser enriquecida
 * no futuro sem mudar a forma (`PeriodHighlight[]`), então a UI não precisa
 * mudar quando a régua por trás de cada destaque ficar mais sofisticada.
 */
export interface PeriodHighlight {
  key: string;
  emoji: string;
  title: string;
  /** Corpo do card — primeira linha é sempre o "quem" (nome do criativo/
   * campanha/data), as seguintes são o "quanto". */
  lines: string[];
}

const dayMonthLongFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", timeZone: "UTC" });

function formatDayMonth(date: string): string {
  return dayMonthLongFormatter.format(new Date(`${date}T00:00:00Z`));
}

function bestCreativeHighlight(
  creativeSummaries: CreativeSummary[],
  goal: PerformanceGoal | null,
  formatCurrencyValue: (value: number) => string,
): PeriodHighlight | null {
  if (!goal) return null;
  const candidates = creativeSummaries.filter((c) => c.totalResultCount !== null && c.totalResultCount > 0);
  if (candidates.length === 0) return null;

  const best = [...candidates].sort((a, b) => {
    if (b.totalResultCount !== a.totalResultCount) return (b.totalResultCount ?? 0) - (a.totalResultCount ?? 0);
    return (a.cpa ?? Infinity) - (b.cpa ?? Infinity);
  })[0];

  const config = PERFORMANCE_GOALS[goal];
  const lines = [best.creativeName, `${best.totalResultCount} ${config.resultMetricLabel.toLowerCase()}`];
  if (best.cpa !== null) lines.push(`${config.costMetricShortLabel} ${formatCurrencyValue(best.cpa)}`);

  return { key: "best-creative", emoji: "🏆", title: "Melhor criativo", lines };
}

/** "Melhor campanha" — a de MENOR CPA da conta, nunca a de maior
 * investimento/resultado bruto (esse já é o critério de ordenação padrão da
 * lista em Campanhas; aqui o destaque é especificamente sobre eficiência). */
function bestCampaignHighlight(campaignSummaries: CampaignSummary[]): PeriodHighlight | null {
  const candidates = campaignSummaries.filter((c) => c.cpa !== null);
  if (candidates.length === 0) return null;

  const best = [...candidates].sort((a, b) => (a.cpa ?? Infinity) - (b.cpa ?? Infinity))[0];
  return { key: "best-campaign", emoji: "📈", title: "Melhor campanha", lines: [best.campaignName, "Menor CPA da conta."] };
}

function bestDayHighlight(
  trend: AnalyticsTrend | null,
  goal: PerformanceGoal | null,
  formatCurrencyValue: (value: number) => string,
): PeriodHighlight | null {
  if (!goal || !trend?.result) return null;

  const points = trend.result.points
    .map((point, index) => ({ date: point.date, resultCount: point.value, spend: trend.spend.points[index]?.value ?? 0 }))
    .filter((point) => point.resultCount > 0);
  if (points.length === 0) return null;

  const best = [...points].sort((a, b) => {
    if (b.resultCount !== a.resultCount) return b.resultCount - a.resultCount;
    return a.spend / a.resultCount - b.spend / b.resultCount;
  })[0];

  const config = PERFORMANCE_GOALS[goal];
  const cpa = best.resultCount > 0 ? best.spend / best.resultCount : null;
  const lines = [formatDayMonth(best.date), `${best.resultCount} ${config.resultMetricLabel.toLowerCase()}`];
  if (cpa !== null) lines.push(`${config.costMetricShortLabel} ${formatCurrencyValue(cpa)}`);

  return { key: "best-day", emoji: "📅", title: "Melhor dia", lines };
}

function highestSpendDayHighlight(trend: AnalyticsTrend | null, formatCurrencyValue: (value: number) => string): PeriodHighlight | null {
  if (!trend) return null;
  const points = trend.spend.points.filter((point) => point.value > 0);
  if (points.length === 0) return null;

  const best = [...points].sort((a, b) => b.value - a.value)[0];
  return { key: "highest-spend-day", emoji: "💰", title: "Maior investimento", lines: [formatDayMonth(best.date), formatCurrencyValue(best.value)] };
}

const ALERT_MIN_POINTS = 4;
const ALERT_THRESHOLD_PERCENT = 20;

/** Alerta de CPA — compara a segunda metade do período com a primeira
 * (nunca o período inteiro contra o anterior, isso já é o Capítulo I). Só
 * dispara com pelo menos `ALERT_MIN_POINTS` dias de dado e uma piora real
 * de pelo menos `ALERT_THRESHOLD_PERCENT`% — sem isso, nenhum alerta
 * (silêncio é o estado padrão, nunca um alerta fabricado pra "ter conteúdo"
 * no card). */
function cpaAlertHighlight(trend: AnalyticsTrend | null, goal: PerformanceGoal | null): PeriodHighlight | null {
  if (!goal || !trend?.result) return null;
  const dates = trend.result.points.map((p) => p.date);
  if (dates.length < ALERT_MIN_POINTS) return null;

  const mid = Math.floor(dates.length / 2);
  const firstHalf = trend.result.points.slice(0, mid).map((point, index) => ({ resultCount: point.value, spend: trend.spend.points[index]?.value ?? 0 }));
  const secondHalf = trend.result.points.slice(mid).map((point, index) => ({
    resultCount: point.value,
    spend: trend.spend.points[mid + index]?.value ?? 0,
  }));

  const firstSpend = firstHalf.reduce((sum, p) => sum + p.spend, 0);
  const firstResult = firstHalf.reduce((sum, p) => sum + p.resultCount, 0);
  const secondSpend = secondHalf.reduce((sum, p) => sum + p.spend, 0);
  const secondResult = secondHalf.reduce((sum, p) => sum + p.resultCount, 0);
  if (firstResult <= 0 || secondResult <= 0) return null;

  const firstCpa = firstSpend / firstResult;
  const secondCpa = secondSpend / secondResult;
  const increasePercent = ((secondCpa - firstCpa) / firstCpa) * 100;
  if (increasePercent < ALERT_THRESHOLD_PERCENT) return null;

  const config = PERFORMANCE_GOALS[goal];
  const rangeStart = formatDayMonth(trend.result.points[mid].date);
  const rangeEnd = formatDayMonth(trend.result.points[trend.result.points.length - 1].date);
  return {
    key: "cpa-alert",
    emoji: "⚠️",
    title: "Atenção",
    lines: [`Entre ${rangeStart} e ${rangeEnd}`, `${config.costMetricShortLabel} subiu ${Math.round(increasePercent)}%.`],
  };
}

export function buildPeriodHighlights(input: {
  goal: PerformanceGoal | null;
  trend: AnalyticsTrend | null;
  creativeSummaries: CreativeSummary[];
  campaignSummaries: CampaignSummary[];
  formatCurrencyValue: (value: number) => string;
}): PeriodHighlight[] {
  const { goal, trend, creativeSummaries, campaignSummaries, formatCurrencyValue } = input;

  return [
    bestCreativeHighlight(creativeSummaries, goal, formatCurrencyValue),
    bestCampaignHighlight(campaignSummaries),
    bestDayHighlight(trend, goal, formatCurrencyValue),
    highestSpendDayHighlight(trend, formatCurrencyValue),
    cpaAlertHighlight(trend, goal),
  ].filter((highlight): highlight is PeriodHighlight => highlight !== null);
}
