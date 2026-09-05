import { formatCurrency } from "@/lib/format";
import type { CostComparison, PerformanceSummary } from "@/lib/performance";
import { PERFORMANCE_GOALS, formatPerformanceResult, type PerformanceGoal } from "@/lib/performance-goals";
import type { CampaignSummary } from "@/lib/campaign-analytics";

/** 1 casa decimal, separador pt-BR ("13,4", nunca "13.4" — `toFixed` usa
 * ponto, o exemplo do pedido é explícito com vírgula). Único formatador de
 * variação percentual desta camada — nunca um segundo `toFixed` espalhado. */
const variancePercentFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function formatVariancePercent(fraction: number): string {
  return `${variancePercentFormatter.format(Math.abs(fraction) * 100)}%`;
}

/**
 * Etapa "Otimização do Performance Report" — camada de LEITURA, nunca de
 * cálculo: todo número usado aqui já existe em `PerformanceSummary`
 * (`lib/performance.ts`, `compareCostToTarget`/`computeVariationFromTarget`,
 * as MESMAS funções canônicas usadas em Visão Geral/Sprints/Conquistas) ou
 * em `CampaignSummary` (`lib/campaign-analytics.ts`, já `totalInvestimento ÷
 * totalResultado` — nunca média de linhas). Nada aqui refaz agregação,
 * consulta dado novo, nem introduz uma segunda fórmula de custo/ROAS —
 * só formata/seleciona o que já foi calculado.
 */

/**
 * "Meta: R$ 30,00 · 13,4% acima da meta" — enriquece o texto padrão de meta
 * (já produzido por `buildAnalyticsKpiCards`) com a variação percentual,
 * reaproveitando `comparison` (já calculado por `compareCostToTarget` dentro
 * de `computePerformanceSummary`) — nunca uma segunda comparação. `null`
 * quando não há meta ou não há como comparar (mesmas regras de
 * `computeVariationFromTarget`: meta nula/zero ou custo indisponível).
 * Variação exatamente 0% vira "Na meta" (nem "acima" nem "abaixo" seria
 * impreciso pra uma igualdade exata).
 */
export function buildTargetVariationLabel(comparison: CostComparison, targetCostPerResult: number | null): string | null {
  if (targetCostPerResult === null || comparison.variation === null) return null;

  const metaLabel = `Meta: ${formatCurrency(targetCostPerResult)}`;
  if (comparison.variation === 0) return `${metaLabel} · Na meta`;

  const direction = comparison.variation > 0 ? "acima" : "abaixo";
  const percentLabel = `${formatVariancePercent(comparison.variation)} ${direction} da meta`;
  return `${metaLabel} · ${percentLabel}`;
}

/**
 * Leitura determinística do período — no máximo 3 frases curtas, cada uma
 * auditável a partir de números já exibidos no relatório (nunca texto livre/
 * IA generativa, nunca causalidade inventada: "campanha performou bem" não
 * é uma frase possível aqui, só fatos com número por trás).
 *
 * 1ª frase: sempre que houver objetivo com QUALQUER dado (mesmo
 * `resultCount === 0`) — volume + custo, ou leitura neutra se zero
 * resultados. 2ª frase: só quando há meta configurada E uma variação
 * calculável (`buildTargetVariationLabel`'s mesma regra). 3ª frase: só
 * quando existe pelo menos UMA campanha com resultado > 0 (mesmo piso de
 * "dados suficientes" de `findBestCostCampaign`, abaixo) — nunca aponta uma
 * "melhor campanha" sem pelo menos uma campanha realmente comparável.
 */
export function buildPeriodReading(input: {
  performanceGoal: PerformanceGoal;
  performanceSummary: PerformanceSummary;
  campaigns: CampaignSummary[];
}): string[] {
  const { performanceGoal, performanceSummary, campaigns } = input;
  const config = PERFORMANCE_GOALS[performanceGoal];
  const sentences: string[] = [];

  if (performanceSummary.resultCount === 0) {
    sentences.push(`Nenhum ${config.singularLabel.toLowerCase()} foi registrado no período.`);
    return sentences;
  }

  const resultLabel = formatPerformanceResult(performanceSummary.resultCount, performanceGoal);
  const costPart = performanceSummary.costPerResult !== null ? `, com ${config.costMetricShortLabel} de ${formatCurrency(performanceSummary.costPerResult)}` : "";
  sentences.push(`Foram registrados ${resultLabel}${costPart}.`);

  const variationLabel = buildTargetVariationSentence(performanceSummary.comparison, performanceSummary.targetCostPerResult);
  if (variationLabel) sentences.push(variationLabel);

  const bestCampaign = findBestCostCampaign(campaigns);
  if (bestCampaign && bestCampaign.cpa !== null) {
    sentences.push(`A campanha com melhor eficiência apresentou ${config.costMetricShortLabel} de ${formatCurrency(bestCampaign.cpa)}.`);
  }

  return sentences;
}

/** Frase (não rótulo de KPI) da variação vs. meta — mesmo cálculo de
 * `buildTargetVariationLabel`, só com redação em forma de frase pra
 * "Leitura do período" ("O custo ficou X% acima da meta de R$Y."). */
function buildTargetVariationSentence(comparison: CostComparison, targetCostPerResult: number | null): string | null {
  if (targetCostPerResult === null || comparison.variation === null) return null;

  const targetLabel = formatCurrency(targetCostPerResult);
  if (comparison.variation === 0) return `O custo ficou igual à meta de ${targetLabel}.`;

  const direction = comparison.variation > 0 ? "acima" : "abaixo";
  return `O custo ficou ${formatVariancePercent(comparison.variation)} ${direction} da meta de ${targetLabel}.`;
}

/**
 * Campanha de menor custo por resultado — só entre as com resultado > 0
 * (regra explícita: custo por zero resultados não é comparável). Empate
 * resolvido deterministicamente: menor custo primeiro, empate por MAIOR
 * volume de resultado (amostra mais confiável), empate final por nome em
 * ordem alfabética (pt-BR) — nunca a ordem de chegada do array.
 */
export function findBestCostCampaign(campaigns: CampaignSummary[]): CampaignSummary | null {
  const eligible = campaigns.filter((c) => c.totalResultCount !== null && c.totalResultCount > 0 && c.cpa !== null);
  if (eligible.length === 0) return null;

  return [...eligible].sort((a, b) => {
    if (a.cpa! !== b.cpa!) return a.cpa! - b.cpa!;
    if (b.totalResultCount! !== a.totalResultCount!) return b.totalResultCount! - a.totalResultCount!;
    return a.campaignName.localeCompare(b.campaignName, "pt-BR");
  })[0];
}

/** Campanha de maior volume de resultado — só entre as com resultado > 0
 * (volume zero não é "maior volume" de nada). Mesmo critério de desempate
 * de `findBestCostCampaign`, na ordem inversa de prioridade (volume
 * primeiro, depois menor custo, depois nome). */
export function findHighestVolumeCampaign(campaigns: CampaignSummary[]): CampaignSummary | null {
  const eligible = campaigns.filter((c) => c.totalResultCount !== null && c.totalResultCount > 0);
  if (eligible.length === 0) return null;

  return [...eligible].sort((a, b) => {
    if (b.totalResultCount! !== a.totalResultCount!) return b.totalResultCount! - a.totalResultCount!;
    const aCpa = a.cpa ?? Number.POSITIVE_INFINITY;
    const bCpa = b.cpa ?? Number.POSITIVE_INFINITY;
    if (aCpa !== bCpa) return aCpa - bCpa;
    return a.campaignName.localeCompare(b.campaignName, "pt-BR");
  })[0];
}

/**
 * Campanha está acima/abaixo da meta? Comparação DIRETA (`cpa > target` /
 * `cpa < target`), deliberadamente SEM a margem de ±10% de
 * `getPerformanceStatus` (`lib/performance.ts`) — aquela função responde
 * "esse custo está dentro de uma faixa aceitável?" (usada em Visão Geral/
 * Sprints), esta responde a pergunta mais simples que os badges pedem:
 * "esse número específico está acima ou abaixo da meta?". Nunca reaproveitar
 * a margem de uma resposta pra outra pergunta. Sem meta ou sem custo → sem
 * badge (`null`), nunca um badge de meta "chutado".
 */
export function resolveCampaignTargetBadge(cpa: number | null, targetCostPerResult: number | null): "above" | "below" | null {
  if (cpa === null || targetCostPerResult === null || targetCostPerResult <= 0) return null;
  if (cpa > targetCostPerResult) return "above";
  if (cpa < targetCostPerResult) return "below";
  return null;
}

/**
 * Badges de UMA campanha — no máximo 1 badge "global" (Melhor custo OU
 * Maior volume; uma campanha pode teoricamente ganhar as duas, caso raro) +
 * no máximo 1 badge de meta (Acima/Abaixo). Nunca altera `sort`/métricas —
 * puramente rótulos anexados à linha já pronta. `bestCostCampaign`/
 * `highestVolumeCampaign` comparados por IDENTIDADE (mesmo objeto,
 * `campaignName` + `channel`) — nunca por posição no array.
 */
export function buildCampaignBadges(
  campaign: CampaignSummary,
  bestCostCampaign: CampaignSummary | null,
  highestVolumeCampaign: CampaignSummary | null,
  targetCostPerResult: number | null,
): string[] {
  const badges: string[] = [];
  const isSameCampaign = (other: CampaignSummary | null) => other !== null && other.channel === campaign.channel && other.campaignName === campaign.campaignName;

  if (isSameCampaign(bestCostCampaign)) badges.push("Melhor custo");
  if (isSameCampaign(highestVolumeCampaign)) badges.push("Maior volume");

  const targetBadge = resolveCampaignTargetBadge(campaign.cpa, targetCostPerResult);
  if (targetBadge === "above") badges.push("Acima da meta");
  if (targetBadge === "below") badges.push("Abaixo da meta");

  return badges;
}
