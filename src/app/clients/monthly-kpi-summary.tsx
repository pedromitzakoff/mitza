import Link from "next/link";
import type { PerformanceSummary } from "@/lib/performance";
import { deriveMonthlyKpiTexts } from "@/lib/performance";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { formatCurrency, formatCount } from "@/lib/format";

function Kpi({ label, value, auxiliary }: { label: string; value: string; auxiliary?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">{label}</p>
      <p className="text-xl font-semibold tracking-tight text-overview-text-primary tabular-nums">{value}</p>
      {/* Linha reservada mesmo vazia: nem todo Kpi tem auxiliar, mas os que
          estão na mesma linha precisam da mesma altura pra não ficar com a
          base desalinhada. */}
      <p className="min-h-[1em] text-xs text-overview-text-secondary">{auxiliary}</p>
    </div>
  );
}

/**
 * "Resultado / Investimento / Custo por resultado" — Etapa "Revisão
 * Performance — Visão Geral do cliente": os 3 (ou 5, com Faturamento/ROAS
 * quando aplicável) KPIs do topo são o mesmo nível hierárquico — nenhum
 * "hero" tipográfico distinto de antes (a etapa anterior deu destaque de
 * hero só ao Resultado; esta etapa reconhece que isso competia com a nova
 * seção "Ritmo do mês" logo abaixo, que já é o lugar de destaque pro
 * avanço do mês). Cada KPI responde só "o que aconteceu?": valor +
 * referência estática (Meta/Planejado) como texto secundário — nunca mais
 * a comparação de ritmo, que migrou inteira pra "Ritmo do mês"
 * (`AccountFollowUpPanel`).
 *
 * A meta de custo por resultado deixou de ser um selo verde-limão
 * ("Meta é referência, não status" — pedido explícito): vira texto
 * secundário simples, mesmo tratamento visual de "Meta 100"/"Planejado
 * R$X" nos outros dois KPIs — lime fica reservado pra status real (ex.:
 * "dentro da meta" no Relatório de Performance), nunca uma referência
 * estática. Nenhum cálculo muda: todos os números sempre vêm já calculados
 * (`monthActual`/`performanceSummary`/`targetCostPerResult`/
 * `targetResultCount`/`investmentPlanned` da própria página); os textos de
 * resultado/custo vêm de `deriveMonthlyKpiTexts` (lib/performance.ts),
 * central e testável — nunca recomputados aqui.
 */
export function MonthlyKpiSummary({
  monthActual,
  performanceGoal,
  performanceSummary,
  targetCostPerResult,
  targetResultCount,
  investmentPlanned,
  configureObjectiveHref,
}: {
  monthActual: number;
  performanceGoal: PerformanceGoal | null;
  /** `null` só quando `performanceGoal` também é `null`. */
  performanceSummary: PerformanceSummary | null;
  /** Meta de custo por resultado vigente — `null` quando não configurada. */
  targetCostPerResult: number | null;
  /** Meta de QUANTIDADE de resultado vigente pro mês — `null`/`undefined`
   * ou <= 0 quando não configurada (mesmo dado já usado por
   * `MonthlyGoalProgress`, nenhum cálculo novo). */
  targetResultCount?: number | null;
  /** Orçamento mensal vigente (`resolveMonthlyBudget`) — mesmo valor já
   * usado por `MonthInvestmentSummary`/`MonthInvestmentActions`, nenhum
   * cálculo novo. <= 0 = sem planejamento configurado. */
  investmentPlanned: number;
  configureObjectiveHref: string;
}) {
  const { resultsAuxiliary, costValue } = deriveMonthlyKpiTexts(performanceGoal, performanceSummary, formatCurrency);

  const hasResult = performanceGoal !== null && performanceSummary !== null && performanceSummary.hasAnyRecord;
  const resultValue = hasResult ? formatCount(performanceSummary.resultCount) : "—";
  const resultLabel = performanceGoal ? PERFORMANCE_GOALS[performanceGoal].resultMetricLabel : "Resultados";
  // `resultsAuxiliary` cobre os estados de exceção de sempre ("Objetivo não
  // configurado"/"Sem dados registrados"/"Nenhum resultado gerado no
  // período", `deriveMonthlyKpiTexts`) — só quando nenhum deles se aplica é
  // que a meta de quantidade vira o auxiliar ("Meta 100"), mesmo dado que
  // `MonthlyGoalProgress`/"Ritmo do mês" já usa.
  const resultAuxiliary =
    resultsAuxiliary ?? (targetResultCount != null && targetResultCount > 0 ? `Meta ${formatCount(targetResultCount)}` : null);

  const investmentAuxiliary = investmentPlanned > 0 ? `Planejado ${formatCurrency(investmentPlanned)}` : "Nenhum planejamento configurado";

  const costAuxiliary = targetCostPerResult !== null ? `Meta ${formatCurrency(targetCostPerResult)}` : null;

  // Faturamento/ROAS — Etapa "Receita e ROAS": linha auxiliar, nunca
  // renderizada quando `revenue` é null (cliente sem objetivo de vendas, ou
  // sem `value_column` configurado na integração) — nenhuma checagem de
  // `performanceGoal === "sales"` aqui, a ausência de `revenue` já resolve
  // isso sozinha.
  const revenue = performanceSummary?.revenue ?? null;
  const roas = performanceSummary?.roas ?? null;
  const hasRevenue = revenue !== null;
  const revenueValue = revenue !== null ? formatCurrency(revenue) : "—";
  const roasValue = roas !== null ? `${roas.toFixed(1)}x` : "—";

  return (
    <div>
      {/* Etapa "Facelift Visual — Visão Geral do cliente": gap-x-6 (era
          gap-x-8) — Resultado/Investimento/Custo por resultado ficavam
          "ilhas" distantes demais numa tela larga; o container mais
          estreito (`[id]/page.tsx`, max-w-5xl) já ajuda, este gap menor
          termina o ajuste sem mudar o grid/breakpoints/valores. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-x-6 gap-y-4">
        <Kpi label={resultLabel} value={resultValue} auxiliary={resultAuxiliary} />
        <Kpi label="Investimento" value={formatCurrency(monthActual)} auxiliary={investmentAuxiliary} />
        <Kpi label="Custo por resultado" value={costValue} auxiliary={costAuxiliary} />
        {hasRevenue && <Kpi label="Faturamento" value={revenueValue} />}
        {hasRevenue && <Kpi label="ROAS" value={roasValue} />}
      </div>
      {!performanceGoal && (
        <Link href={configureObjectiveHref} className="mt-2 inline-block text-xs font-medium text-brand hover:underline">
          Configurar objetivo
        </Link>
      )}
    </div>
  );
}
