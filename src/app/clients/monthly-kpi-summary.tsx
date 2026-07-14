import Link from "next/link";
import type { PerformanceSummary } from "@/lib/performance";
import { deriveMonthlyKpiTexts, getLatestPerformanceUpdateText } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { formatCurrency, formatShortDateTime } from "@/lib/format";

function Kpi({ label, value, auxiliary }: { label: string; value: string; auxiliary?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-base font-semibold text-foreground">{value}</p>
      {auxiliary && <p className="text-xs text-muted-foreground">{auxiliary}</p>}
    </div>
  );
}

/**
 * "Principais KPIs do mês" — abre o Acompanhamento da Conta (refinamento
 * visual, não altera nenhum cálculo): investimento/resultados/custo por
 * resultado sempre vêm já calculados (`monthActual`/`monthPerformanceSummary`
 * da própria página); os textos de resultado/custo vêm de
 * `deriveMonthlyKpiTexts` (lib/performance.ts), central e testável — nunca
 * recomputados aqui. Único lugar da página onde esses 3 números aparecem
 * juntos — a seção "Performance do mês" (mais abaixo) guarda só as
 * informações secundárias (meta, comparação, canais) pra nunca duplicar os
 * mesmos 3 KPIs em dois lugares consecutivos.
 */
export function MonthlyKpiSummary({
  monthActual,
  performanceGoal,
  performanceSummary,
  configureObjectiveHref,
}: {
  monthActual: number;
  performanceGoal: PerformanceGoal | null;
  /** `null` só quando `performanceGoal` também é `null`. */
  performanceSummary: PerformanceSummary | null;
  configureObjectiveHref: string;
}) {
  const { resultsValue, resultsAuxiliary, costValue } = deriveMonthlyKpiTexts(
    performanceGoal,
    performanceSummary,
    formatCurrency,
  );
  const updateText =
    performanceGoal && performanceSummary
      ? getLatestPerformanceUpdateText(performanceSummary.latestSource, performanceSummary.latestUpdatedAt, formatShortDateTime)
      : null;

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Principais KPIs do mês</p>
      <div className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Kpi label="Investimento total" value={formatCurrency(monthActual)} />
        <Kpi label="Resultados" value={resultsValue} auxiliary={resultsAuxiliary} />
        <Kpi label="Custo por resultado" value={costValue} />
      </div>
      {!performanceGoal && (
        <Link href={configureObjectiveHref} className="mt-1 inline-block text-xs font-medium text-brand hover:underline">
          Configurar objetivo
        </Link>
      )}
      {updateText && <p className="mt-1.5 text-[11px] text-muted-foreground">{updateText}</p>}
    </div>
  );
}
