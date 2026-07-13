import { formatCurrency } from "@/lib/format";
import { SPEND_STATUS_BADGE_CLASSES, SPEND_STATUS_LABEL, type SpendStatus } from "@/lib/spend-status";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";

/**
 * Bloco 1 da nova hierarquia da página do cliente (Etapa 54) — "Investimento
 * do mês": substitui os 4 cards antigos (Investimento, Projeção do mês,
 * Tarefas atrasadas, Última atividade) por uma única superfície compacta.
 * Reaproveita `AgencyInvestmentBar` (mesma barra já usada na Visão Geral e em
 * Relatórios) — nenhum cálculo novo, nenhuma projeção de fim de mês, nenhum
 * denominador por número de sprints (os valores já chegam prontos de
 * `sumPlannedForMonth`/`sumActualSpendForMonth`/`sumExpectedToDateForMonth`/
 * `classifySpendStatus`, calculados uma única vez na página).
 */
export function MonthInvestmentSummary({
  planned,
  actual,
  expectedToDate,
  status,
}: {
  planned: number;
  actual: number;
  expectedToDate: number;
  status: SpendStatus;
}) {
  const diff = actual - expectedToDate;
  const diffText =
    planned > 0 && status !== "sem_meta" && status !== "nao_iniciado" && diff !== 0
      ? diff > 0
        ? `${formatCurrency(diff)} acima do ritmo esperado`
        : `${formatCurrency(Math.abs(diff))} abaixo do ritmo esperado`
      : null;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">Investimento do mês</h2>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[status]}`}>
          {SPEND_STATUS_LABEL[status]}
        </span>
      </div>

      {planned > 0 ? (
        <p className="mt-1 text-sm text-foreground">
          {formatCurrency(actual)} realizados de {formatCurrency(planned)} planejados
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Sem planejamento configurado para este mês.</p>
      )}

      <div className="mt-2">
        <AgencyInvestmentBar planned={planned} actual={actual} expectedToDate={expectedToDate} />
      </div>

      {diffText && <p className="mt-1 text-xs text-muted-foreground">{diffText}</p>}
    </div>
  );
}
