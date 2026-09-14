import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import type { FinancialPeriodSummary } from "@/lib/financial-period";
import { formatCount } from "@/lib/format";
import { classifySpendStatus } from "@/lib/spend-status";

/**
 * "Resultados — X%" — uma das duas leituras da seção "Ritmo do mês"
 * (`AccountFollowUpPanel`, Etapa "Revisão Performance — Visão Geral do
 * cliente"). Só o título + a barra com o marcador de "esperado até hoje" —
 * a fração ("54/100"), o "%" como número solto e o texto de status
 * ("Dentro do ritmo esperado"/"Esperado hoje: X") saíram daqui: a fração
 * já está nos KPIs acima ("Resultado" + "Meta 100"), e o status virou o
 * DIAGNÓSTICO ÚNICO da seção (compartilhado com Investimento, nunca mais
 * dois textos de ritmo independentes na mesma tela).
 *
 * A CLASSIFICAÇÃO de ritmo continua reaproveitando 100% a régua central já
 * usada pro investimento (`classifySpendStatus`, de `spend-status.ts`,
 * mesma margem de ±20%) — nenhuma segunda fórmula de "está no ritmo"
 * inventada aqui; só decide a COR da barra (`AgencyInvestmentBar` já
 * espera um `status` dentro do `FinancialPeriodSummary`). O texto do
 * diagnóstico em si (que também usa este mesmo `status`) é computado à
 * parte por `AccountFollowUpPanel`, com os mesmos inputs — mesmo padrão já
 * usado por `MonthInvestmentActions`/`MonthInvestmentSummary`
 * (recalcular uma função pura central em mais de um lugar nunca é uma
 * segunda regra, é a MESMA regra aplicada de novo).
 */
export function MonthlyGoalProgress({
  monthResultCount,
  targetResultCount,
  expectedToDate,
}: {
  monthResultCount: number;
  /** Sempre > 0 — quem chama só renderiza este componente com meta de
   * quantidade configurada pro mês (nunca "0/0" ou "X/undefined"). */
  targetResultCount: number;
  expectedToDate: number;
}) {
  const pct = Math.round((monthResultCount / targetResultCount) * 100);
  const status = classifySpendStatus(monthResultCount, expectedToDate, targetResultCount);

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
      <p className="text-sm font-medium text-overview-text-primary">
        Resultados — <span className="tabular-nums">{pct}%</span>
      </p>
      <div className="mt-1.5">
        <AgencyInvestmentBar summary={summary} showLegend={false} formatValue={formatCount} overflowIsPositive />
      </div>
    </div>
  );
}
