import type { TrafficChannel } from "./traffic-channels";
import type { PerformanceGoal } from "./performance-goals";
import { computeCostPerResult } from "./performance";
import type { DailyResultRawRow } from "./daily-results";

/**
 * MITZA ONE — Evolução Diária no Cockpit. Núcleo puro, sem Supabase — quem
 * busca os dados (`clients/[id]/page.tsx`) já tem em mãos as MESMAS linhas
 * cruas que `lib/daily-results.ts`/`app/clients/analytics-data.ts` usam
 * (`getDailyPerformanceRowsForPeriod`/`getDailySpendRowsForPeriod`,
 * `lib/performance-queries.ts`) — nenhuma segunda consulta, nenhuma segunda
 * tabela.
 *
 * Diferença deliberada em relação a `buildDailyResultSeries`
 * (`lib/daily-results.ts`): aquela função decide "a janela inteira é
 * confiável?" (tudo ou nada — um único dia sem sinal de sincronização
 * derruba a série inteira pra `unavailable`), pensada pra uma janela curta
 * de "últimos 7 dias" terminando hoje. Esta função decide por DIA (seção 5
 * do pedido: "distinguir dia com zero confirmado / dia sem dados / dia
 * futuro"), pensada pro MÊS inteiro selecionado no Cockpit (que pode ter
 * dias futuros dentro do mês corrente, ou atraso de sincronização em só
 * alguns dias, sem que isso esconda os dias que JÁ têm dado real). A regra
 * de "zero confirmado" em si é a MESMA das duas funções irmãs (`daily_spend`
 * no mesmo escopo = sinal de que o dia foi sincronizado).
 *
 * Limitação documentada (seção 9 do pedido): o sinal de sincronização por
 * dia é por ESCOPO DE CANAL (`channels`), não por canal individual dentro
 * do escopo — um grupo "Meta + Google" marca um dia como sincronizado se
 * QUALQUER um dos dois tiver linha de `daily_spend` naquele dia, mesma
 * simplificação já aceita em `buildDailyResultSeries`/
 * `buildClientAnalyticsDailyRows`, nunca uma regra nova inventada aqui.
 * "Dados parciais" (um dos canais do grupo sincronizou, o outro não, no
 * mesmo dia) não é um estado distinguível com os dados disponíveis hoje —
 * documentado, nunca aproximado por uma heurística nova.
 */

export type CockpitDailyPointState = "result" | "no_data" | "future";

export interface CockpitDailyEvolutionPoint {
  date: string;
  state: CockpitDailyPointState;
  /** `null` quando `state !== "result"` — zero É um resultado válido
   * (`state === "result"` com `resultCount === 0` = zero confirmado). */
  resultCount: number | null;
  /** Investimento do dia, no mesmo escopo de canal da série — `null` quando
   * nenhuma linha de `daily_spend` cobre esse dia nesse escopo (nunca `0`
   * fabricado). */
  spend: number | null;
  /** `computeCostPerResult` oficial (`lib/performance.ts`) — `null` sempre
   * que `state !== "result"`, ou quando `resultCount === 0` (divisão por
   * zero nunca vira `0`/`Infinity`, seção 3 do pedido). */
  costPerResult: number | null;
}

export interface CockpitDailySpendRawRow {
  date: string;
  channel: TrafficChannel;
  spend: number;
}

/**
 * Série diária de UM objetivo (resultado + investimento + custo), escopada
 * aos canais do grupo (`CockpitResultGroup.channels`, `lib/cockpit-result-groups.ts`
 * — nunca uma segunda resolução de quais canais pertencem a qual objetivo).
 * `windowDates` é sempre o MÊS selecionado inteiro (igual ao resto do
 * Cockpit, nenhum seletor de período próprio) — dias depois de `todayStr`
 * (mês corrente) viram `state: "future"`, nunca um valor projetado.
 */
export function buildCockpitDailyEvolutionPoints(input: {
  windowDates: string[];
  todayStr: string;
  resultType: PerformanceGoal;
  channels: TrafficChannel[];
  performanceRows: DailyResultRawRow[];
  spendRows: CockpitDailySpendRawRow[];
}): CockpitDailyEvolutionPoint[] {
  const { windowDates, todayStr, resultType, channels, performanceRows, spendRows } = input;
  const inScope = (channel: TrafficChannel) => channels.includes(channel);

  const resultByDate = new Map<string, number>();
  for (const row of performanceRows) {
    if (row.resultType !== resultType || !inScope(row.channel)) continue;
    resultByDate.set(row.date, (resultByDate.get(row.date) ?? 0) + row.resultCount);
  }

  const spendByDate = new Map<string, number>();
  for (const row of spendRows) {
    if (!inScope(row.channel)) continue;
    spendByDate.set(row.date, (spendByDate.get(row.date) ?? 0) + row.spend);
  }

  return windowDates.map((date): CockpitDailyEvolutionPoint => {
    if (date > todayStr) {
      return { date, state: "future", resultCount: null, spend: null, costPerResult: null };
    }

    const hasResultRow = resultByDate.has(date);
    const hasSpendSignal = spendByDate.has(date);
    if (!hasResultRow && !hasSpendSignal) {
      return { date, state: "no_data", resultCount: null, spend: null, costPerResult: null };
    }

    const resultCount = hasResultRow ? resultByDate.get(date)! : 0;
    const spend = spendByDate.get(date) ?? null;
    return { date, state: "result", resultCount, spend, costPerResult: computeCostPerResult(spend, resultCount, true) };
  });
}

/**
 * "Meta diária" (seção 2/6 do pedido: referência visual, só quando houver
 * meta oficial válida) — decompõe a MESMA fórmula já usada pro "Esperado
 * até hoje" do card Resultado (`computeMonthlyExpectedToDateByCalendar`,
 * `lib/monthly-budget.ts`: `meta × dias_decorridos / dias_do_horizonte`) no
 * seu valor por dia, nunca uma fórmula nova — somar esta referência ao
 * longo de `daysElapsed` reconcilia exatamente com o "Esperado até hoje" já
 * exibido acima no Cockpit. `daysInMonth` é sempre o do MESMO
 * `planningHorizon` que o card Resultado já usa (nunca o calendário cru do
 * mês, pra um cliente com data de término — ex.: conta de evento).
 */
export function resolveDailyTargetResultCount(targetResultCount: number | null, daysInMonth: number): number | null {
  if (targetResultCount === null || targetResultCount <= 0 || daysInMonth <= 0) return null;
  return targetResultCount / daysInMonth;
}

/**
 * "Estado de disponibilidade dos dados" do tooltip (seção 3 do pedido) —
 * núcleo puro extraído do componente pra ser testável sem DOM. Os 4 textos
 * nunca se confundem entre si (seção 5: "distinguir dia com resultado zero
 * confirmado / dia sem dados / dia futuro").
 */
export function describeCockpitDailyPointState(point: CockpitDailyEvolutionPoint): string {
  if (point.state === "future") return "Dia futuro — ainda não ocorreu.";
  if (point.state === "no_data") return "Sem dados recebidos para este dia.";
  return point.resultCount === 0 ? "Zero confirmado — dia sincronizado, sem resultados." : "Dados confirmados.";
}
