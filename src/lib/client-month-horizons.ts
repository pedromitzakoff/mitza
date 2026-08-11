import type { createClient as createSupabaseClient } from "./supabase/server";
import { requireQuery } from "./require-query";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Camada de acesso a `client_month_horizons` (Etapa "Horizonte de
 * Planejamento") — nunca faz cálculo (isso é sempre `resolvePlanningHorizon`,
 * lib/monthly-budget.ts), só resolve "qual é a `planning_end_date` cadastrada
 * pra este cliente neste mês". `month` é sempre o primeiro dia do mês
 * (`YYYY-MM-01`), mesmo formato de `monthRange.firstDay`.
 */

/** Batch — mesmo padrão de `dailySpend`/`tasks`/`budgetChanges` já usado em
 * páginas com vários clientes (Dashboard, Sprints, Operação, Painel Mensal):
 * uma query só pro recorte inteiro, nunca uma por cliente. Cliente sem linha
 * cadastrada simplesmente não aparece no mapa — o chamador trata ausência
 * como `null` (`resolvePlanningHorizon` já espera isso). */
export async function getClientMonthHorizons(
  supabase: Supabase,
  clientIds: string[],
  month: string,
): Promise<Map<string, string | null>> {
  if (clientIds.length === 0) return new Map();

  const rows = await requireQuery(
    supabase.from("client_month_horizons").select("client_id, planning_end_date").eq("month", month).in("client_id", clientIds),
    "client_month_horizons",
  );

  return new Map(rows.map((row) => [row.client_id, row.planning_end_date]));
}

/** Versão de UM cliente só — telas que já operam num cliente específico
 * (página do cliente, Relatório) não precisam do batch acima. */
export async function getClientMonthHorizon(supabase: Supabase, clientId: string, month: string): Promise<string | null> {
  const rows = await requireQuery(
    supabase.from("client_month_horizons").select("planning_end_date").eq("client_id", clientId).eq("month", month),
    "client_month_horizons:single",
  );
  return rows[0]?.planning_end_date ?? null;
}
