import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireClientManagerAccess } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { deleteClientAction, updateClientAction } from "../../actions";
import { ClientForm } from "../../client-form";
import { DeleteClientButton } from "../../delete-client-button";
import { AdminActionsMenu } from "../../admin-actions-menu";
import { ClientSettingsTabsProvider, ClientSettingsTabPanel } from "../../client-settings-tabs";
import { fetchGoalDisplaySummaries, listClientGoals } from "@/lib/client-goals";
import { listCampaignsForAssignment } from "@/lib/campaign-goal-assignments";
import { resolveClientMetaMappingSource, listActiveMetricMappingsByGoal } from "@/lib/client-metric-mapping-source";
import { resolveEffectiveDashboardMetrics } from "@/lib/dashboard-metrics";
import { todayDateString } from "@/lib/today";
import { ClientGoalsSection } from "../../client-goals-section";
import { DashboardMetricsSection } from "../../dashboard-metrics-section";

/**
 * "Configurações do cliente" (redesign de "Cadastro do Cliente", pedido
 * explícito do usuário) — 4 abas (Geral/Mídia/Métricas/Links) sobre os
 * MESMOS dados/Server Actions de sempre, nenhuma regra de negócio nova
 * além da confirmação de exclusão (ponto 3 do pedido, ver
 * `delete-client-button.tsx`). Cabeçalho próprio só com o que o cabeçalho
 * GLOBAL do workspace (`ClientWorkspaceHeader`, montado no `layout.tsx`
 * desta rota) ainda não mostra aqui — avatar/nome/status/"Informações da
 * conta" já vêm de lá; "Não duplicar o cabeçalho global existente" (pedido
 * explícito) é por isso que este cabeçalho é só: voltar, título da tela e,
 * pra admin, o menu administrativo (Excluir cliente).
 */
export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; return_to?: string }>;
}) {
  const { id } = await params;
  const profile = await requireClientManagerAccess(id);
  const isAdmin = profile.role === "admin";
  const { error, return_to } = await searchParams;
  const returnTo = return_to && return_to.startsWith("/") ? return_to : `/clients/${id}`;

  const supabase = await createSupabaseClient();
  const [{ data: client }, allManagers, clientGoals, campaignsForAssignment, recentSprints] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).is("deleted_at", null).single(),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    listClientGoals(supabase, id),
    listCampaignsForAssignment(supabase, id, todayDateString()),
    requireQuery(
      supabase
        .from("sprints")
        .select("id, start_date, end_date")
        .eq("client_id", id)
        .lte("start_date", todayDateString())
        .order("start_date", { ascending: false })
        .limit(8),
      "sprints:manual-goal-result",
    ),
  ]);

  if (!client) notFound();

  const goalSummaries = await fetchGoalDisplaySummaries(supabase, id, clientGoals, `${todayDateString().slice(0, 7)}-01`);

  const metaMappingSource = isAdmin ? await resolveClientMetaMappingSource(supabase, id) : null;
  const metaMappingsByGoal = metaMappingSource
    ? await listActiveMetricMappingsByGoal(supabase, metaMappingSource.importSourceId)
    : new Map();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={returnTo}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-overview-text-secondary hover:text-overview-text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Voltar
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-overview-text-primary">Configurações do cliente</h1>
          <p className="mt-0.5 text-sm text-overview-text-secondary">Identidade, mídia, métricas e links.</p>
        </div>

        {isAdmin && (
          <AdminActionsMenu>
            <DeleteClientButton action={deleteClientAction.bind(null, id)} clientName={client.name} />
          </AdminActionsMenu>
        )}
      </div>

      <div className="mt-6">
        <ClientSettingsTabsProvider showMetricsTab={isAdmin}>
          <ClientForm
            tabbed
            action={updateClientAction.bind(null, id, returnTo)}
            managers={allManagers ?? []}
            error={error}
            defaultName={client.name}
            defaultMetaAdAccountId={client.meta_ad_account_id}
            defaults={client}
            submitLabel="Salvar"
            cancelHref={returnTo}
          />

          {isAdmin && (
            <ClientSettingsTabPanel tab="metricas">
              {/* Ponto 2 do pedido (reforçado pelo usuário): Objetivos de
                  performance (com Eventos da Meta e Campanhas vinculadas por
                  dentro de cada card) e Indicadores exibidos continuam
                  Server Actions 100% independentes — só ganham um separador
                  visual + rótulo próprio aqui, nunca uma lógica unificada. */}
              <section className="flex flex-col gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-overview-text-primary">Objetivos de performance</h2>
                  <p className="mt-0.5 text-xs text-overview-text-secondary">
                    Como os resultados deste cliente são rastreados — inclui evento da Meta e campanhas vinculadas por
                    objetivo. Meta mensal é só leitura aqui; edite em Metas.
                  </p>
                </div>
                <ClientGoalsSection
                  clientId={id}
                  returnTo={`/clients/${id}/edit`}
                  goals={clientGoals}
                  summaries={goalSummaries}
                  campaigns={campaignsForAssignment}
                  recentSprints={(recentSprints ?? []).map((s) => ({ id: s.id, startDate: s.start_date, endDate: s.end_date }))}
                  metaMappingSource={metaMappingSource}
                  metaMappingsByGoal={metaMappingsByGoal}
                />
              </section>

              <section className="flex flex-col gap-3 border-t border-overview-border pt-6">
                <div>
                  <h2 className="text-sm font-semibold text-overview-text-primary">Indicadores exibidos no Dashboard</h2>
                  <p className="mt-0.5 text-xs text-overview-text-secondary">
                    O que aparece no Dashboard — nunca cria nem depende de um objetivo acima.
                  </p>
                </div>
                <DashboardMetricsSection
                  clientId={id}
                  returnTo={`/clients/${id}/edit`}
                  selected={resolveEffectiveDashboardMetrics(client.dashboard_metrics ?? [], client.performance_goal)}
                />
              </section>
            </ClientSettingsTabPanel>
          )}
        </ClientSettingsTabsProvider>
      </div>
    </div>
  );
}
