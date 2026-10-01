import { evaluateInvestmentDiagnostic, evaluateCpaDiagnostic, metricToneSeverityRank, type MetricTone } from "@/lib/metric-diagnostics";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";

const TONE_LABEL: Record<MetricTone, string> = {
  critical: "FORA DO ESPERADO",
  attention: "ATENÇÃO",
  normal: "DENTRO DO ESPERADO",
};

const TONE_CLASSES: Record<MetricTone, string> = {
  critical: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  attention: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  normal: "border-overview-border bg-overview-surface-subtle text-overview-text-secondary",
};

function formatDeviationPct(deviationPct: number): string {
  return `${Math.round(Math.abs(deviationPct) * 100)}%`;
}

interface DiagnosticCandidate {
  tone: MetricTone;
  message: string;
}

/**
 * Card de diagnóstico da Performance (Etapa "Primeira Rodada Visual —
 * Contexto + Performance", seções 10/12 do pedido) — usa SÓ
 * `metric-diagnostics.ts` (`evaluateInvestmentDiagnostic`/
 * `evaluateCpaDiagnostic`), nenhum motor novo. Deliberadamente NÃO usa
 * `account-health-engine.ts` (o motor que já alimenta "Saúde" no resumo de
 * Operação) — pedido explícito: as duas camadas continuam paralelas nesta
 * rodada, unificá-las é decisão de uma etapa futura.
 *
 * Dois eixos avaliados, cada um só entra na lista de candidatos quando tem
 * base real de comparação (`expected !== null` — a mesma regra que os dois
 * `evaluate*` já aplicam: "nunca inventa desvio sem uma base real"):
 * Investimento (sempre que há planejamento mensal configurado) e Custo por
 * resultado (sempre que há objetivo + meta de custo configurados — rótulo
 * goal-aware via `PERFORMANCE_GOALS`, nunca hardcoded "CPL"/"CPA").
 *
 * Sem nenhum candidato com base (cliente sem planejamento E sem meta de
 * custo), o componente não renderiza nada — nunca um card vazio/genérico.
 * Com mais de um candidato ativo, mostra o mais severo
 * (`metricToneSeverityRank`, já existente); Investimento desempata em caso
 * de empate de severidade (ordem de avaliação, decisão simples e
 * determinística, não uma prioridade de negócio formal).
 */
export function PerformanceDiagnosticCard({
  performanceGoal,
  actualSpend,
  expectedToDate,
  costPerResult,
  targetCostPerResult,
  resultCount,
}: {
  performanceGoal: PerformanceGoal | null;
  /** Investimento realizado já escopado (mês + canal selecionados) — mesmo
   * valor que alimenta o KPI "Investimento" e a barra de Ritmo. */
  actualSpend: number;
  /** `computeMonthlyExpectedToDateByCalendar` do investimento planejado —
   * `null` sem planejamento configurado pro escopo em exibição. */
  expectedToDate: number | null;
  /** `performanceSummary.costPerResult` — mesmo valor do KPI "Custo por
   * resultado". */
  costPerResult: number | null;
  targetCostPerResult: number | null;
  resultCount: number;
}) {
  const investmentDiag = evaluateInvestmentDiagnostic(actualSpend, expectedToDate);
  const costDiag = performanceGoal ? evaluateCpaDiagnostic(costPerResult, targetCostPerResult, resultCount) : null;
  const costLabel = performanceGoal ? PERFORMANCE_GOALS[performanceGoal].costMetricShortLabel : "Custo por resultado";

  const candidates: DiagnosticCandidate[] = [];

  if (investmentDiag.expected !== null) {
    candidates.push({
      tone: investmentDiag.tone,
      message:
        investmentDiag.tone === "normal"
          ? "Investimento está seguindo o ritmo necessário para o mês."
          : `Investimento está ${formatDeviationPct(investmentDiag.deviationPct ?? 0)} ${
              investmentDiag.direction === "up" ? "acima" : "abaixo"
            } do ritmo esperado no mês.`,
    });
  }

  if (costDiag && costDiag.expected !== null) {
    candidates.push({
      tone: costDiag.tone,
      message:
        costDiag.tone === "normal"
          ? `${costLabel} está dentro do planejado no mês.`
          : `${costLabel} está ${formatDeviationPct(costDiag.deviationPct ?? 0)} acima do planejado no mês.`,
    });
  }

  if (candidates.length === 0) return null;

  const chosen = candidates.reduce((worst, candidate) => (metricToneSeverityRank(candidate.tone) < metricToneSeverityRank(worst.tone) ? candidate : worst));

  return (
    <div className={`mt-3 rounded-md border px-3 py-2 ${TONE_CLASSES[chosen.tone]}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide">{TONE_LABEL[chosen.tone]}</p>
      <p className="mt-0.5 text-sm">{chosen.message}</p>
    </div>
  );
}
