import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { deleteClientAction, updateClientAction } from "../../actions";
import { ClientForm } from "../../client-form";
import { DeleteClientButton } from "../../delete-client-button";
import { Section } from "../../section";
import { addClientKpiAction, deleteClientKpiAction } from "@/app/reports/report-actions";
import { KPI_DIRECTION_LABEL, KPI_UNIT_LABEL, formatKpiValue } from "@/lib/monthly-reports";
import { updateAccountReviewCadenceAction } from "../../account-review-actions";

export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; return_to?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { error, return_to } = await searchParams;
  const returnTo = return_to && return_to.startsWith("/") ? return_to : `/clients/${id}`;

  const supabase = await createSupabaseClient();
  const [{ data: client }, { data: allManagers }, { data: assigned }, { data: kpis }, { data: cadence }] =
    await Promise.all([
      supabase.from("clients").select("*").eq("id", id).is("deleted_at", null).single(),
      supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"),
      supabase.from("client_managers").select("user_id, team_members(id, name)").eq("client_id", id),
      supabase.from("client_kpi_definitions").select("*").eq("client_id", id).order("display_order"),
      supabase
        .from("account_review_cadences")
        .select("reviews_per_week, max_business_days_without_review, is_active")
        .eq("client_id", id)
        .maybeSingle(),
    ]);

  if (!client) notFound();

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href={returnTo} className="text-sm text-zinc-500 hover:underline">
        &larr; Voltar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-black dark:text-zinc-50">
        Editar cliente
      </h1>

      <ClientForm
        action={updateClientAction.bind(null, id, returnTo)}
        managers={allManagers ?? []}
        assignedIds={assigned?.map((a) => a.user_id) ?? []}
        error={error}
        defaultName={client.name}
        defaultMetaAdAccountId={client.meta_ad_account_id}
        defaults={client}
        submitLabel="Salvar"
        cancelHref={returnTo}
      />

      <Section title="KPIs do Relatório Mensal">
        <p className="mb-3 text-xs text-zinc-500">
          Controla quais KPIs aparecem no Bloco 2 (Performance) do Relatório Mensal deste cliente. &ldquo;Menor é
          melhor&rdquo; serve pra métricas de custo (CPL, CPA); &ldquo;Maior é melhor&rdquo; pra Leads, ROAS, Vendas etc.
        </p>

        {(kpis ?? []).length > 0 && (
          <ul className="mb-3 flex flex-col gap-1.5">
            {(kpis ?? []).map((kpi) => (
              <li
                key={kpi.id}
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-800"
              >
                <span className="text-black dark:text-zinc-50">
                  {kpi.name}
                  <span className="ml-2 text-xs text-zinc-500">
                    {KPI_UNIT_LABEL[kpi.unit]} · {KPI_DIRECTION_LABEL[kpi.direction]}
                    {kpi.target !== null ? ` · meta ${formatKpiValue(kpi.target, kpi.unit)}` : ""}
                  </span>
                </span>
                <form action={deleteClientKpiAction.bind(null, kpi.id, id)}>
                  <button type="submit" className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400">
                    Remover
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form action={addClientKpiAction.bind(null, id)} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Nome</label>
            <input
              name="name"
              required
              placeholder="Ex.: CPL"
              className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm text-black dark:border-zinc-700 dark:text-zinc-50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Unidade</label>
            <select name="unit" defaultValue="numero" className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm text-black dark:border-zinc-700 dark:text-zinc-50">
              {Object.entries(KPI_UNIT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Direção</label>
            <select name="direction" defaultValue="maior_melhor" className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm text-black dark:border-zinc-700 dark:text-zinc-50">
              {Object.entries(KPI_DIRECTION_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Meta (opcional)</label>
            <input
              type="number"
              step="0.01"
              name="target"
              className="w-28 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm text-black dark:border-zinc-700 dark:text-zinc-50"
            />
          </div>
          <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">
            Adicionar KPI
          </button>
        </form>
      </Section>

      <Section title="Cadência de Revisões de conta">
        <p className="mb-3 text-xs text-zinc-500">
          Meta de frequência semanal e intervalo máximo tolerado sem revisão — nunca uma data fixa, só uma
          referência pra &ldquo;Revisões de conta&rdquo; na página do cliente.
        </p>
        <form
          action={updateAccountReviewCadenceAction.bind(null, id, returnTo)}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Revisões por semana</label>
            <input
              type="number"
              name="reviews_per_week"
              min={1}
              defaultValue={cadence?.reviews_per_week ?? 3}
              className="w-24 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm text-black dark:border-zinc-700 dark:text-zinc-50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Máx. dias úteis sem otimização</label>
            <input
              type="number"
              name="max_business_days_without_review"
              min={1}
              defaultValue={cadence?.max_business_days_without_review ?? 3}
              className="w-24 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm text-black dark:border-zinc-700 dark:text-zinc-50"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-black dark:text-zinc-50">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked={cadence?.is_active ?? true}
              className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
            />
            Cadência ativa
          </label>
          <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">
            Salvar cadência
          </button>
        </form>
      </Section>

      <Section title="Excluir cliente">
        <p className="mb-3 text-xs text-zinc-500">
          O cliente some das listagens e para de sincronizar com o Meta, mas sprints, tarefas e
          comentários ficam preservados. Dá pra restaurar depois em Configurações &gt; Clientes
          excluídos.
        </p>
        <DeleteClientButton action={deleteClientAction.bind(null, id)} />
      </Section>
    </div>
  );
}
