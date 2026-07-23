import Link from "next/link";
import type { PerformanceSummary } from "@/lib/performance";
import { deriveMonthlyKpiTexts, getLatestPerformanceUpdateText } from "@/lib/performance";
import { evaluateCpaDiagnostic, METRIC_DEVIATION_ATTENTION_THRESHOLD } from "@/lib/metric-diagnostics";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { formatCurrency, formatPercent, formatShortDateTime } from "@/lib/format";

function Kpi({ label, value, auxiliary }: { label: string; value: string; auxiliary?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tracking-tight text-foreground">{value}</p>
      {auxiliary && <p className="text-xs text-muted-foreground">{auxiliary}</p>}
    </div>
  );
}

/**
 * Investimento/resultados/custo por resultado/meta — abre a página do
 * cliente (Etapa 75: sem o rótulo "Principais KPIs do mês" acima, o card
 * começa direto pelas métricas). Nenhum cálculo muda: os 4 números sempre
 * vêm já calculados (`monthActual`/`monthPerformanceSummary`/
 * `targetCostPerResult` da própria página); os textos de resultado/custo
 * vêm de `deriveMonthlyKpiTexts` (lib/performance.ts), central e testável —
 * nunca recomputados aqui.
 *
 * Etapa "Meta entra no card principal": a Meta deixou de ser uma seção
 * própria ("Performance do mês", removida) e virou a 4ª métrica, com o
 * mesmo peso visual das outras 3 — ela é só mais um dado usado pra
 * interpretar o CPA/CPL, não um fluxo separado. A comparação entre custo
 * atual e meta vira uma única linha de diagnóstico logo abaixo da grade,
 * derivada de `evaluateCpaDiagnostic` (Motor de Diagnóstico Único,
 * `lib/metric-diagnostics.ts`) — nunca um cálculo próprio: `deviationPct`/
 * `direction` são os MESMOS números que o Core já resolveu, só reaproveitados
 * com uma leitura diferente do `tone`.
 *
 * Distinção deliberada (pedido explícito): esta linha é INFORMATIVA, não
 * participa do sistema de priorização/alertas do Workspace — por isso ela
 * mostra percentual tanto acima quanto abaixo da meta (usando o mesmo limiar
 * `METRIC_DEVIATION_ATTENTION_THRESHOLD`, 10%, só pra decidir quando é
 * "Dentro da meta"), mesmo sabendo que `evaluateCpaDiagnostic` nunca marca
 * "abaixo da meta" como fora do esperado (`tone`/`isOutOfRange`, usados só
 * pra filtros/alertas em outras telas, continuam ignorando essa direção —
 * nenhuma tela de priorização passa a contar "abaixo da meta" como
 * pendência por causa desta linha).
 */
export function MonthlyKpiSummary({
  monthActual,
  performanceGoal,
  performanceSummary,
  targetCostPerResult,
  configureObjectiveHref,
}: {
  monthActual: number;
  performanceGoal: PerformanceGoal | null;
  /** `null` só quando `performanceGoal` também é `null`. */
  performanceSummary: PerformanceSummary | null;
  /** Meta de custo por resultado vigente — `null` quando não configurada. */
  targetCostPerResult: number | null;
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

  const metaValue = targetCostPerResult !== null ? formatCurrency(targetCostPerResult) : "—";
  const costDiagnostic = evaluateCpaDiagnostic(performanceSummary?.costPerResult ?? null, targetCostPerResult);
  // `deviationPct === null` cobre tanto "sem meta configurada" quanto "sem
  // custo disponível ainda" (evaluateCpaDiagnostic já não devolve um desvio
  // fabricado nesses casos) — a linha de diagnóstico simplesmente não
  // aparece, nunca um "Dentro da meta" enganoso sem base de comparação.
  const diagnosticText =
    costDiagnostic && costDiagnostic.deviationPct !== null
      ? Math.abs(costDiagnostic.deviationPct) <= METRIC_DEVIATION_ATTENTION_THRESHOLD
        ? "Dentro da meta"
        : `${formatPercent(Math.abs(costDiagnostic.deviationPct) * 100)} ${costDiagnostic.direction === "up" ? "acima" : "abaixo"} da meta`
      : null;
  // A cor continua vindo só do `tone` de alerta do Core (nunca um esquema
  // novo pra esta linha): "abaixo da meta" nunca é colorida como
  // atenção/crítico (custo abaixo da meta nunca é um problema, por maior
  // que seja o percentual) — fica neutra, igual "Dentro da meta".
  const diagnosticToneClass =
    costDiagnostic?.tone === "critical"
      ? "text-red-600 dark:text-red-400"
      : costDiagnostic?.tone === "attention"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Kpi label="Investimento total" value={formatCurrency(monthActual)} />
        <Kpi label="Resultados" value={resultsValue} auxiliary={resultsAuxiliary} />
        <Kpi label="Custo por resultado" value={costValue} />
        <Kpi label="Meta" value={metaValue} />
      </div>
      {diagnosticText && <p className={`mt-1.5 text-xs font-medium ${diagnosticToneClass}`}>{diagnosticText}</p>}
      {!performanceGoal && (
        <Link href={configureObjectiveHref} className="mt-1 inline-block text-xs font-medium text-brand hover:underline">
          Configurar objetivo
        </Link>
      )}
      {updateText && <p className="mt-1.5 text-[11px] text-muted-foreground">{updateText}</p>}
    </div>
  );
}
