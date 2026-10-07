import Link from "next/link";
import type { PerformanceSummary } from "@/lib/performance";
import { deriveMonthlyKpiTexts } from "@/lib/performance";
import { formatCurrency } from "@/lib/format";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import type { ClientGoal } from "@/lib/client-goals";
import { Kpi } from "./monthly-kpi-summary";

/**
 * Bloco "META ADS"/"GOOGLE ADS" do Dashboard (Etapa "Evolução do Dashboard
 * — Visão Simultânea de Canais", seções 9/10 do pedido) — Investimento/
 * Resultado/Custo por resultado de UM canal, sempre no objetivo que
 * REALMENTE pertence a ele (`resolveChannelGoal`, `lib/client-goals.ts`),
 * nunca o objetivo de outro canal nem um agregado entre os dois. Mesmo
 * `Kpi`/`deriveMonthlyKpiTexts` que `MonthlyKpiSummary` já usa — nenhum
 * cálculo novo, só uma segunda renderização lado a lado em vez de um
 * seletor de canal único.
 *
 * `goal: null` (nenhum objetivo configurado reivindica este canal) mostra
 * só Investimento + um link "Configurar objetivo", mesmo estado que
 * `MonthlyKpiSummary` já trata pra `performanceGoal: null` — nunca um
 * card vazio sem explicação.
 */
export function DashboardChannelSection({
  channel,
  goal,
  actualSpend,
  planned,
  performanceSummary,
  targetCostPerResult,
  targetResultCount,
  configureObjectiveHref,
}: {
  channel: TrafficChannel;
  goal: ClientGoal | null;
  /** Investimento REALIZADO deste canal no mês — nunca o consolidado do
   * cliente (seção 10: "não usar resultado agregado do cliente dentro do
   * card Google"). */
  actualSpend: number;
  /** Investimento PLANEJADO vigente deste canal — `null` quando o canal
   * ainda não tem plano próprio definido (nunca estimado/dividido do total,
   * seção 15 do pedido). */
  planned: number | null;
  performanceSummary: PerformanceSummary | null;
  targetCostPerResult: number | null;
  targetResultCount?: number | null;
  configureObjectiveHref: string;
}) {
  const performanceGoal = goal?.resultType ?? null;
  const { resultsValue, resultsAuxiliary, costValue } = deriveMonthlyKpiTexts(performanceGoal, performanceSummary, formatCurrency);

  const resultLabel = performanceGoal ? PERFORMANCE_GOALS[performanceGoal].resultMetricLabel : "Resultado";
  const resultAuxiliary = resultsAuxiliary ?? (targetResultCount != null && targetResultCount > 0 ? `Meta ${targetResultCount}` : null);

  const investmentAuxiliary = planned != null && planned > 0 ? `Planejado ${formatCurrency(planned)}` : "Sem plano por canal";
  const costAuxiliary = targetCostPerResult !== null ? `Meta ${formatCurrency(targetCostPerResult)}` : null;

  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">{TRAFFIC_CHANNELS[channel].label}</h2>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
        <Kpi label="Investimento" value={formatCurrency(actualSpend)} auxiliary={investmentAuxiliary} />
        <Kpi label={resultLabel} value={resultsValue} auxiliary={resultAuxiliary} />
        <Kpi label="Custo por resultado" value={costValue} auxiliary={costAuxiliary} />
      </div>
      {!performanceGoal && (
        <Link href={configureObjectiveHref} className="mt-2 inline-block text-xs font-medium text-brand hover:underline">
          Configurar objetivo
        </Link>
      )}
    </div>
  );
}
