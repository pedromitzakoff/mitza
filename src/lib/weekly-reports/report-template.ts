import { formatCurrency, formatCount, formatPercent, formatShortDate, formatDateWithYear } from "@/lib/format";
import { PERFORMANCE_GOALS, formatPerformanceResult, type PerformanceGoal } from "@/lib/performance-goals";
import { WEEKLY_REPORT_PERIOD_KIND_WEEKDAY_RANGE_LABEL } from "@/lib/weekly-reports/report-labels";
import type { AdHighlights, WeeklyReportPeriodKind } from "@/lib/weekly-reports/report-types";

/**
 * Aba "Reports" (pedido: "use um template para gerar o texto com os dados
 * do sistema... os números, rankings e próximos passos devem vir dos
 * dados e registros da KOFF") — núcleo puro, nenhuma IA aqui (o pedido
 * reserva IA só pra ajudar a REDIGIR uma observação do gestor, nunca pra
 * gerar números; esta plataforma não tem IA integrada hoje, então o texto
 * final é 100% template).
 *
 * Formato espelha o exemplo ilustrativo do pedido byte a byte na estrutura
 * (blocos separados por linha em branco, "*negrito*" de WhatsApp,
 * emojis) — os NÚMEROS usam os formatadores canônicos da plataforma
 * (`formatCurrency`/`formatPercent`/`formatCount`), nunca uma formatação
 * paralela só pra este texto (`formatPercent` usa 2 casas decimais, uma
 * diferença mínima do exemplo ilustrativo, que usava 1 — consistência com
 * o resto da MITZA pesa mais que casar exatamente um exemplo).
 */

/** "13/11 a 15/11" — sem ano, igual ao exemplo, EXCETO quando o período
 * atravessa a virada de ano (pedido: validar "virada de mês e de ano"):
 * nesse caso mostra o ano nas duas pontas, pra nunca ficar ambíguo (ex.:
 * "29/12/2026 a 02/01/2027"). Virada de MÊS (sem virada de ano) nunca
 * precisa de ano — "27/11 a 01/12" já é inequívoco. */
export function formatReportPeriodLabel(periodStart: string, periodEnd: string): string {
  const crossesYear = periodStart.slice(0, 4) !== periodEnd.slice(0, 4);
  if (crossesYear) return `${formatDateWithYear(periodStart)} a ${formatDateWithYear(periodEnd)}`;
  return `${formatShortDate(periodStart)} a ${formatShortDate(periodEnd)}`;
}

/** Pedido do usuário: "prefiro que fique em lista, e não uma do lado da
 * outra" — cada métrica numa linha própria (nunca duas métricas juntas
 * separadas por "·"), sempre nesta ordem: resultado, depois custo por
 * resultado. */
function formatHeadlineResultLines(goal: PerformanceGoal, resultCount: number, costPerResult: number | null): string[] {
  const config = PERFORMANCE_GOALS[goal];
  const costText = costPerResult !== null ? formatCurrency(costPerResult) : "indisponível";
  return [`🎯 ${config.resultMetricLabel}: ${formatCount(resultCount)}`, `💲 ${config.costMetricShortLabel}: ${costText}`];
}

/** Pedido do usuário: "no caso das vendas, precisa colocar valor em
 * vendas e ROAS" — linhas extras, só pro objetivo "sales" e só quando há
 * faturamento registrado (nunca `R$0,00`/`0,00x` fabricado pra cliente
 * sem `value_column` configurado — `revenue`/`roas` chegam `null` nesse
 * caso, e as 2 linhas somem inteiras). Mesma lista de métricas, uma por
 * linha (pedido: "prefiro que fique em lista"). */
function formatSalesRevenueLines(goal: PerformanceGoal, revenue: number | null, roas: number | null): string[] {
  if (goal !== "sales" || revenue === null) return [];
  const roasText = roas !== null ? `${roas.toFixed(2)}x` : "indisponível";
  return [`💵 Valor em vendas: ${formatCurrency(revenue)}`, `📈 ROAS: ${roasText}`];
}

function formatAdNameWithFormat(adName: string, format: string | null): string {
  return format ? `${adName} (${format})` : adName;
}

/** Pedido do usuário: "consegue colocar o link do anúncio também? pra dar
 * pra ver qual é o melhor com CPA e melhor com CTR" — anexado ao fim da
 * linha, só quando o criativo tem um permalink registrado (enriquecimento
 * opcional, nunca fabricado — ver `AdHighlightEntry.permalinkUrl`). O
 * WhatsApp linkifica a URL sozinho, então basta colar o texto puro. */
function formatPermalinkSuffix(permalinkUrl: string | null): string {
  return permalinkUrl ? ` · ${permalinkUrl}` : "";
}

/** Linha(s) de destaque de anúncio — `null` quando NENHUM dos 2
 * indicadores tem anúncio elegível (pedido: omitir o bloco inteiro nesse
 * caso, nunca um "sem destaques disponíveis" fabricado). */
function formatHighlightLines(goal: PerformanceGoal, highlights: AdHighlights): string[] {
  const { bestCost, bestLinkCtr, combined } = highlights;
  if (!bestCost && !bestLinkCtr) return [];

  const costShortLabel = PERFORMANCE_GOALS[goal].costMetricShortLabel;

  if (combined && bestCost && bestLinkCtr) {
    const resultText = formatPerformanceResult(bestCost.resultCount, goal);
    return [
      `🏆👆 ${formatAdNameWithFormat(bestCost.adName, bestCost.format)}: melhor ${costShortLabel} (${resultText} a ${formatCurrency(bestCost.cost)}) e melhor CTR de link (${formatPercent(bestLinkCtr.linkCtr * 100)} em ${formatCount(bestLinkCtr.impressions)} impressões)${formatPermalinkSuffix(bestCost.permalinkUrl)}`,
    ];
  }

  const lines: string[] = [];
  if (bestCost) {
    const resultText = formatPerformanceResult(bestCost.resultCount, goal);
    lines.push(
      `🏆 Melhor ${costShortLabel}: ${formatAdNameWithFormat(bestCost.adName, bestCost.format)} · ${resultText} a ${formatCurrency(bestCost.cost)}${formatPermalinkSuffix(bestCost.permalinkUrl)}`,
    );
  }
  if (bestLinkCtr) {
    lines.push(
      `👆 Melhor CTR de link: ${formatAdNameWithFormat(bestLinkCtr.adName, bestLinkCtr.format)} · ${formatPercent(bestLinkCtr.linkCtr * 100)} em ${formatCount(bestLinkCtr.impressions)} impressões${formatPermalinkSuffix(bestLinkCtr.permalinkUrl)}`,
    );
  }
  return lines;
}

export interface ReportTemplateInput {
  clientName: string;
  periodKind: WeeklyReportPeriodKind;
  periodStart: string;
  periodEnd: string;
  goal: PerformanceGoal;
  investment: number;
  resultCount: number;
  costPerResult: number | null;
  /** Pedido do usuário: "no caso das vendas, precisa colocar valor em
   * vendas e ROAS" — ver `formatSalesRevenueLines`. */
  revenue: number | null;
  roas: number | null;
  highlights: AdHighlights;
  /** `null`/string vazia -> bloco "Próximo passo" omitido inteiramente
   * (pedido: "campo OPCIONAL... quando preenchido, inclua no texto"). */
  nextStep: string | null;
}

export function renderReportTemplate(input: ReportTemplateInput): string {
  const periodLabel = formatReportPeriodLabel(input.periodStart, input.periodEnd);
  // Pedido do usuário: "além da data em número, falar de segunda até
  // quinta e o outro sexta a domingo" — qualifica a data numérica, nunca
  // substitui.
  const weekdayRange = WEEKLY_REPORT_PERIOD_KIND_WEEKDAY_RANGE_LABEL[input.periodKind];

  const headerLines = [
    `*${input.clientName} | Resultados de ${weekdayRange} (${periodLabel})*`,
    `💰 Investimento: ${formatCurrency(input.investment)}`,
    ...formatHeadlineResultLines(input.goal, input.resultCount, input.costPerResult),
    ...formatSalesRevenueLines(input.goal, input.revenue, input.roas),
  ];

  const blocks: string[] = [headerLines.join("\n")];

  const highlightLines = formatHighlightLines(input.goal, input.highlights);
  if (highlightLines.length > 0) {
    blocks.push(["*Destaques dos anúncios*", ...highlightLines].join("\n"));
  }

  const nextStep = input.nextStep?.trim();
  if (nextStep) {
    blocks.push(`*Próximo passo:* ${nextStep}`);
  }

  return blocks.join("\n\n");
}

/**
 * "Editar texto" (pedido, seção 4: "salve as edições do gestor... preserve
 * edições manuais durante reprocessamentos") tem 2 campos — "Próximo
 * passo" (estruturado) e o texto final (textarea livre). Decide se o
 * gestor tocou a textarea: se ele deixou EXATAMENTE como veio (só mudou o
 * "Próximo passo"), a Server Action pode religar o novo próximo passo no
 * template sem perder nada; se ele mudou qualquer caractere do texto, a
 * palavra dele vale literal, nunca sobrescrita por uma re-geração.
 */
export function didGestorEditBodyTextVerbatim(currentBodyText: string, submittedBodyText: string): boolean {
  return currentBodyText !== submittedBodyText;
}
