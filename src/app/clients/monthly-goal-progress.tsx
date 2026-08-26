import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { computeDailyResultStats, type DailyResultSeries } from "@/lib/daily-results";
import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import { formatRitmoDiffText, type FinancialPeriodSummary } from "@/lib/financial-period";

/** "1.386"/"22,7" — mesma régua de sempre pra contagem de resultado (ver
 * `daily-results-evolution.tsx`, de onde esta linha "realizado/meta" foi
 * migrada): no máximo 1 casa decimal, vírgula pt-BR, sem casa decimal
 * fabricada num valor inteiro. */
function formatCount(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/** Cor do texto de ritmo — pra INVESTIMENTO "acima" é ruim (gastou mais que
 * o planejado, ver `MonthInvestmentSummary`), mas pra RESULTADO "acima" é
 * bom (mais resultado que o esperado): por isso este mapa é o inverso
 * daquele, nunca a mesma constante reaproveitada às cegas. */
const RITMO_TONE_CLASSES: Partial<Record<SpendStatus, string>> = {
  acima: "text-green-600 dark:text-green-400",
  dentro: "text-green-600 dark:text-green-400",
  abaixo: "text-amber-600 dark:text-amber-400",
};

/**
 * "Meta mensal" — Etapa "Visão Geral: decisão em 5 segundos". Substitui a
 * antiga "Evolução diária de resultados" (gráfico de 7 barras) nesta tela:
 * aquela granularidade dia a dia é informação de INVESTIGAÇÃO e continua
 * disponível, com mais profundidade (hover, tendência), no Analytics
 * (`AnalyticsTrendChart`) — nunca removida do produto, só reposicionada.
 * Aqui a pergunta é outra, de DECISÃO: quanto já foi feito, qual a meta, que
 * % isso representa e se o ritmo está adequado pra bater a meta do mês.
 *
 * Ritmo reaproveita 100% a régua central já usada pro investimento
 * (`classifySpendStatus` + `formatRitmoDiffText`, de `spend-status.ts`/
 * `financial-period.ts`) — nenhuma segunda fórmula de "está no ritmo"
 * inventada aqui só porque a unidade agora é "resultado" em vez de "R$".
 * `FinancialPeriodSummary` é preenchido com campos vazios/zerados nos que
 * essas duas funções não usam (`label`/`startDate`/`endDate`) — não existe
 * "período" real aqui, só a mesma matemática de planejado/realizado/esperado.
 */
export function MonthlyGoalProgress({
  goal,
  monthResultCount,
  targetResultCount,
  expectedToDate,
  series,
}: {
  goal: PerformanceGoal;
  monthResultCount: number;
  /** Sempre > 0 — quem chama só renderiza este componente com meta de
   * quantidade configurada pro mês (nunca "0/0" ou "X/undefined"). */
  targetResultCount: number;
  expectedToDate: number;
  /** Série dos últimos 7 dias, só pra "Média 7d" — `undefined`/`unavailable`
   * = linha omitida (mesmo gate de sempre: nunca uma média fabricada sem
   * dado real por trás). */
  series?: DailyResultSeries;
}) {
  const config = PERFORMANCE_GOALS[goal];
  const pct = Math.round((monthResultCount / targetResultCount) * 100);
  const barPct = Math.min(100, Math.max(0, pct));

  const status = classifySpendStatus(monthResultCount, expectedToDate, targetResultCount);
  const ritmoSummary: FinancialPeriodSummary = {
    kind: "month",
    label: "",
    startDate: "",
    endDate: "",
    planned: targetResultCount,
    actual: monthResultCount,
    expectedToDate,
    pct: (monthResultCount / targetResultCount) * 100,
    status,
  };
  const ritmoText = formatRitmoDiffText(ritmoSummary);

  const average7d = series?.kind === "available" ? computeDailyResultStats(series.points).average7d : null;

  return (
    <div className="mt-3 border-t border-overview-border pt-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-overview-text-muted">Meta mensal</p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-sm text-overview-text-secondary">
          <span className="font-semibold text-overview-text-primary">
            {formatCount(monthResultCount)}/{formatCount(targetResultCount)}
          </span>{" "}
          {config.pluralLabel.toLowerCase()}
        </p>
        <p className="text-sm font-semibold text-overview-text-primary">{pct}%</p>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-overview-brand-subtle">
        <div className="h-full rounded-full bg-brand" style={{ width: `${barPct}%` }} />
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-overview-text-secondary">
        {ritmoText && <span className={`font-medium ${RITMO_TONE_CLASSES[status] ?? ""}`}>{ritmoText}</span>}
        <span>Esperado até hoje: {formatCount(expectedToDate)}</span>
        {average7d !== null && <span>Média 7d: {formatCount(average7d)}/dia</span>}
      </p>
    </div>
  );
}
