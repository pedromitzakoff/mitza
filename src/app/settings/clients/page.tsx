import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { CLIENT_STATUS_BADGE_CLASSES, CLIENT_STATUS_LABEL } from "@/lib/client-fields";
import type { ClientContractStatus } from "@/lib/supabase/database.types";

/**
 * Configurações > Clientes — cadastro e manutenção dos dados estruturais
 * (contrato, contatos, comercial, contexto estratégico). Diferente de
 * /clients (consulta operacional rápida, todo mundo acessa): esta tela é
 * só admin e não repete as métricas operacionais — nome, status
 * CONTRATUAL, gestor principal e os números comerciais básicos, com
 * "Editar" abrindo o formulário completo (reaproveitado de /clients/[id]/edit).
 */
export default async function SettingsClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const search = (params.search ?? "").trim().toLowerCase();
  const statusFilter = (params.status ?? "todos") as ClientContractStatus | "sem_gestor" | "todos";

  const supabase = await createSupabaseClient();
  const { data: clients } = await supabase
    .from("clients")
    .select(
      "id, name, status, contract_start_date, monthly_planned_spend, agency_monthly_fee, renewal_date, primary_manager_id, primary_manager:profiles!clients_primary_manager_id_fkey(name)",
    )
    .is("deleted_at", null)
    .order("name");

  let rows = clients ?? [];

  if (search) {
    rows = rows.filter((c) => c.name.toLowerCase().includes(search));
  }
  if (statusFilter === "sem_gestor") {
    rows = rows.filter((c) => !c.primary_manager_id);
  } else if (statusFilter !== "todos") {
    rows = rows.filter((c) => c.status === statusFilter);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Clientes</h1>
          <p className="text-xs text-muted-foreground">
            Cadastro e manutenção dos dados estruturais — consulta operacional rápida continua em{" "}
            <Link href="/clients" className="text-brand hover:underline">
              /clients
            </Link>
            .
          </p>
        </div>
        <Link
          href="/clients/new"
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
        >
          + Novo cliente
        </Link>
      </div>

      <form method="get" className="mt-4 flex flex-wrap items-center gap-1.5">
        <input
          name="search"
          defaultValue={search}
          placeholder="Buscar cliente..."
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none"
        />
        <select
          name="status"
          defaultValue={statusFilter}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
        >
          <option value="todos">Status: todos</option>
          <option value="ativo">Ativo</option>
          <option value="pausado">Pausado</option>
          <option value="encerrado">Encerrado</option>
          <option value="sem_gestor">Sem gestor principal</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-white hover:bg-brand-hover"
        >
          Filtrar
        </button>
        {(search || statusFilter !== "todos") && (
          <Link href="/settings/clients" className="text-xs text-brand hover:underline">
            Limpar filtros
          </Link>
        )}
      </form>

      <p className="mt-3 text-xs text-muted-foreground">
        {rows.length} cliente{rows.length !== 1 ? "s" : ""}
      </p>

      <div className="mt-2 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-muted-foreground dark:bg-zinc-900">
              <th className="px-3 py-1.5">Nome</th>
              <th className="px-3 py-1.5">Status</th>
              <th className="px-3 py-1.5">Gestor principal</th>
              <th className="px-3 py-1.5">Início</th>
              <th className="px-3 py-1.5">Invest. mensal planejado</th>
              <th className="px-3 py-1.5">Valor mensal da agência</th>
              <th className="px-3 py-1.5">Próxima renovação</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((client) => (
                <tr key={client.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-1.5 font-semibold text-foreground">{client.name}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CLIENT_STATUS_BADGE_CLASSES[client.status]}`}
                    >
                      {CLIENT_STATUS_LABEL[client.status]}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {client.primary_manager?.name ?? "Sem gestor principal"}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {client.contract_start_date ? formatShortDate(client.contract_start_date) : "—"}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                    {client.monthly_planned_spend !== null ? formatCurrency(client.monthly_planned_spend) : "—"}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                    {client.agency_monthly_fee !== null ? formatCurrency(client.agency_monthly_fee) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {client.renewal_date ? formatShortDate(client.renewal_date) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Link
                      href={`/clients/${client.id}/edit?return_to=${encodeURIComponent("/settings/clients")}`}
                      className="text-xs font-medium text-brand hover:underline"
                    >
                      Editar
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Nenhum cliente encontrado com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Clientes arquivados/excluídos ficam em{" "}
        <Link href="/settings/deleted-clients" className="text-brand hover:underline">
          Clientes excluídos
        </Link>
        .
      </p>
    </div>
  );
}
