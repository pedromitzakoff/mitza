import { classifySpendStatus, type SpendStatus } from "@/lib/spend-status";
import { todayUTC } from "@/lib/today";

export type SprintTemporalStatus = "futura" | "atual" | "concluida";

/** Origem do gasto real de uma sprint: "meta_api" é o padrão (soma de
 * daily_spend, como sempre foi); "manual" é um valor digitado à mão
 * enquanto a sync do Meta não é a fonte de teste. */
export type SpendSource = "manual" | "meta_api";

export interface SprintFinancials {
  sprintId: string;
  startDate: string;
  endDate: string;
  plannedSpend: number;
  actualSpend: number;
  expectedToDate: number;
  status: SpendStatus;
  progressPct: number;
  temporalStatus: SprintTemporalStatus;
  spendSource: SpendSource;
}

/**
 * Decide qual valor de gasto real vale pra uma sprint: se a origem
 * configurada é "manual" e existe um valor manual salvo, esse valor manda —
 * a sync do Meta continua rodando e gravando em daily_spend normalmente,
 * mas essa função é o único lugar que decide se ela deve "aparecer" ou não.
 * Fora daqui (Sprints, Visão Geral, /clients), nada muda: essas telas nunca
 * chamam esta função e continuam com a soma de daily_spend de sempre.
 */
export function resolveSprintActualSpend(
  sprint: { spend_source: SpendSource; manual_actual_spend: number | null },
  metaSpendSum: number,
): number {
  if (sprint.spend_source === "manual" && sprint.manual_actual_spend !== null) {
    return sprint.manual_actual_spend;
  }
  return metaSpendSum;
}

/** Fonte única do gasto real de UMA sprint: soma o daily_spend do período
 * dela e resolve manual x meta_api. Todo lugar que precisa do gasto real de
 * uma sprint (mensal consolidado, cartão da sprint, gráfico) passa por
 * aqui — nunca duplica o filtro+soma de daily_spend por conta própria. */
export function computeSprintEffectiveSpend(
  sprint: {
    start_date: string;
    end_date: string;
    spend_source: SpendSource;
    manual_actual_spend: number | null;
  },
  dailySpend: { date: string; spend: number }[],
): number {
  const metaSpendSum = dailySpend
    .filter((d) => d.date >= sprint.start_date && d.date <= sprint.end_date)
    .reduce((sum, d) => sum + d.spend, 0);
  return resolveSprintActualSpend(sprint, metaSpendSum);
}

/** Soma o gasto real efetivo de várias sprints — usado pra consolidar o
 * gasto realizado do mês (soma do effective_spend de cada sprint do mês,
 * nunca a soma direta de daily_spend). */
export function sumEffectiveSpend(
  sprints: {
    start_date: string;
    end_date: string;
    spend_source: SpendSource;
    manual_actual_spend: number | null;
  }[],
  dailySpend: { date: string; spend: number }[],
): number {
  return sprints.reduce((sum, sprint) => sum + computeSprintEffectiveSpend(sprint, dailySpend), 0);
}

export function daysBetweenInclusive(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

function parseDateUTC(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/**
 * Gasto esperado até hoje de UMA sprint, proporcional aos dias já passados
 * dentro dela: sprint futura = R$ 0; sprint encerrada = 100% do planejado;
 * sprint em andamento = planejado × (dias decorridos / dias totais). Única
 * fonte dessa conta — reaproveitada por `computeSprintFinancials` (cartão
 * da sprint) e por `sumExpectedToDate` (agregado da agência), pra nunca
 * divergir entre página do cliente, Sprints e Visão Geral.
 */
export function computeSprintExpectedToDate(
  sprint: { start_date: string; end_date: string; planned_spend: number },
  today: Date,
): number {
  const start = parseDateUTC(sprint.start_date);
  const end = parseDateUTC(sprint.end_date);
  const totalDays = daysBetweenInclusive(start, end);
  if (totalDays <= 0) return 0;

  const daysPassed = today < start ? 0 : today > end ? totalDays : daysBetweenInclusive(start, today);
  return (sprint.planned_spend * daysPassed) / totalDays;
}

/** Soma o esperado até hoje de várias sprints — usado pelo resumo de
 * investimento da Visão Geral (agregado de todos os clientes filtrados). */
export function sumExpectedToDate(
  sprints: { start_date: string; end_date: string; planned_spend: number }[],
  today: Date,
): number {
  return sprints.reduce((sum, sprint) => sum + computeSprintExpectedToDate(sprint, today), 0);
}

/**
 * Calcula o financeiro de uma sprint: gasto esperado até hoje, status
 * (dentro/acima/abaixo) e % de progresso da barra (gasto / planejado).
 */
export function computeSprintFinancials(
  sprint: { id: string; start_date: string; end_date: string; planned_spend: number },
  actualSpend: number,
  today: Date = todayUTC(),
  spendSource: SpendSource = "meta_api",
): SprintFinancials {
  const start = parseDateUTC(sprint.start_date);
  const end = parseDateUTC(sprint.end_date);

  const expectedToDate = computeSprintExpectedToDate(sprint, today);
  const status = classifySpendStatus(actualSpend, expectedToDate, sprint.planned_spend);
  const progressPct = sprint.planned_spend > 0 ? (actualSpend / sprint.planned_spend) * 100 : 0;
  const temporalStatus: SprintTemporalStatus =
    today < start ? "futura" : today > end ? "concluida" : "atual";

  return {
    sprintId: sprint.id,
    startDate: sprint.start_date,
    endDate: sprint.end_date,
    plannedSpend: sprint.planned_spend,
    actualSpend,
    expectedToDate,
    status,
    progressPct,
    temporalStatus,
    spendSource,
  };
}

/** Uma linha de `sprint_planned_allocations` já buscada do banco — planejado
 * de um dia específico de uma sprint específica. */
export interface PlannedAllocationRow {
  date: string;
  sprintId: string;
  amount: number;
}

/** Uma linha de `sprint_manual_spend_by_month` — gasto manual de UM mês de
 * uma sprint que atravessa a fronteira do mês (ver sprintCrossesMonthBoundary
 * em sprint-week.ts). Sprints que não atravessam mês nunca precisam disso —
 * usam só `manual_actual_spend`, como sempre foi. */
export interface ManualSpendByMonthRow {
  sprintId: string;
  monthStart: string;
  amount: number;
}

/**
 * Planejado de um cliente pertencente a um mês — soma direta das alocações
 * diárias (`sprint_planned_allocations`) cujo `date` cai no mês, independente
 * de qual sprint elas pertencem. Substitui a soma antiga de
 * `sprint.planned_spend` filtrando sprints por `start_date` no mês, que
 * atribuía 100% de uma sprint (inclusive a parte de outro mês) ao mês em que
 * ela começou — o bug central que a Etapa 50 corrige. Já é exata mesmo numa
 * sprint que atravessa dois meses com orçamentos diários diferentes, porque
 * cada linha de alocação já guarda o valor real daquele dia específico.
 */
export function sumPlannedForMonth(
  plannedAllocations: PlannedAllocationRow[],
  monthRange: { firstDay: string; lastDay: string },
): number {
  return plannedAllocations
    .filter((a) => a.date >= monthRange.firstDay && a.date <= monthRange.lastDay)
    .reduce((sum, a) => sum + a.amount, 0);
}

/** Mesma soma acima, mas só das alocações de UMA sprint — usado pra mostrar
 * a divisão financeira por mês de uma sprint que atravessa a fronteira
 * (ex.: "Semana 27 jul – 02 ago" → Julho R$ 500 / Agosto R$ 200). */
export function sumPlannedForSprintAndMonth(
  sprintId: string,
  plannedAllocations: PlannedAllocationRow[],
  monthRange: { firstDay: string; lastDay: string },
): number {
  return plannedAllocations
    .filter((a) => a.sprintId === sprintId && a.date >= monthRange.firstDay && a.date <= monthRange.lastDay)
    .reduce((sum, a) => sum + a.amount, 0);
}

/**
 * Esperado até hoje, pertencente a um mês — soma das alocações diárias já
 * decorridas (data ≤ hoje) dentro do mês. Mais precisa que o cálculo
 * proporcional por sprint inteira usado em `computeSprintExpectedToDate`
 * (que assume um valor diário uniforme dentro da sprint inteira — incorreto
 * quando ela atravessa dois meses com orçamentos diários diferentes): aqui
 * usa o valor real de cada dia, já gravado em `sprint_planned_allocations`.
 */
export function sumExpectedToDateForMonth(
  plannedAllocations: PlannedAllocationRow[],
  monthRange: { firstDay: string; lastDay: string },
  today: Date,
): number {
  const todayStr = today.toISOString().slice(0, 10);
  const cutoff = todayStr < monthRange.lastDay ? todayStr : monthRange.lastDay;
  if (cutoff < monthRange.firstDay) return 0;
  return plannedAllocations
    .filter((a) => a.date >= monthRange.firstDay && a.date <= cutoff)
    .reduce((sum, a) => sum + a.amount, 0);
}

/**
 * Gasto realizado de UMA sprint, pertencente a um mês — mesma decisão
 * manual×meta_api de `resolveSprintActualSpend`, recortada pelo mês: sprint
 * sincronizada soma só os dias de `daily_spend` dentro da interseção
 * sprint×mês (já granular por dia, não precisa de tabela nova); sprint
 * manual usa o valor único de sempre quando ela não atravessa mês, ou a
 * parcela daquele mês especificamente quando atravessa
 * (`sprint_manual_spend_by_month` — ausência de linha = 0, nunca inventa
 * distribuição).
 */
export function computeSprintMonthActualSpend(
  sprint: {
    id: string;
    start_date: string;
    end_date: string;
    spend_source: SpendSource;
    manual_actual_spend: number | null;
  },
  monthRange: { firstDay: string; lastDay: string },
  dailySpend: { date: string; spend: number }[],
  manualSpendByMonth: ManualSpendByMonthRow[],
): number {
  const overlapStart = sprint.start_date > monthRange.firstDay ? sprint.start_date : monthRange.firstDay;
  const overlapEnd = sprint.end_date < monthRange.lastDay ? sprint.end_date : monthRange.lastDay;
  if (overlapStart > overlapEnd) return 0;

  if (sprint.spend_source === "manual") {
    const crossesMonth = sprint.start_date.slice(0, 7) !== sprint.end_date.slice(0, 7);
    if (!crossesMonth) {
      return sprint.manual_actual_spend ?? 0;
    }
    const monthStart = `${monthRange.firstDay.slice(0, 7)}-01`;
    const split = manualSpendByMonth.find((m) => m.sprintId === sprint.id && m.monthStart === monthStart);
    return split?.amount ?? 0;
  }

  return dailySpend
    .filter((d) => d.date >= overlapStart && d.date <= overlapEnd)
    .reduce((sum, d) => sum + d.spend, 0);
}

/** Soma o gasto realizado de várias sprints, pertencente a um mês — versão
 * mensal de `sumEffectiveSpend`. Recebe TODAS as sprints que se sobrepõem ao
 * mês (não só as que começam nele) — quem monta essa lista precisa filtrar
 * por sobreposição (`start_date <= lastDay && end_date >= firstDay`), nunca
 * por `start_date` dentro do mês. */
export function sumActualSpendForMonth(
  sprints: {
    id: string;
    start_date: string;
    end_date: string;
    spend_source: SpendSource;
    manual_actual_spend: number | null;
  }[],
  monthRange: { firstDay: string; lastDay: string },
  dailySpend: { date: string; spend: number }[],
  manualSpendByMonth: ManualSpendByMonthRow[],
): number {
  return sprints.reduce(
    (sum, sprint) => sum + computeSprintMonthActualSpend(sprint, monthRange, dailySpend, manualSpendByMonth),
    0,
  );
}

/** Intervalo (YYYY-MM-DD) do mês corrente, usado pra filtrar sprints e daily_spend. */
export function currentMonthRange(today: Date = todayUTC()): { firstDay: string; lastDay: string } {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));

  return {
    firstDay: firstDay.toISOString().slice(0, 10),
    lastDay: lastDay.toISOString().slice(0, 10),
  };
}

/** Desloca um `{firstDay}` de mês por `deltaMonths` e devolve o parâmetro
 * `?month=YYYY-MM` correspondente — usado pela navegação de mês (Visão
 * Geral, tela Sprints no modo Mensal), pra nunca duplicar essa conta. */
export function shiftMonthParam(monthRange: { firstDay: string }, deltaMonths: number): string {
  const d = new Date(`${monthRange.firstDay}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + deltaMonths);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Lê o mês selecionado (`?month=YYYY-MM`) da URL, ou usa o mês corrente se
 * ausente/inválido — mesmo parsing reutilizado por Operação e pela Visão
 * Geral, pra nunca duplicar essa regra. */
export function monthRangeFromParam(
  monthParam: string | undefined,
  today: Date = todayUTC(),
): { firstDay: string; lastDay: string } {
  if (monthParam) {
    const [yearStr, monthStr] = monthParam.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr) - 1;
    if (Number.isFinite(year) && Number.isFinite(month) && month >= 0 && month <= 11) {
      const firstDay = new Date(Date.UTC(year, month, 1));
      const lastDay = new Date(Date.UTC(year, month + 1, 0));
      return { firstDay: firstDay.toISOString().slice(0, 10), lastDay: lastDay.toISOString().slice(0, 10) };
    }
  }
  return currentMonthRange(today);
}
