import type { ReactNode } from "react";
import type { AccountReviewOutcome, OptimizationType } from "@/lib/supabase/database.types";
import type { PerformanceSummary } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import type { SpendStatus } from "@/lib/spend-status";
import { MonthlyKpiSummary } from "./monthly-kpi-summary";
import { MonthlyGoalProgress } from "./monthly-goal-progress";
import { MonthInvestmentSummary } from "./month-investment-summary";
import { ResultsByChannel } from "./results-by-channel";

/**
 * Última otimização (Etapa 74) — substitui os antigos indicadores separados
 * "Última análise"/"Última otimização": otimização é a revisão estratégica
 * da conta em si (account_reviews), registrada mesmo quando nenhuma
 * alteração foi necessária — nunca dois indicadores pro mesmo evento.
 */
export interface LastOptimizationInfo {
  reviewedAt: string;
  managerName: string;
  outcome: AccountReviewOutcome;
  /** Tipos das alterações técnicas registradas (só quando outcome é
   * OPTIMIZATION_PERFORMED) — vazio nos demais casos. */
  optimizationTypes: OptimizationType[];
  /** Descrição do problema (só quando outcome é ISSUE_IDENTIFIED). */
  issueDescription: string | null;
}

/**
 * "ACOMPANHAMENTO DA CONTA" — principal bloco operacional da página do
 * cliente. Nenhum cálculo financeiro ou de performance muda aqui — os KPIs,
 * o ritmo e o detalhamento por canal só consomem valores já calculados
 * pela página; nunca recomputados aqui.
 *
 * Etapa "Revisão Performance — Visão Geral do cliente" (substitui a
 * hierarquia anterior — "Primeira dobra"/"Simetria Performance x
 * Investimento"): o mesmo dado aparecia de até 9 formas diferentes na
 * tela (fração, %, barra, "esperado hoje", diagnóstico de ritmo, diferença
 * em reais, restante, dias restantes...). Hierarquia, em 3 camadas:
 *
 * 1. KPIs (`MonthlyKpiSummary`) — "o que aconteceu no mês?": Resultado,
 *    Investimento, Custo por resultado (+ Faturamento/ROAS quando
 *    aplicável), todos o MESMO nível hierárquico, cada um com só valor +
 *    referência estática (Meta/Planejado) como texto secundário.
 * 2. "RITMO DO MÊS" — "o avanço está de acordo com o esperado?": duas
 *    leituras empilhadas (nunca mais lado a lado com divisor vertical —
 *    pedido explícito pra tirar essa separação visual), cada uma só
 *    título com o % embutido + barra (`MonthlyGoalProgress`/
 *    `MonthInvestmentSummary`) + marker "Esperado hoje" — a própria barra é
 *    a representação CANÔNICA do pacing.
 * 3. Metadata do ritmo (`investmentPaceNote` — "Diferença para o ritmo"/
 *    "Ritmo recomendado"/"Ver histórico", Etapa "Simplificação
 *    Pós-Facelift") DENTRO da mesma seção "Ritmo do mês", e "Resultados por
 *    canal" em largura total, fechando o bloco.
 *
 * Etapa "Remoção do Diagnóstico Textual": o diagnóstico único por extenso
 * (`RitmoDiagnostic` — "Resultados: Abaixo do ritmo esperado · Investimento:
 * ...", inclusive as variantes "Dentro do ritmo esperado"/só uma leitura)
 * foi removido por inteiro — as barras + o marker "Esperado hoje" (ambos
 * intocados, nenhum cálculo/threshold mudou) já são a leitura canônica do
 * pacing; repetir isso em prosa era a MESMA informação em duas formas.
 * `investmentPaceNote` (camada 3) é agora o único texto que sobra abaixo
 * das barras, e é deliberadamente neutro — nunca um segundo veredito
 * colorido no lugar do que acabou de sair.
 *
 * O antigo disclosure "Ver detalhes do investimento" (com "Realizado"/
 * "Esperado hoje"/"Esperado até hoje"/"Regra da projeção") também já tinha
 * sido removido numa etapa anterior — informação duplicada da camada 1/2;
 * "Editar planejamento" subiu pra toolbar de `[id]/page.tsx`.
 *
 * O histórico do mês (antigo `CollapsibleAccountHistory`) continua fora da
 * apresentação padrão (decisão de etapa anterior, inalterada) — a Timeline
 * e o disclosure "Informações da conta" continuam cobrindo isso.
 */
export function AccountFollowUpPanel({
  monthActual,
  performanceGoal,
  performanceSummary,
  targetCostPerResult,
  targetResultCount,
  expectedResultsToDate,
  channelBreakdown,
  configureObjectiveHref,
  investmentPlanned,
  investmentExpectedToDate,
  investmentStatus,
  investmentMonthLabel,
  investmentMonthRange,
  isFutureMonth,
  isClosedMonth,
  currentPlanningEndDate,
  investmentPaceNote,
}: {
  /** Investimento realizado do mês selecionado — já calculado pela camada
   * financeira (`sumActualSpendForMonth`), nunca recomputado aqui. */
  monthActual: number;
  performanceGoal: PerformanceGoal | null;
  performanceSummary: PerformanceSummary | null;
  /** Meta de custo por resultado vigente — `null` quando não configurada. */
  targetCostPerResult: number | null;
  /** Meta de QUANTIDADE de resultado vigente pro mês selecionado — `null` =
   * sem meta configurada (nunca mostra "X/undefined"). */
  targetResultCount?: number | null;
  /** `computeMonthlyExpectedToDateByCalendar` aplicado a `targetResultCount`
   * — mesma lógica temporal já usada pro investimento. */
  expectedResultsToDate?: number | null;
  /** Resultado por canal do mês, só os canais com pelo menos 1 registro —
   * `ResultsByChannel` só renderiza algo com dado em mais de 1 canal. */
  channelBreakdown: { channel: TrafficChannel; resultCount: number }[];
  configureObjectiveHref: string;
  /** Orçamento mensal vigente (`resolveMonthlyBudget`) — mesmo valor de
   * sempre, agora consumido tanto pelo KPI "Investimento" quanto pela
   * barra de "Ritmo do mês", nunca duas fontes diferentes. */
  investmentPlanned: number;
  investmentExpectedToDate: number;
  investmentStatus: SpendStatus;
  investmentMonthLabel: string;
  investmentMonthRange: { firstDay: string; lastDay: string };
  isFutureMonth: boolean;
  isClosedMonth: boolean;
  currentPlanningEndDate: string | null;
  /** `<MonthInvestmentPaceNote />` já pronto — "Diferença para o ritmo"/
   * "Ritmo recomendado" + "Ver histórico". Renderizado DENTRO da seção
   * "Ritmo do mês", logo abaixo das barras — nunca numa faixa separada
   * abaixo dela. */
  investmentPaceNote?: ReactNode;
}) {
  // Resultado só tem leitura de ritmo (renderiza a barra) quando há meta de
  // QUANTIDADE configurada pro mês — mesmo guard que já existia antes de
  // `MonthlyGoalProgress` ser renderizado, nenhuma condição nova.
  const hasResultRitmo = Boolean(performanceGoal) && targetResultCount != null && targetResultCount > 0 && expectedResultsToDate != null;

  return (
    <>
      {/* Etapa "Facelift Visual 2.0 — Performance sem grande card": a
          superfície areia grande que identificava este bloco (removida —
          virou "card dentro de card" competindo com Tarefas) dá lugar a uma
          assinatura pontual: barra vertical + label pequena, mesmo
          tratamento tipográfico já usado no rótulo "Ritmo do mês" abaixo
          (`text-[11px] font-semibold uppercase tracking-wide`), nunca um
          retângulo colorido. Areia (`bg-sand`) reaparece só aqui, como
          acento — não como superfície. */}
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3.5 w-1 shrink-0 rounded-full bg-sand" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Performance do mês</p>
      </div>

      <div className="mt-3">
        <MonthlyKpiSummary
          monthActual={monthActual}
          performanceGoal={performanceGoal}
          performanceSummary={performanceSummary}
          targetCostPerResult={targetCostPerResult}
          targetResultCount={targetResultCount}
          investmentPlanned={investmentPlanned}
          configureObjectiveHref={configureObjectiveHref}
        />
      </div>

      <div className="mt-5 border-t border-overview-border pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Ritmo do mês</p>

        <div className="mt-2.5 flex flex-col gap-3.5">
          {hasResultRitmo && (
            <MonthlyGoalProgress
              monthResultCount={performanceSummary?.resultCount ?? 0}
              targetResultCount={targetResultCount as number}
              expectedToDate={expectedResultsToDate as number}
            />
          )}
          <MonthInvestmentSummary
            planned={investmentPlanned}
            actual={monthActual}
            expectedToDate={investmentExpectedToDate}
            status={investmentStatus}
            monthLabel={investmentMonthLabel}
            monthRange={investmentMonthRange}
            isClosedMonth={isClosedMonth}
            isFutureMonth={isFutureMonth}
            currentPlanningEndDate={currentPlanningEndDate}
          />
        </div>

        {/* Etapa "Remoção do Diagnóstico Textual": o diagnóstico por
            extenso (`RitmoDiagnostic`, ex.: "Resultados: Abaixo do ritmo
            esperado · Investimento: ...") foi removido daqui — as barras
            acima + o marker "Esperado hoje" já são a representação
            canônica do pacing, repetir em prosa era a mesma informação
            duas vezes. `investmentPaceNote` (metadata neutra: "Diferença
            para o ritmo"/"Ritmo recomendado"/"Ver histórico") continua
            sendo o único texto secundário abaixo das barras. */}
        {investmentPaceNote && <div className="mt-2.5">{investmentPaceNote}</div>}
      </div>

      {performanceGoal && <ResultsByChannel goal={performanceGoal} channelBreakdown={channelBreakdown} />}
    </>
  );
}
