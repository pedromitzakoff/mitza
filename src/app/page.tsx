import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { todayUTC } from "@/lib/today";
import { businessDaysSince } from "@/lib/business-days";
import {
  classifyOperationalActivityStatus,
  formatLastActivityLabel,
  OPERATIONAL_ACTIVITY_STATUS_BADGE_CLASSES,
  OPERATIONAL_ACTIVITY_STATUS_LABEL,
  type OperationalActivityStatus,
} from "@/lib/operational-activity";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ activity?: string }>;
}) {
  const profile = await getCurrentProfile();

  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-6 text-center dark:bg-black">
        <p className="text-zinc-600 dark:text-zinc-400">
          Nenhum perfil encontrado para este usuário.
        </p>
      </div>
    );
  }

  const { activity: activityFilter = "todos" } = await searchParams;
  const today = todayUTC();

  const supabase = await createSupabaseClient();
  // RLS filtra automaticamente: admin vê todos os clientes, gestor só os
  // que aparecem em client_managers para o seu usuário.
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id")
    .is("deleted_at", null)
    .order("name");

  const clientIds = (clients ?? []).map((c) => c.id);
  const { data: activityRows } =
    clientIds.length > 0
      ? await supabase
          .from("client_last_operational_activity")
          .select("client_id, last_activity_at")
          .in("client_id", clientIds)
      : { data: [] };

  const activityByClient = new Map((activityRows ?? []).map((r) => [r.client_id, r.last_activity_at]));

  let clientRows = (clients ?? []).map((client) => {
    const lastActivityAt = activityByClient.get(client.id) ?? null;
    const lastActivityDate = lastActivityAt ? new Date(lastActivityAt) : null;
    const businessDays = lastActivityDate ? businessDaysSince(lastActivityDate, today) : null;
    const activityStatus: OperationalActivityStatus = classifyOperationalActivityStatus(businessDays);
    const activityLabel = formatLastActivityLabel(lastActivityDate, today);
    return { ...client, activityStatus, activityLabel };
  });

  if (activityFilter !== "todos") {
    clientRows = clientRows.filter((c) => c.activityStatus === activityFilter);
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Mitza
          </h1>
          <p className="text-sm text-zinc-500">
            {profile.name} · {profile.role}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/operation" className="text-sm font-medium text-brand hover:underline">
            Operação
          </Link>
          {profile.role === "admin" && (
            <>
              <Link href="/painel-mensal" className="text-sm font-medium text-brand hover:underline">
                Painel geral do mês
              </Link>
              <Link href="/settings" className="text-sm font-medium text-brand hover:underline">
                Configurações
              </Link>
            </>
          )}
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              Sair
            </button>
          </form>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-black dark:text-zinc-50">Clientes</h2>
        <div className="flex items-center gap-2">
          <form method="get" className="flex items-center gap-2">
            <select
              name="activity"
              defaultValue={activityFilter}
              className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm text-black dark:border-zinc-700 dark:text-zinc-50"
            >
              <option value="todos">Atividade: todas</option>
              <option value="ativo">Ativos</option>
              <option value="atencao">Atenção por inatividade</option>
              <option value="inativo">Inativos</option>
            </select>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              Filtrar
            </button>
          </form>
          {profile.role === "admin" && (
            <Link
              href="/clients/new"
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
            >
              + Novo cliente
            </Link>
          )}
        </div>
      </div>

      <ul className="mt-4 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {clientRows.length > 0 ? (
          clientRows.map((client) => (
            <li key={client.id}>
              <Link
                href={`/clients/${client.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="min-w-0 truncate font-medium text-brand">
                  {client.name}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-zinc-500">{client.activityLabel}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${OPERATIONAL_ACTIVITY_STATUS_BADGE_CLASSES[client.activityStatus]}`}
                  >
                    {OPERATIONAL_ACTIVITY_STATUS_LABEL[client.activityStatus]}
                  </span>
                  <span className="font-mono text-xs text-zinc-500">{client.meta_ad_account_id}</span>
                </span>
              </Link>
            </li>
          ))
        ) : (
          <li className="px-4 py-6 text-center text-sm text-zinc-500">
            Nenhum cliente encontrado.
          </li>
        )}
      </ul>
    </div>
  );
}
