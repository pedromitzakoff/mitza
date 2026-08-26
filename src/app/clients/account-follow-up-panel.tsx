import type { ReactNode } from "react";
import type { AccountReviewOutcome, OptimizationType } from "@/lib/supabase/database.types";
import type { PerformanceSummary } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { MonthlyKpiSummary } from "./monthly-kpi-summary";
import { MonthlyGoalProgress } from "./monthly-goal-progress";
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
 * o progresso da meta e o detalhamento por canal só consomem valores já
 * calculados pela página; nunca recomputados aqui.
 *
 * Etapa "Primeira dobra: Performance e Investimento lado a lado": os KPIs
 * (`MonthlyKpiSummary`) continuam em largura total, sempre o primeiro
 * elemento — são o hero da tela. Logo abaixo, "Performance"
 * (`MonthlyGoalProgress`) e "Investimento" (`investmentSummary`, um
 * `ReactNode` já pronto — `MonthInvestmentSummary`, montado por
 * `[id]/page.tsx` com todas as suas próprias props, nenhuma duplicada aqui)
 * passam a viver lado a lado num grid de 2 colunas a partir de `md:` —
 * empilhado em telas menores, mesma ordem de sempre. A intenção é permitir
 * comparar Performance × Investimento (dois `%`) de relance, sem rolar a
 * página. "Resultados por canal" continua em largura total, logo abaixo do
 * grid — é detalhe secundário de Performance, não precisa competir por
 * altura dentro da coluna.
 *
 * O histórico do mês (antigo `CollapsibleAccountHistory`, um resumo das 5
 * atividades mais recentes) saiu da apresentação padrão da Visão Geral —
 * pedido explícito do usuário pra não competir com Performance/Investimento
 * nesta dobra. Nenhum dado ou funcionalidade foi apagada: a Timeline
 * (`activeArea === "timeline"`) já mostra o histórico completo de forma
 * independente, e um link discreto "Histórico" continua acessível na área
 * técnica do cabeçalho (`[id]/page.tsx`), abrindo o mesmo drawer de sempre.
 *
 * Etapa "Simetria Performance x Investimento": Performance e Investimento
 * (`investmentSummary`) precisam ser um PAR ESPELHADO — mesma anatomia,
 * mesma altura aproximada. As ações de investimento ("Ver detalhes do
 * investimento"/"Editar planejamento"/"Ver histórico", antes dentro da
 * coluna de Investimento) saíram pra um segundo slot (`investmentActions`,
 * também um `ReactNode` pronto — `MonthInvestmentActions`) renderizado
 * numa linha COMPARTILHADA, abaixo das duas colunas — nunca dentro de uma
 * coluna específica, pra não deformar a altura só de um lado (Performance
 * não tem ação equivalente, e não devemos inventar uma só pra preencher
 * espaço). Uma divisória vertical bem sutil (`md:divide-x`, mesmo token
 * `overview-border` de sempre) reforça o grid entre as duas colunas no
 * desktop, sem virar dois cards.
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
  investmentSummary,
  investmentActions,
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
  /** `<MonthInvestmentSummary />` já pronto, montado por quem chama — este
   * componente só decide ONDE ele entra no layout (coluna ao lado de
   * Performance), nunca conhece suas props internas. `undefined` nunca
   * acontece na prática (a página sempre monta o investimento), mas fica
   * opcional pra este componente não depender de um consumidor específico. */
  investmentSummary?: ReactNode;
  /** `<MonthInvestmentActions />` já pronto — disclosure/edição/histórico
   * do investimento, renderizado numa linha compartilhada abaixo do grid
   * (nunca dentro da coluna de Performance ou de Investimento). */
  investmentActions?: ReactNode;
}) {
  return (
    <>
      <MonthlyKpiSummary
        monthActual={monthActual}
        performanceGoal={performanceGoal}
        performanceSummary={performanceSummary}
        targetCostPerResult={targetCostPerResult}
        configureObjectiveHref={configureObjectiveHref}
      />

      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 md:divide-x md:divide-overview-border">
        <div className="md:pr-3">
          {performanceGoal && targetResultCount != null && targetResultCount > 0 && expectedResultsToDate != null && (
            <MonthlyGoalProgress
              goal={performanceGoal}
              monthResultCount={performanceSummary?.resultCount ?? 0}
              targetResultCount={targetResultCount}
              expectedToDate={expectedResultsToDate}
            />
          )}
        </div>
        <div className="md:pl-3">{investmentSummary}</div>
      </div>

      {investmentActions && <div className="mt-2 border-t border-overview-border pt-2">{investmentActions}</div>}

      {performanceGoal && <ResultsByChannel goal={performanceGoal} channelBreakdown={channelBreakdown} />}
    </>
  );
}
