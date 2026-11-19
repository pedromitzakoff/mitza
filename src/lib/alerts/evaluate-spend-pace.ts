import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { requireQuery } from "@/lib/require-query";
import { todayDateString } from "@/lib/today";
import { shiftDays, startOfMonth, endOfMonth } from "@/lib/date-range";
import { listDatesInclusive, computeMonthlyExpectedToDateByCalendar } from "@/lib/monthly-budget";
import { resolveClientMonthlyPlan, filterRowsToPrimaryGoal, type ClientPlanChangeRow } from "@/lib/client-plan";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { resolveDailySpendReference, detectSpendPaceAlert } from "@/lib/alerts/spend-pace-detection";
import { persistAlertEvaluation } from "@/lib/alerts/persist-alert-evaluation";
import { SPEND_PACE_HISTORY_WINDOW_DAYS } from "@/lib/alerts/spend-pace-thresholds";
import type { AlertPeriodKind } from "@/lib/alerts/alert-types";

type AdminSupabase = SupabaseClient<Database>;

/**
 * Orquestração (impura) do alerta "Gasto acima ou abaixo do previsto" —
 * roda pro conjunto inteiro de clientes+canais com dado em `daily_spend`
 * (pedido, seção 6: "integrada à rotina de sincronização ou a uma rotina
 * agendada, para que o acompanhamento continue mesmo quando ninguém estiver
 * com a aba aberta"). Mesmo formato do cron existente
 * (`syncAllMetaApiAccounts`): nunca para no primeiro erro de UM
 * cliente/canal — cada falha fica isolada, as demais continuam avaliando.
 *
 * Avalia só "full_day" (ontem, dia completo) — acompanhável, participa da
 * máquina de estados completa (`reduceAlertEvaluation`).
 *
 * Existia uma 2ª janela, "in_progress" (hoje, em andamento) — removida a
 * pedido do usuário ("eu quero um alerta sempre sobre ontem então, já que
 * hoje o dia ainda está acontecendo"). Achado real que motivou a remoção:
 * como o gasto de HOJE só cresce ao longo do dia, um alerta "in_progress"
 * que cruzasse o limiar ficava preso em "acima" até a virada do dia, não
 * importa a ação manual tomada — cada reavaliação (a cada ~30min) reabria
 * o mesmo alerta, dando a falsa impressão de um bug. `isPeriodInProgress`
 * continua existindo em `detectSpendPaceAlert` (núcleo puro, testado) só
 * nunca mais é chamado com `true` por este orquestrador — se o monitor do
 * dia em andamento for retomado no futuro, precisa de um design diferente
 * (ex.: uma referência intradiária de verdade, não uma referência fixa pro
 * dia inteiro comparada contra um acumulado parcial).
 *
 * Nunca fabrica um `actualSpend` pra um dia SEM nenhuma linha em
 * `daily_spend` (pedido, seção 5: "não disparar alertas de performance sem
 * dados suficientes").
 */
export interface SpendPaceEvaluationSummary {
  evaluated: number;
  created: number;
  updated: number;
  resolved: number;
  ignored: number;
  skippedNoYesterdayData: number;
  errors: { clientId: string; channel: string; periodKind: AlertPeriodKind; message: string }[];
}

interface DailySpendPoint {
  date: string;
  spend: number;
}

export async function evaluateSpendPaceAlerts(now: Date = new Date(), supabase: AdminSupabase = createAdminClient()): Promise<SpendPaceEvaluationSummary> {
  const today = todayDateString(now);
  const yesterday = shiftDays(today, -1);
  // Tela de Alertas (pedido do usuário, melhoria visual): "mostre também o
  // acumulado do mês versus o previsto até a mesma data" — a janela
  // precisa cobrir desde o INÍCIO do mês (de ontem, pra nunca ficar curta
  // num dia 25 do mês, por exemplo), não só os `SPEND_PACE_HISTORY_WINDOW_DAYS`
  // de sempre (comparação lexicográfica de "YYYY-MM-DD" funciona direto
  // como comparação de data).
  const historyWindowStart = shiftDays(today, -(SPEND_PACE_HISTORY_WINDOW_DAYS + 1));
  const monthToDateWindowStart = startOfMonth(yesterday);
  const windowStart = historyWindowStart < monthToDateWindowStart ? historyWindowStart : monthToDateWindowStart;
  const nowIso = now.toISOString();

  const [clients, dailySpendRows, planChangeRows] = await Promise.all([
    requireQuery(supabase.from("clients").select("id, performance_goal").is("deleted_at", null), "clients:alerts-spend-pace"),
    requireQuery(
      supabase.from("daily_spend").select("client_id, channel, date, spend").gte("date", windowStart).lte("date", today),
      "daily_spend:alerts-spend-pace",
    ),
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("client_id, channel, month, changed_at, new_amount, target_result_count, result_type")
        .lte("month", startOfMonth(today)),
      "monthly_budget_changes:alerts-spend-pace",
    ),
  ]);

  const primaryGoalByClientId = new Map(clients.map((c) => [c.id, c.performance_goal]));
  const planChangesByClient = new Map<string, ClientPlanChangeRow[]>();
  for (const row of filterRowsToPrimaryGoal(planChangeRows, primaryGoalByClientId)) {
    const list = planChangesByClient.get(row.client_id) ?? [];
    list.push({ channel: row.channel as TrafficChannel, month: row.month, changedAt: row.changed_at, investment: row.new_amount, targetResultCount: row.target_result_count });
    planChangesByClient.set(row.client_id, list);
  }

  const spendByClientChannel = new Map<string, DailySpendPoint[]>();
  for (const row of dailySpendRows) {
    const key = `${row.client_id}::${row.channel}`;
    const list = spendByClientChannel.get(key) ?? [];
    list.push({ date: row.date, spend: row.spend });
    spendByClientChannel.set(key, list);
  }

  const summary: SpendPaceEvaluationSummary = { evaluated: 0, created: 0, updated: 0, resolved: 0, ignored: 0, skippedNoYesterdayData: 0, errors: [] };

  for (const [key, points] of spendByClientChannel) {
    const [clientId, channel] = key.split("::") as [string, TrafficChannel];
    const planChanges = planChangesByClient.get(clientId) ?? [];

    // Janela "full_day" (ontem) — nunca fabrica actualSpend se não houver
    // linha pra ontem (sincronização pode ter falhado, ver seção 5 do pedido).
    const yesterdayRow = points.find((p) => p.date === yesterday);
    if (!yesterdayRow) {
      summary.skippedNoYesterdayData++;
    } else {
      try {
        const outcome = await evaluateAndPersist(supabase, {
          clientId,
          channel,
          periodKind: "full_day",
          actualSpend: yesterdayRow.spend,
          evaluatedDate: yesterday,
          isPeriodInProgress: false,
          points,
          planChanges,
          nowIso,
        });
        bumpSummary(summary, outcome);
      } catch (err) {
        summary.errors.push({ clientId, channel, periodKind: "full_day", message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return summary;
}

function bumpSummary(summary: SpendPaceEvaluationSummary, outcome: "created" | "updated" | "resolved" | "ignored") {
  summary.evaluated++;
  summary[outcome]++;
}

async function evaluateAndPersist(
  supabase: AdminSupabase,
  input: {
    clientId: string;
    channel: TrafficChannel;
    periodKind: AlertPeriodKind;
    actualSpend: number;
    evaluatedDate: string;
    isPeriodInProgress: boolean;
    points: DailySpendPoint[];
    planChanges: ClientPlanChangeRow[];
    nowIso: string;
  },
): Promise<"created" | "updated" | "resolved" | "ignored"> {
  const { clientId, channel, periodKind, actualSpend, evaluatedDate, isPeriodInProgress, points, planChanges, nowIso } = input;

  const monthStart = startOfMonth(evaluatedDate);
  const monthEnd = endOfMonth(evaluatedDate);
  const plan = resolveClientMonthlyPlan({ channels: [channel], changes: planChanges, selectedMonth: monthStart });
  const monthlyBudget = plan.byChannel[channel]?.investment ?? null;
  const daysInMonth = listDatesInclusive(monthStart, monthEnd).length;

  const historyFloor = shiftDays(evaluatedDate, -SPEND_PACE_HISTORY_WINDOW_DAYS);
  const historicalDailySpends = points.filter((p) => p.date < evaluatedDate && p.date >= historyFloor).map((p) => p.spend);

  const reference = resolveDailySpendReference({ monthlyBudget, daysInMonth, historicalDailySpends });
  const candidate = detectSpendPaceAlert({
    actualSpend,
    periodStart: evaluatedDate,
    periodEnd: evaluatedDate,
    dailyReference: reference,
    isPeriodInProgress,
  });

  // Tela de Alertas (pedido do usuário): contexto de "mês até aqui" pra
  // triagem — nunca um critério de detecção/gravidade novo (esses
  // continuam só em `detectSpendPaceAlert`), só dado extra guardado em
  // `detail` pro card mostrar. `monthExpectedToDate` reaproveita a MESMA
  // função canônica de "Esperado até hoje" (`computeMonthlyExpectedToDateByCalendar`,
  // `lib/monthly-budget.ts`) usada pelo resto da plataforma — é
  // exatamente a "divisão simples do orçamento mensal pelos dias do mês",
  // por isso sempre estimativa quando vem dela; `null` quando não há
  // orçamento mensal configurado (nunca fabrica uma referência).
  if (candidate) {
    const monthActual = points
      .filter((p) => p.date >= monthStart && p.date <= evaluatedDate)
      .reduce((sum, p) => sum + p.spend, 0);
    const monthExpectedToDate =
      monthlyBudget !== null && monthlyBudget > 0
        ? computeMonthlyExpectedToDateByCalendar(monthlyBudget, { firstDay: monthStart, lastDay: monthEnd }, evaluatedDate).expectedToDate
        : null;
    candidate.detail = { ...candidate.detail, monthActual, monthExpectedToDate, monthlyBudget };
  }

  return persistAlertEvaluation(supabase, { clientId, channel, alertType: "spend_pace", periodKind }, candidate, nowIso);
}
