import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import type { FinancialPeriodSummary } from "@/lib/financial-period";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { classifySpendStatus, RITMO_STATUS_TEXT, type SpendStatus } from "@/lib/spend-status";

/** "883"/"1.000"/"839" — contagem de resultado sempre arredondada pra
 * inteiro nesta tela (Etapa "Visão Geral: decisão em 5 segundos", 2ª
 * rodada: "838,7" vira "839" — precisão de casa decimal é detalhe de
 * investigação, não de decisão rápida). Nenhum valor real muda, só a
 * apresentação: `expectedToDate` continua a mesma conta de sempre
 * (`computeMonthlyExpectedToDateByCalendar`), só arredondada aqui. */
function formatCount(value: number): string {
  return Math.round(value).toLocaleString("pt-BR");
}

/** Cor do texto/bolinha de ritmo — pra INVESTIMENTO "acima" é ruim (gastou
 * mais que o planejado, ver `MonthInvestmentSummary`), mas pra RESULTADO
 * "acima" é bom (mais resultado que o esperado): por isso este mapa é o
 * inverso daquele, nunca a mesma constante reaproveitada às cegas. */
const RITMO_TONE_CLASSES: Partial<Record<SpendStatus, string>> = {
  acima: "text-green-600 dark:text-green-400",
  dentro: "text-green-600 dark:text-green-400",
  abaixo: "text-amber-600 dark:text-amber-400",
};

/**
 * "Performance" — Etapa "Visão Geral: decisão em 5 segundos". Substitui a
 * antiga "Evolução diária de resultados" (gráfico de 7 barras) nesta tela:
 * aquela granularidade dia a dia é informação de INVESTIGAÇÃO e continua
 * disponível, com mais profundidade (hover, tendência), no Analytics
 * (`AnalyticsTrendChart`) — nunca removida do produto, só reposicionada.
 * Aqui a pergunta é outra, de DECISÃO: quanto já foi feito, qual a meta, que
 * % isso representa e se o ritmo está adequado pra bater a meta do mês.
 *
 * A CLASSIFICAÇÃO de ritmo reaproveita 100% a régua central já usada pro
 * investimento (`classifySpendStatus`, de `spend-status.ts`, mesma margem de
 * ±20%) — nenhuma segunda fórmula de "está no ritmo" inventada aqui só
 * porque a unidade agora é "resultado" em vez de "R$".
 *
 * Etapa "Simetria Performance x Investimento": este card e
 * `MonthInvestmentSummary` (Investimento) precisam ser um PAR ESPELHADO —
 * mesma anatomia, mesma barra, mesmo texto de status, mesma altura
 * aproximada — pedido explícito do usuário, "hoje parecem dois componentes
 * diferentes colocados lado a lado". Por isso:
 * - a barra deixou de ser uma implementação própria (2 `<div>`s, `h-1.5`,
 *   sem marcador) e passou a usar a MESMA `AgencyInvestmentBar` que
 *   Investimento já usa — mesma espessura, raio, cor de preenchimento e,
 *   quando há "esperado até hoje" (sempre há, aqui), o mesmo marcador
 *   vertical com label próprio (nunca mais uma legenda solta "Realizado |
 *   Esperado hoje" — o marcador já se explica). `formatValue={formatCount}`
 *   faz o tooltip do marcador mostrar contagem, nunca "R$"; `overflowIsPositive`
 *   garante que passar de 100% da meta nunca vira vermelho (diferente de
 *   estourar o orçamento) — ver `agency-investment-bar.tsx`.
 * - o texto de status (`RITMO_STATUS_TEXT`, compartilhado com Investimento)
 *   e a linha secundária ("Esperado hoje: X") viraram duas linhas
 *   empilhadas, na mesma estrutura exata do card de Investimento — nunca
 *   mais lado a lado num `justify-between`.
 * - o `%` já tinha ganhado destaque tipográfico numa etapa anterior
 *   (`text-xl font-bold`) — mantido, é o número comparado de relance com o
 *   do card ao lado.
 */
export function MonthlyGoalProgress({
  goal,
  monthResultCount,
  targetResultCount,
  expectedToDate,
}: {
  goal: PerformanceGoal;
  monthResultCount: number;
  /** Sempre > 0 — quem chama só renderiza este componente com meta de
   * quantidade configurada pro mês (nunca "0/0" ou "X/undefined"). */
  targetResultCount: number;
  expectedToDate: number;
}) {
  const config = PERFORMANCE_GOALS[goal];
  const pct = Math.round((monthResultCount / targetResultCount) * 100);

  const status = classifySpendStatus(monthResultCount, expectedToDate, targetResultCount);
  const ritmoText = RITMO_STATUS_TEXT[status] ?? null;

  // Mesmo formato central (`FinancialPeriodSummary`) que `MonthInvestmentSummary`
  // já monta pra alimentar `AgencyInvestmentBar` — aqui "planejado" é a meta
  // de quantidade, "realizado" é o resultado do mês, nenhum cálculo novo
  // (os 3 valores já chegam prontos via props). `label`/`startDate`/
  // `endDate` ficam vazios de propósito: não existe um "período" nomeado
  // aqui, só a mesma matemática de planejado/realizado/esperado que a barra
  // precisa pra se desenhar.
  const summary: FinancialPeriodSummary = {
    kind: "month",
    label: "",
    startDate: "",
    endDate: "",
    planned: targetResultCount,
    actual: monthResultCount,
    expectedToDate,
    pct: targetResultCount > 0 ? (monthResultCount / targetResultCount) * 100 : null,
    status,
  };

  return (
    <div>
      {/* Etapa "Refinamento Visual 2.0 — Indicador real no título": era o
          rótulo genérico "Performance" — agora é o próprio indicador
          principal configurado pro cliente (`config.pluralLabel`, mesmo
          conceito de `PERFORMANCE_GOALS` já usado em todo o resto da
          plataforma, nenhuma segunda regra pra descobrir o nome). Como o
          indicador já nomeia o card, a unidade repetida depois da fração
          ("75/100 leads") saiu — a fração sozinha já é auto-explicativa
          logo abaixo do título. */}
      <p className="text-[11px] font-medium uppercase tracking-wide text-overview-text-muted">{config.pluralLabel.toUpperCase()}</p>
      <div className="mt-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-sm font-semibold text-overview-text-primary">
            {formatCount(monthResultCount)}/{formatCount(targetResultCount)}
          </p>
          <p className="text-xl font-bold text-overview-text-primary">{pct}%</p>
        </div>

        <div className="mt-1.5">
          <AgencyInvestmentBar summary={summary} showLegend={false} formatValue={formatCount} overflowIsPositive />
        </div>

        <div className="mt-2">
          {ritmoText && (
            <p className={`flex items-center gap-1.5 text-xs font-medium ${RITMO_TONE_CLASSES[status] ?? ""}`}>
              <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
              {ritmoText}
            </p>
          )}
          <p className="mt-0.5 text-xs text-overview-text-secondary">Esperado hoje: {formatCount(expectedToDate)}</p>
        </div>
      </div>
    </div>
  );
}
