import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClientManagerAccess } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { deleteClientAction, updateClientAction } from "../../actions";
import { Block, ClientForm } from "../../client-form";
import { DeleteClientButton } from "../../delete-client-button";
import { addClientKpiAction, deleteClientKpiAction } from "@/app/reports/report-actions";
import { KPI_DIRECTION_LABEL, KPI_UNIT_LABEL, formatKpiValue } from "@/lib/monthly-reports";
import { updateAccountReviewCadenceAction } from "../../account-review-actions";
import { SubmitButton } from "@/app/submit-button";
import { fetchGoalDisplaySummaries, listClientGoals } from "@/lib/client-goals";
import { listCampaignsForAssignment } from "@/lib/campaign-goal-assignments";
import { todayDateString } from "@/lib/today";
import { ClientGoalsSection } from "../../client-goals-section";

export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; return_to?: string }>;
}) {
  const { id } = await params;
  // Habilitar Gestores 3.0: Cadastro do Cliente deixou de ser admin-only —
  // o gestor responsável (principal ou de apoio, mesmo critério de
  // `is_client_manager()` no RLS) também pode editar. "Excluir cliente",
  // abaixo, continua restrito a admin (ação destrutiva, fora do pedido).
  const profile = await requireClientManagerAccess(id);
  const isAdmin = profile.role === "admin";
  const { error, return_to } = await searchParams;
  const returnTo = return_to && return_to.startsWith("/") ? return_to : `/clients/${id}`;

  const supabase = await createSupabaseClient();
  const [{ data: client }, allManagers, assigned, kpis, cadence, clientGoals, campaignsForAssignment] = await Promise.all([
    // `.single()` já conflita "cliente não encontrado" (RLS filtrou, ou id
    // inexistente) com "consulta falhou" — mesmo assim, distinção
    // deliberada e pré-existente (não é o bug de ignorar erro): aqui não
    // trocamos por `requireQuery`, senão um 404 legítimo viraria uma tela
    // de erro genérica.
    supabase.from("clients").select("*").eq("id", id).is("deleted_at", null).single(),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    requireQuery(
      supabase.from("client_managers").select("user_id, team_members(id, name)").eq("client_id", id),
      "client_managers",
    ),
    requireQuery(
      supabase.from("client_kpi_definitions").select("*").eq("client_id", id).order("display_order"),
      "client_kpi_definitions",
    ),
    requireQuery<{ reviews_per_week: number; max_business_days_without_review: number; is_active: boolean } | null>(
      supabase
        .from("account_review_cadences")
        .select("reviews_per_week, max_business_days_without_review, is_active")
        .eq("client_id", id)
        .maybeSingle(),
      "account_review_cadences",
    ),
    listClientGoals(supabase, id),
    listCampaignsForAssignment(supabase, id, todayDateString()),
  ]);

  if (!client) notFound();

  const goalSummaries = await fetchGoalDisplaySummaries(supabase, id, clientGoals, `${todayDateString().slice(0, 7)}-01`);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href={returnTo} className="text-sm text-zinc-500 hover:underline">
        &larr; Voltar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-foreground">
        Cadastro do Cliente
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Ficha administrativa deste cliente — identidade, configurações operacionais, integrações
        e situação contratual. O trabalho do dia a dia acontece no Prontuário.
      </p>

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

      <Block
        title="Configurações Operacionais"
        description="KPIs do Relatório Mensal e cadência de revisões — ficam aqui à parte por serem salvos separadamente do restante do cadastro."
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">KPIs do Relatório Mensal</p>
          <p className="text-xs text-zinc-500">
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
                  <SubmitButton
                    pendingChildren="Removendo..."
                    className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
                  >
                    Remover
                  </SubmitButton>
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
          <SubmitButton
            pendingChildren="Adicionando..."
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
          >
            Adicionar KPI
          </SubmitButton>
        </form>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">Cadência de Revisões de conta</p>
          <p className="text-xs text-zinc-500">
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
          <SubmitButton
            pendingChildren="Salvando..."
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
          >
            Salvar cadência
          </SubmitButton>
        </form>
        </div>
      </Block>

      {isAdmin && (
        <Block
          title="Objetivos da conta"
          description="Um cliente pode ter mais de um objetivo de performance ao mesmo tempo (ex.: Leads + Seguidores). Cada objetivo tem sua própria meta, canais e campanhas classificadas — o custo por resultado só é calculado quando há investimento real e atribuível às campanhas daquele objetivo."
        >
          <ClientGoalsSection
            clientId={id}
            returnTo={`/clients/${id}/edit`}
            goals={clientGoals}
            summaries={goalSummaries}
            campaigns={campaignsForAssignment}
          />
        </Block>
      )}

      {isAdmin && (
        <Block title="Administração" description="Ações administrativas sobre este cliente.">
          <div className="flex flex-col gap-3">
            <p className="text-xs text-zinc-500">
              O cliente some das listagens e para de sincronizar com o Meta, mas sprints, tarefas e
              comentários ficam preservados. Dá pra restaurar depois em Configurações &gt; Clientes
              excluídos.
            </p>
            <DeleteClientButton action={deleteClientAction.bind(null, id)} />
          </div>
        </Block>
      )}
    </div>
  );
}
