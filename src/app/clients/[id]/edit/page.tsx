import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClientManagerAccess } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { deleteClientAction, updateClientAction } from "../../actions";
import { Block, ClientForm } from "../../client-form";
import { DeleteClientButton } from "../../delete-client-button";
import { fetchGoalDisplaySummaries, listClientGoals } from "@/lib/client-goals";
import { listCampaignsForAssignment } from "@/lib/campaign-goal-assignments";
import { todayDateString } from "@/lib/today";
import { ClientGoalsSection } from "../../client-goals-section";

/**
 * Etapa "Simplificação do Cadastro do Cliente": este cadastro deixou de
 * carregar KPIs do Relatório Mensal e Cadência de Revisões — auditoria de
 * uso real confirmou os dois sem consumidor vivo relevante hoje:
 *
 * - "KPIs do Relatório Mensal" (`client_kpi_definitions`) alimentava um
 *   snapshot (`monthly_reports.snapshot`) que nenhuma tela lê mais — o
 *   Relatório Mensal de verdade (`/clients/[id]/relatorio`) usa um sistema
 *   de KPI totalmente diferente, calculado de dados de campanha.
 * - "Cadência de Revisões" (`account_review_cadences`) teve sua influência
 *   sobre saúde/prioridade operacional removida (`lib/account-health-engine.ts`,
 *   `lib/attention-alerts.ts`) — decisão de produto explícita ("a KOFF não
 *   usa mais Cadência de Revisões como processo operacional"). Sem UI pra
 *   configurar, essa cadência não podia continuar influenciando nada.
 *
 * Nenhuma tabela/coluna foi apagada — só as Server Actions de escrita que
 * ficaram genuinamente órfãs (`addClientKpiAction`/`deleteClientKpiAction`,
 * `report-actions.ts`; `updateAccountReviewCadenceAction`,
 * `account-review-actions.ts`) foram removidas, confirmado por busca
 * exaustiva de que não tinham mais nenhum chamador. `client_kpi_definitions`/
 * `account_review_cadences` continuam sendo LIDAS normalmente por quem já
 * as lia antes desta etapa.
 */
export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; return_to?: string }>;
}) {
  const { id } = await params;
  // Habilitar Gestores 3.0: Cadastro do Cliente deixou de ser admin-only —
  // o gestor responsável também pode editar. Etapa "Simplificação do
  // Cadastro do Cliente": "gestor de apoio" parou de conceder acesso — só
  // admin ou o GESTOR PRINCIPAL passam em `requireClientManagerAccess`
  // agora (ver `lib/auth.ts`). "Excluir cliente", abaixo, continua
  // restrito a admin (ação destrutiva, fora do pedido).
  const profile = await requireClientManagerAccess(id);
  const isAdmin = profile.role === "admin";
  const { error, return_to } = await searchParams;
  const returnTo = return_to && return_to.startsWith("/") ? return_to : `/clients/${id}`;

  const supabase = await createSupabaseClient();
  const [{ data: client }, allManagers, clientGoals, campaignsForAssignment, recentSprints] = await Promise.all([
    // `.single()` já conflita "cliente não encontrado" (RLS filtrou, ou id
    // inexistente) com "consulta falhou" — mesmo assim, distinção
    // deliberada e pré-existente (não é o bug de ignorar erro): aqui não
    // trocamos por `requireQuery`, senão um 404 legítimo viraria uma tela
    // de erro genérica.
    supabase.from("clients").select("*").eq("id", id).is("deleted_at", null).single(),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    listClientGoals(supabase, id),
    listCampaignsForAssignment(supabase, id, todayDateString()),
    // Sprints recentes (últimas 8) pro lançamento manual de resultado por
    // objetivo secundário (ex.: Seguidores) — reaproveita a sprint como
    // unidade do lançamento (ver goal-actions.ts), então o formulário
    // precisa oferecer qual sprint escolher.
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

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href={returnTo} className="text-sm text-zinc-500 hover:underline">
        &larr; Voltar
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-foreground">
        Cadastro do Cliente
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Identidade, canais e links deste cliente. Planejamento fica no Planejamento Mensal, performance nas telas
        de performance/relatório, acompanhamento na Operação.
      </p>

      <ClientForm
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
            recentSprints={(recentSprints ?? []).map((s) => ({ id: s.id, startDate: s.start_date, endDate: s.end_date }))}
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
