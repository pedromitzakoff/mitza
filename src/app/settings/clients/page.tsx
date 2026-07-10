import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC } from "@/lib/today";
import { formatActiveMonths, formatDateWithYear } from "@/lib/format";
import { normalizeCnpj } from "@/lib/cnpj";
import type { ClientContractStatus } from "@/lib/supabase/database.types";
import {
  updateClientCnpjAction,
  updateClientContractStartAction,
  updateClientEmailAction,
  updateClientMonthlyFeeAction,
  updateClientPrimaryManagerAction,
  updateClientStatusAction,
} from "./actions";
import {
  InlineCnpjCell,
  InlineDateCell,
  InlineEmailCell,
  InlineMoneyCell,
  InlineSelectCell,
  InlineStatusCell,
} from "./inline-cell";
import { SettingsClientsFilters } from "./filters";

/**
 * Configurações > Clientes — manutenção eficiente dos dados estruturais:
 * status, gestor principal, início de contrato, CNPJ, e-mail e mensalidade
 * editáveis direto na tabela (clique na célula, Enter salva, Escape
 * cancela). Diferente de /clients (consulta operacional, todo mundo
 * acessa): esta tela é só admin e cobre exatamente os campos cadastrais
 * cobrados — nome só é editável na edição completa (evita alteração
 * acidental do identificador principal do cliente).
 */
export default async function SettingsClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const search = (params.search ?? "").trim().toLowerCase();
  const searchCnpjDigits = normalizeCnpj(search);
  const statusFilter = (params.status ?? "todos") as ClientContractStatus | "sem_gestor" | "todos";
  const today = todayUTC();

  const supabase = await createSupabaseClient();
  const [{ data: clients }, { data: managers }] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "id, name, status, contract_start_date, primary_manager_id, cnpj, main_contact_email, agency_monthly_fee, primary_manager:profiles!clients_primary_manager_id_fkey(name)",
      )
      .is("deleted_at", null)
      .order("name"),
    supabase.from("profiles").select("id, name").eq("role", "gestor").order("name"),
  ]);

  let rows = clients ?? [];

  if (search) {
    rows = rows.filter((c) => {
      const matchesName = c.name.toLowerCase().includes(search);
      const matchesEmail = (c.main_contact_email ?? "").toLowerCase().includes(search);
      const matchesCnpj = searchCnpjDigits.length > 0 && (c.cnpj ?? "").includes(searchCnpjDigits);
      return matchesName || matchesEmail || matchesCnpj;
    });
  }
  if (statusFilter === "sem_gestor") {
    rows = rows.filter((c) => !c.primary_manager_id);
  } else if (statusFilter !== "todos") {
    rows = rows.filter((c) => c.status === statusFilter);
  }

  const managerOptions = (managers ?? []).map((m) => ({ value: m.id, label: m.name }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Clientes</h1>
          <p className="text-xs text-muted-foreground">
            Manutenção dos dados cadastrais — consulta operacional rápida continua em{" "}
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

      <SettingsClientsFilters search={search} status={statusFilter} />

      <p className="mt-3 text-xs text-muted-foreground">
        {rows.length} cliente{rows.length !== 1 ? "s" : ""}
      </p>

      <div className="mt-2 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-muted-foreground dark:bg-zinc-900">
              <th className="px-3 py-1.5">Cliente</th>
              <th className="px-3 py-1.5">Status</th>
              <th className="px-3 py-1.5">Gestor principal</th>
              <th className="px-3 py-1.5">Início do contrato</th>
              <th className="px-3 py-1.5">Tempo ativo</th>
              <th className="hidden px-3 py-1.5 lg:table-cell">CNPJ</th>
              <th className="hidden px-3 py-1.5 lg:table-cell">E-mail</th>
              <th className="px-3 py-1.5">Mensalidade</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((client) => (
                <tr key={client.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-1.5 font-semibold text-foreground">{client.name}</td>

                  <td className="px-3 py-1.5">
                    <InlineStatusCell value={client.status} action={updateClientStatusAction.bind(null, client.id)} />
                  </td>

                  <td className="px-3 py-1.5 text-muted-foreground">
                    <InlineSelectCell
                      value={client.primary_manager_id ?? ""}
                      options={managerOptions}
                      emptyLabel="Sem gestor principal"
                      action={updateClientPrimaryManagerAction.bind(null, client.id)}
                      ariaLabel="Gestor principal"
                    />
                  </td>

                  <td className="px-3 py-1.5 text-muted-foreground">
                    <InlineDateCell
                      value={client.contract_start_date}
                      action={updateClientContractStartAction.bind(null, client.id)}
                      ariaLabel="Início do contrato"
                      format={formatDateWithYear}
                    />
                  </td>

                  <td className="px-3 py-1.5 text-muted-foreground">
                    {formatActiveMonths(client.contract_start_date, today)}
                  </td>

                  <td className="hidden px-3 py-1.5 text-muted-foreground lg:table-cell">
                    <InlineCnpjCell value={client.cnpj} action={updateClientCnpjAction.bind(null, client.id)} />
                  </td>

                  <td className="hidden px-3 py-1.5 text-muted-foreground lg:table-cell">
                    <InlineEmailCell
                      value={client.main_contact_email}
                      action={updateClientEmailAction.bind(null, client.id)}
                    />
                  </td>

                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                    <InlineMoneyCell
                      value={client.agency_monthly_fee}
                      action={updateClientMonthlyFeeAction.bind(null, client.id)}
                    />
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
                <td colSpan={9} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Nenhum cliente encontrado com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground lg:hidden">
        CNPJ e e-mail ficam disponíveis em telas maiores ou na edição completa (&ldquo;Editar&rdquo;).
      </p>

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
