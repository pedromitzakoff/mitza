import {
  computeSprintEffectiveSpend,
  getSprintTemporalStatus,
  sumActualSpendForMonth,
  sumPlannedForMonth,
  type SpendSource,
} from "./sprint-financials";
import { computeSprintClosedSnapshot, type SprintClosedSnapshot, type SprintCalendarInput } from "./sprint-recommendation";
import { createClient as createSupabaseClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/** Um dia antes de `dateStr` (YYYY-MM-DD) — usado só pra achar o corte
 * "através do dia anterior ao início desta sprint" (ver
 * `computeSprintClosedSnapshot`), nunca reaproveitada fora daqui. */
function dayBefore(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export interface SprintSnapshotRow {
  id: string;
  start_date: string;
  end_date: string;
  spend_source: SpendSource;
  manual_actual_spend: number | null;
  original_planned_amount: number | null;
  final_recommended_amount: number | null;
  final_actual_amount: number | null;
  snapshot_frozen_at: string | null;
}

/**
 * Congela (lazy, na primeira leitura) o histórico financeiro de cada sprint
 * do mês que já encerrou e ainda não tem `snapshot_frozen_at` — Etapa 70,
 * seção 16: "se o sistema não possui um processo explícito de
 * encerramento, implementar uma estratégia idempotente e segura para criar
 * o snapshot na primeira execução após a sprint deixar de ser atual".
 *
 * Nunca escreve em sprint atual/futura (elas não têm nada pra congelar
 * ainda) nem regrava uma sprint já congelada — o guard `snapshot_frozen_at
 * is null` no UPDATE garante que mesmo duas requisições concorrentes lendo
 * a mesma sprint encerrada pela primeira vez só produzem uma escrita
 * vencedora, sem corromper nada (os dois cálculos são determinísticos e
 * chegariam ao mesmo resultado de qualquer forma).
 *
 * Devolve o snapshot resolvido (já congelado antes, ou recém-congelado
 * agora) de TODA sprint encerrada do mês — sprints atual/futura nunca
 * aparecem no mapa devolvido (não fazem parte deste conceito).
 */
export async function ensureClosedSprintSnapshots(
  supabase: Supabase,
  input: {
    clientId: string;
    today: Date;
    monthRange: { firstDay: string; lastDay: string };
    sprints: SprintSnapshotRow[];
    dailySpend: { date: string; spend: number }[];
    budgetChanges: { newAmount: number; changedAt: string }[];
    plannedAllocations: { date: string; amount: number }[];
    /** Orçamento mensal vigente AGORA (`resolveMonthlyBudget` sobre todas as
     * mudanças, sem filtro de data) — já calculado por quem chama, nunca
     * recalculado aqui. */
    currentMonthlyBudget: number;
  },
): Promise<Map<string, SprintClosedSnapshot>> {
  const { clientId, today, monthRange, sprints, dailySpend, budgetChanges, plannedAllocations, currentMonthlyBudget } = input;

  const allSprintsOfMonth: SprintCalendarInput[] = sprints.map((s) => ({
    sprintId: s.id,
    startDate: s.start_date,
    endDate: s.end_date,
  }));

  const result = new Map<string, SprintClosedSnapshot>();

  for (const row of sprints) {
    const temporalStatus = getSprintTemporalStatus({ start_date: row.start_date, end_date: row.end_date }, today);
    if (temporalStatus !== "concluida") continue;

    if (row.snapshot_frozen_at && row.original_planned_amount !== null && row.final_actual_amount !== null) {
      result.set(row.id, {
        originalPlannedAmount: row.original_planned_amount,
        finalRecommendedAmount: row.final_recommended_amount,
        finalActualAmount: row.final_actual_amount,
      });
      continue;
    }

    // Ainda não congelada — só congela se já existir alguma base de
    // orçamento (agora ou historicamente); sem isso, tudo ficaria zerado
    // sem sentido, então preferimos esperar a próxima leitura (nunca
    // congelar lixo — ver seção 5 do pedido original).
    if (currentMonthlyBudget <= 0) continue;

    const actualSpend = computeSprintEffectiveSpend(
      { start_date: row.start_date, end_date: row.end_date, spend_source: row.spend_source, manual_actual_spend: row.manual_actual_spend },
      dailySpend,
    );

    // "Através do fim desta sprint" (pro orçamento vigente/planejamento
    // original congelados, seção 15) — o mais recente conhecido enquanto ela
    // ainda estava aberta.
    const fallbackPlannedSumThroughSprintEnd = sumPlannedForMonth(
      plannedAllocations.map((a) => ({ date: a.date, sprintId: "", amount: a.amount })),
      { firstDay: monthRange.firstDay, lastDay: row.end_date },
    );

    // "Através do dia ANTERIOR ao início desta sprint" (pra recomendação
    // congelada — ver doc de `computeSprintClosedSnapshot` sobre por que o
    // corte é no início, não no fim, da própria sprint).
    const dayBeforeStart = dayBefore(row.start_date);
    const monthActualThroughSprintStart =
      dayBeforeStart < monthRange.firstDay
        ? 0
        : sumActualSpendForMonth(
            sprints.map((s) => ({
              start_date: s.start_date,
              end_date: s.end_date,
              spend_source: s.spend_source,
              manual_actual_spend: s.manual_actual_spend,
            })),
            { firstDay: monthRange.firstDay, lastDay: dayBeforeStart },
            dailySpend,
          );

    const snapshot = computeSprintClosedSnapshot({
      sprint: { sprintId: row.id, startDate: row.start_date, endDate: row.end_date, actualSpend },
      monthRange,
      allSprintsOfMonth,
      budgetChanges,
      fallbackPlannedSumThroughSprintEnd,
      currentMonthlyBudget,
      monthActualThroughSprintStart,
    });

    const { error } = await supabase
      .from("sprints")
      .update({
        original_planned_amount: snapshot.originalPlannedAmount,
        final_recommended_amount: snapshot.finalRecommendedAmount,
        final_actual_amount: snapshot.finalActualAmount,
        snapshot_frozen_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .is("snapshot_frozen_at", null);

    // Falha silenciosa: se o UPDATE não puder rodar (RLS, corrida perdida,
    // rede), a próxima leitura tenta de novo — nunca quebra a página por
    // conta de um congelamento que pode esperar. `clientId` só existe pra
    // manter o formato de log (`console.error`) informativo, nunca
    // filtrando a query (a UPDATE já filtra por `id`, único).
    if (error) {
      console.error(`[sprint-snapshot] falha ao congelar sprint ${row.id} do cliente ${clientId}:`, error.message);
    }

    result.set(row.id, snapshot);
  }

  return result;
}
