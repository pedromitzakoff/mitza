import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { currentMonthRange, sumPlannedForMonth, type PlannedAllocationRow } from "@/lib/sprint-financials";
import {
  classifySpendStatus,
  SPEND_STATUS_BADGE_CLASSES,
  SPEND_STATUS_LABEL,
  SPEND_STATUS_MARGIN,
} from "@/lib/spend-status";
import { formatCurrency } from "@/lib/format";

export default async function PainelMensalPage() {
  await requireAdmin();

  const supabase = await createSupabaseClient();
  const { firstDay, lastDay } = currentMonthRange();

  const [{ data: clients }, { data: plannedAllocations }, { data: dailySpend }] = await Promise.all([
    supabase.from("clients").select("id, name").is("deleted_at", null).order("name"),
    // Soma direta das alocações diárias no intervalo do mês (Etapa 50) —
    // não mais `sprint.planned_spend` filtrando sprint por start_date, que
    // atribuía 100% de uma sprint que atravessa mês ao mês em que começou.
    supabase
      .from("sprint_planned_allocations")
      .select("client_id, date, planned_amount")
      .gte("date", firstDay)
      .lte("date", lastDay),
    supabase
      .from("daily_spend")
      .select("client_id, spend")
      .gte("date", firstDay)
      .lte("date", lastDay),
  ]);

  const allocationsByClient = new Map<string, PlannedAllocationRow[]>();
  for (const row of plannedAllocations ?? []) {
    const list = allocationsByClient.get(row.client_id) ?? [];
    list.push({ date: row.date, sprintId: "", amount: row.planned_amount });
    allocationsByClient.set(row.client_id, list);
  }
  const plannedByClient = new Map<string, number>();
  for (const [clientId, rows] of allocationsByClient) {
    plannedByClient.set(clientId, sumPlannedForMonth(rows, { firstDay, lastDay }));
  }

  const actualByClient = new Map<string, number>();
  for (const row of dailySpend ?? []) {
    actualByClient.set(row.client_id, (actualByClient.get(row.client_id) ?? 0) + row.spend);
  }

  const rows = (clients ?? []).map((client) => {
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
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                  Nenhum cliente cadastrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
