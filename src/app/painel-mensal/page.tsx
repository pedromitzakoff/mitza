import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { currentMonthRange, sumPlannedForMonth, type PlannedAllocationRow } from "@/lib/sprint-financials";
import {
  classifySpendStatus,
  SPEND_STATUS_BADGE_CLASSES,
  SPEND_STATUS_LABEL,
  SPEND_STATUS_MARGIN,
} from "@/lib/spend-status";
import { formatCurrency } from "@/lib/format";
import { resolveConsolidatedMonthlyPlanned } from "@/lib/client-plan";
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";

export default async function PainelMensalPage() {
  await requireAdmin();

  const supabase = await createSupabaseClient();
  const { firstDay, lastDay } = currentMonthRange();

  const [clients, plannedAllocations, dailySpend, budgetChanges] = await Promise.all([
    requireQuery(
      supabase
        .from("clients")
        .select("id, name")
        .is("deleted_at", null)
        .eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS)
        .order("name"),
      "clients",
    ),
    // Soma direta das alocações diárias no intervalo do mês (Etapa 50) —
    // usada só como fallback do orçamento vigente (ver resolveMonthlyBudget).
    requireQuery(
      supabase
        .from("sprint_planned_allocations")
        .select("client_id, date, planned_amount")
        .gte("date", firstDay)
        .lte("date", lastDay),
      "sprint_planned_allocations",
    ),
    requireQuery(
      supabase.from("daily_spend").select("client_id, spend").gte("date", firstDay).lte("date", lastDay),
      "daily_spend",
    ),
    // Etapa 66: orçamento mensal VIGENTE — nunca mais a soma das alocações
    // diárias persistidas (ver resolveConsolidatedMonthlyPlanned). Etapa
    // "Migração Multicanal dos Consumidores": todos os canais (nunca mais só
    // `channel = 'meta'`) — consolidado real (Meta + Google com plano).
    requireQuery(
      supabase.from("monthly_budget_changes").select("client_id, channel, month, new_amount, changed_at").eq("month", firstDay),
      "monthly_budget_changes",
    ),
  ]);

  const allocationsByClient = new Map<string, PlannedAllocationRow[]>();
  for (const row of plannedAllocations) {
    const list = allocationsByClient.get(row.client_id) ?? [];
    list.push({ date: row.date, sprintId: "", amount: row.planned_amount });
    allocationsByClient.set(row.client_id, list);
  }
  const budgetChangesByClient = new Map<string, { channel: TrafficChannel; month: string; changedAt: string; investment: number }[]>();
  for (const row of budgetChanges) {
    const list = budgetChangesByClient.get(row.client_id) ?? [];
    list.push({ channel: row.channel as TrafficChannel, month: row.month, changedAt: row.changed_at, investment: row.new_amount });
    budgetChangesByClient.set(row.client_id, list);
  }

  const plannedByClient = new Map<string, number>();
  for (const client of clients) {
    const rows = allocationsByClient.get(client.id) ?? [];
    plannedByClient.set(
      client.id,
      resolveConsolidatedMonthlyPlanned(
        AVAILABLE_TRAFFIC_CHANNELS,
        budgetChangesByClient.get(client.id) ?? [],
        firstDay,
        sumPlannedForMonth(rows, { firstDay, lastDay }),
      ),
    );
  }

  const actualByClient = new Map<string, number>();
  for (const row of dailySpend) {
    actualByClient.set(row.client_id, (actualByClient.get(row.client_id) ?? 0) + row.spend);
  }

  const rows = clients.map((client) => {
    const planned = plannedByClient.get(client.id) ?? 0;
    const actual = actualByClient.get(client.id) ?? 0;
    const status = classifySpendStatus(actual, planned, planned);
    const pct = planned > 0 ? (actual / planned) * 100 : null;

    return { id: client.id, name: client.name, planned, actual, pct, status };
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Painel geral do mês
      </h1>
      <p className="text-sm text-zinc-500">
        Margem de tolerância: ±{SPEND_STATUS_MARGIN * 100}% do planejado.
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Planejado</th>
              <th className="px-4 py-3">Gasto</th>
              <th className="px-4 py-3">% atingido</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <Link href={`/clients/${row.id}`} className="font-medium text-brand hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                    {formatCurrency(row.planned)}
                  </td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                    {formatCurrency(row.actual)}
                  </td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                    {row.pct === null ? "—" : `${row.pct.toFixed(0)}%`}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${SPEND_STATUS_BADGE_CLASSES[row.status]}`}
                    >
                      {SPEND_STATUS_LABEL[row.status]}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center">
                  <EmptyState>Nenhum cliente cadastrado ainda.</EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
