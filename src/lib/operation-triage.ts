/**
 * Suporte da tela Operação (ordenação/contagem/navegação de mês) —
 * conceito NOVO, não uma evolução da Sprint. Nenhuma função aqui depende
 * de `sprints`, `sprint_id` ou de qualquer módulo sob `app/sprints/` ou
 * `app/operation/operation-data.ts` (o motor da Sprint), pra a Operação
 * poder evoluir sem carregar a Sprint junto.
 *
 * Etapa "Motor de Saúde da Conta": este arquivo deixou de conter a lógica
 * de classificação (score ponderado provisório) — isso agora vive em
 * `lib/account-health-engine.ts` (`evaluateAccountHealth`), que decide a
 * saúde geral sempre pela PIOR dimensão, nunca por soma/média de pesos.
 * `OperationTriageClient`/`OperationTriageBand` seguem aqui como o formato
 * de COMPATIBILIDADE que a tela (`operation-triage-view.tsx`) ainda
 * consome nesta etapa — o redesenho visual (próxima etapa) troca a tela
 * pra consumir `AccountHealthEvaluation` diretamente e este tipo some.
 */

export type OperationTriageBand = "precisa_atencao" | "em_risco" | "em_acompanhamento" | "saudavel";

export const OPERATION_TRIAGE_BAND_ORDER: OperationTriageBand[] = [
  "precisa_atencao",
  "em_risco",
  "em_acompanhamento",
  "saudavel",
];

export interface OperationTriageClient {
  clientId: string;
  clientName: string;
  managerName: string | null;
  band: OperationTriageBand;
  /** Já ordenados por importância — `reasons[0]` é o protagonista da
   * linha (seção 4 do pedido). Vazio quando nenhum sinal disparou. */
  reasons: string[];
  monthSpend: number;
  monthSpendDeltaFraction: number | null;
  reviewDaysAgo: number | null;
  overdueTasksCount: number;
}

const BAND_SEVERITY_RANK: Record<OperationTriageBand, number> = {
  precisa_atencao: 0,
  em_risco: 1,
  em_acompanhamento: 2,
  saudavel: 3,
};

/** Ordenação da fila inteira: banda primeiro (mais severa primeiro),
 * depois nome — determinístico, sem depender do score fora desta função. */
export function sortOperationTriageClients(clients: OperationTriageClient[]): OperationTriageClient[] {
  return [...clients].sort((a, b) => {
    const bandDiff = BAND_SEVERITY_RANK[a.band] - BAND_SEVERITY_RANK[b.band];
    if (bandDiff !== 0) return bandDiff;
    return a.clientName.localeCompare(b.clientName);
  });
}

export function countOperationTriageBands(clients: OperationTriageClient[]): Record<OperationTriageBand, number> {
  const counts: Record<OperationTriageBand, number> = {
    precisa_atencao: 0,
    em_risco: 0,
    em_acompanhamento: 0,
    saudavel: 0,
  };
  for (const client of clients) counts[client.band]++;
  return counts;
}

/** Desloca um parâmetro de mês (`YYYY-MM-01`) em N meses — helper local e
 * mínimo (não importa de `lib/sprint-financials.ts`, que é código da
 * Sprint) só pra navegação do seletor de período desta tela. */
export function shiftOperationMonth(monthParam: string, deltaMonths: number): string {
  const [year, month] = monthParam.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** `{firstDay, lastDay}` do mês do parâmetro da Operação — helper local e
 * mínimo (mesma razão de `shiftOperationMonth`: nunca importar de
 * `lib/sprint-financials.ts`) só pra alimentar `computeMonthlyExpectedPct`/
 * `resolveMonthlyPlanSnapshot` com o intervalo real do mês (nunca o
 * "-31" fixo usado pelos filtros de `daily_spend`/`performance_records`,
 * que só precisam de um limite superior generoso, não do último dia real). */
export function monthRangeFromOperationParam(monthParam: string): { firstDay: string; lastDay: string } {
  const [year, month] = monthParam.split("-").map(Number);
  const lastDay = daysInMonth(year, month);
  return { firstDay: monthParam, lastDay: `${monthParam.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Dois intervalos do mesmo tamanho (em dias) — mês selecionado até o dia
 * de corte, e o intervalo equivalente do mês anterior — pra "Investimento
 * (mês) vs. mês anterior" nunca comparar um mês parcial com um mês
 * inteiro (o que sempre pareceria uma queda enorme). Se o mês selecionado
 * já terminou, o corte é o próprio último dia dele (mês inteiro contra
 * mês inteiro). Puro — recebe `today` de fora, nunca lê o relógio.
 */
export function computeComparableSpendRanges(
  monthParam: string,
  today: Date,
): { current: { start: string; end: string }; previous: { start: string; end: string } } {
  const [year, month] = monthParam.split("-").map(Number);
  const todayParam = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const isCurrentMonth = monthParam === todayParam;
  const lastDayOfMonth = daysInMonth(year, month);
  const cutoffDay = isCurrentMonth ? today.getUTCDate() : lastDayOfMonth;

  const currentStart = monthParam;
  const currentEnd = addDays(monthParam, cutoffDay - 1);

  const previousStart = shiftOperationMonth(monthParam, -1);
  const [prevYear, prevMonth] = previousStart.split("-").map(Number);
  const previousCutoffDay = Math.min(cutoffDay, daysInMonth(prevYear, prevMonth));
  const previousEnd = addDays(previousStart, previousCutoffDay - 1);

  return {
    current: { start: currentStart, end: currentEnd },
    previous: { start: previousStart, end: previousEnd },
  };
}
