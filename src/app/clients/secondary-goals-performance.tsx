import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { formatCurrency } from "@/lib/format";
import { describeGoalCostUnavailableReason } from "@/lib/goal-spend";
import type { SecondaryGoalPerformanceView } from "@/lib/secondary-goal-performance";

/**
 * Bloco ADICIONAL de Performance pra objetivos SECUNDÁRIOS (Etapa
 * "Múltiplos Objetivos", seção 27/28) — deliberadamente um componente
 * separado, renderizado ao lado de `AccountFollowUpPanel` (que continua
 * cuidando só do objetivo principal, intocado). Nunca reorganiza a página —
 * só aparece quando o cliente tem mais de 1 objetivo, e some sozinho quando
 * não tem (nenhum espaço vazio reservado). A rodada de simplificação da
 * página do cliente fica pra uma etapa própria, futura.
 */
export function SecondaryGoalsPerformance({ goals }: { goals: SecondaryGoalPerformanceView[] }) {
  if (goals.length === 0) return null;

  return (
    <div className="mt-3 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Outros objetivos</h3>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {goals.map((goal) => {
          const config = PERFORMANCE_GOALS[goal.resultType];
          const pct = goal.targetResultCount && goal.targetResultCount > 0 ? Math.round((goal.resultCount / goal.targetResultCount) * 100) : null;
          const unavailableText = describeGoalCostUnavailableReason(goal.costUnavailableReason);

          return (
            <div key={goal.resultType} className="rounded-lg border border-border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{config.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                {goal.resultCount}
                {goal.targetResultCount !== null && <span className="text-sm font-normal text-muted-foreground"> / {goal.targetResultCount}</span>}
              </p>
              {pct !== null && <p className="text-xs text-muted-foreground">{pct}% da meta</p>}

              <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-border pt-2">
                <span className="text-[11px] text-muted-foreground">{config.costMetricShortLabel}</span>
                <span className="text-sm font-medium tabular-nums text-foreground">
                  {goal.costPerResult !== null ? formatCurrency(goal.costPerResult) : "Indisponível"}
                </span>
              </div>
              {goal.costPerResult === null && unavailableText && <p className="mt-0.5 text-[11px] text-muted-foreground">{unavailableText}</p>}

              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">Investimento (campanhas classificadas)</span>
                <span className="text-sm tabular-nums text-foreground">{formatCurrency(goal.goalSpend)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
