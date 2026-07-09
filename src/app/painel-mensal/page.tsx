import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { currentMonthRange } from "@/lib/sprint-financials";
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

  const [{ data: clients }, { data: sprints }, { data: dailySpend }] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase
      .from("sprints")
      .select("client_id, planned_spend")
      .gte("start_date", firstDay)
      .lte("start_date", lastDay),
    supabase
      .from("daily_spend")
      .select("client_id, spend")
      .gte("date", firstDay)
      .lte("date", lastDay),
  ]);

  const plannedByClient = new Map<string, number>();
  for (const sprint of sprints ?? []) {
    plannedByClient.set(
      sprint.client_id,
      (plannedByClient.get(sprint.client_id) ?? 0) + sprint.planned_spend,
    );
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
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        &larr; Voltar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-black dark:text-zinc-50">
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
                    <Link href={`/clients/${row.id}`} className="text-black hover:underline dark:text-zinc-50">
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
