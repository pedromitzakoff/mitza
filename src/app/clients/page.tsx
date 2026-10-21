import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { todayUTC } from "@/lib/today";
import { currentMonthRange, sumActualSpendForMonth, sumPlannedForMonth } from "@/lib/sprint-financials";
import { computeMonthProjectionForRange } from "@/lib/client-metrics";
import { resolvePlanningHorizon } from "@/lib/monthly-budget";
import { formatCurrency, formatRelationshipDuration } from "@/lib/format";
import { getClientMonthHorizons } from "@/lib/client-month-horizons";
import { CLIENT_STATUS_BADGE_CLASSES, CLIENT_STATUS_LABEL } from "@/lib/client-fields";
import type { ClientContractStatus } from "@/lib/supabase/database.types";
import { groupChannelSpendBySprintId } from "@/lib/channel-spend";
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { resolveManualActualSpend } from "@/lib/effective-spend";
import { filterRowsToPrimaryGoal, resolveConsolidatedMonthlyPlanned } from "@/lib/client-plan";
import { ClientsFilters } from "./clients-filters";
import { AgencyAccountsTree } from "../agency-accounts-tree";

/**
 * `/clients` — Etapa "MEGA FACELIFT — Fase 4.5: Navegação da Carteira":
 * vira a casa oficial da pergunta "qual cliente quero abrir ou
 * administrar?", substituindo o papel que a árvore "Contas da Agência"
 * cumpria sozinha dentro da Sidebar (seção 4/5 do pedido). A listagem em
 * si (nome, status contratual, tempo de relacionamento, projeção do mês,
 * gestor principal, busca/filtro por gestor/status) já existia desde antes
 * desta fase — auditoria confirmou que já cobria quase tudo pedido, só
 * precisando de cabeçalho/contexto novos. Não duplica as métricas
 * completas do Dashboard: é só um diretório pra achar e abrir um cliente
 * rápido — a projeção do mês usa só `monthPlanned`/`monthActual`
 * (`resolveConsolidatedMonthlyPlanned`/`sumActualSpendForMonth`, as mesmas
 * funções analíticas do Cockpit).
 *
 * Agrupamento por gestor (seção 7 do pedido): mantido como LISTA ÚNICA +
 * filtro "Gestor" (opção A do pedido, já existente) — nunca um
 * agrupamento visual que obrigue navegar por pastas (era exatamente o
 * problema da árvore antiga); a busca já funciona transversalmente, sem
 * depender de abrir pasta nenhuma.
 *
 * "Organizar carteira" (seção 8 do pedido — wallet_position/drag-and-drop):
 * a mesma árvore "Contas da Agência" de sempre (`AgencyAccountsTree`,
 * busca + agrupamento por gestor + arrastar pra reordenar/transferir),
 * agora realocada pra aqui — NENHUMA linha da lógica de persistência
 * (`agency-accounts-tree-actions.ts`/`agency-wallet-position.ts`) foi
 * reescrita, só o lugar onde o componente aparece. Fica dentro de um
 * `<details>` recolhível (mesmo padrão já usado pra "Configurar funis" em
 * Performance) — é organização, não o fluxo principal desta tela. Mantém
 * a superfície `bg-sidebar-surface` original (o componente foi desenhado
 * contra ela) num card próprio, em vez de herdar o fundo branco da
 * página — nenhuma cor nova, só o token que ele já usava.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; manager?: string; status?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const isAdmin = profile.role === "admin";
  const params = await searchParams;
  const search = (params.search ?? "").trim().toLowerCase();
  const managerFilter = params.manager ?? "all";
  const statusFilter = (params.status ?? "todos") as ClientContractStatus | "todos";

  const today = todayUTC();
  const { firstDay, lastDay } = currentMonthRange(today);

  const supabase = await createSupabaseClient();

  const [clients, gestores, sprints, dailySpend, plannedAllocations, budgetChanges, channelSpendRows] = await Promise.all([
    requireQuery(
      supabase
        .from("clients")
        .select(
          "id, name, meta_ad_account_id, status, contract_start_date, performance_goal, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)",
        )
        .is("deleted_at", null)
        .order("name"),
      "clients",
    ),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    // Sobreposição com o mês (não "começa no mês") — sprint que atravessa
    // mês precisa ser encontrada mesmo com start_date do mês anterior.
    requireQuery(
      supabase
        .from("sprints")
        .select("id, client_id, start_date, end_date, planned_spend, spend_source, manual_actual_spend")
        .lte("start_date", lastDay)
        .gte("end_date", firstDay),
      "sprints",
    ),
    requireQuery(
      supabase
        .from("daily_spend")
        .select("client_id, date, spend, synced_at")
        .gte("date", firstDay)
        .lte("date", lastDay),
      "daily_spend",
    ),
    requireQuery(
      supabase
        .from("sprint_planned_allocations")
        .select("client_id, sprint_id, date, planned_amount")
        .gte("date", firstDay)
        .lte("date", lastDay),
      "sprint_planned_allocations",
    ),
    // Etapa "Migração Multicanal dos Consumidores": todos os canais (nunca
    // mais só `channel = 'meta'`) — `resolveConsolidatedMonthlyPlanned`
    // soma os canais com plano. Fase 1 "Confiabilidade dos Dados" — bug
    // confirmado: `.eq` excluía clientes cujo orçamento vigente foi
    // definido num mês anterior (sem mudança neste mês) — `.lte` traz o
    // histórico completo, `resolveConsolidatedMonthlyPlanned` reduz à
    // versão vigente por canal.
    requireQuery(
      supabase.from("monthly_budget_changes").select("client_id, channel, month, new_amount, changed_at, result_type").lte("month", firstDay),
      "monthly_budget_changes",
    ),
    // Investimento manual multicanal (`sprint_channel_spend`, adotada como
    // fonte de verdade — ver `resolveManualActualSpend`, lib/effective-spend.ts).
    requireQuery(
      supabase.from("sprint_channel_spend").select("client_id, sprint_id, channel, spend_source, manual_actual_spend"),
      "sprint_channel_spend",
    ),
  ]);

  // Etapa "Horizonte de Planejamento": clientes de evento (campanha que
  // termina antes do fim do mês) — mapa vazio pra quem não tem nenhum,
  // comportamento idêntico a antes desta etapa.
  const monthHorizonsByClient = await getClientMonthHorizons(supabase, clients.map((c) => c.id), currentMonthRange(today).firstDay);

  type SprintRow = {
    id: string;
    client_id: string;
    start_date: string;
    end_date: string;
    planned_spend: number;
    spend_source: "manual" | "meta_api";
    manual_actual_spend: number | null;
  };
  // Investimento manual multicanal — resolve `manual_actual_spend` de cada
  // sprint ANTES de agrupar por cliente (mesmo padrão de sprints/page.tsx —
  // ver `resolveManualActualSpend`, lib/effective-spend.ts).
  const channelSpendBySprintId = groupChannelSpendBySprintId(
    (channelSpendRows ?? []).map((r) => ({
      sprintId: r.sprint_id,
      channel: r.channel,
      spend_source: r.spend_source,
      manual_actual_spend: r.manual_actual_spend,
    })),
  );
  const sprintsByClient = new Map<string, SprintRow[]>();
  for (const s of sprints ?? []) {
    const resolvedSprint: SprintRow = {
      ...s,
      manual_actual_spend: resolveManualActualSpend(s.manual_actual_spend, channelSpendBySprintId.get(s.id) ?? []),
    };
    const list = sprintsByClient.get(s.client_id) ?? [];
    list.push(resolvedSprint);
    sprintsByClient.set(s.client_id, list);
  }

  const dailySpendByClient = new Map<string, { date: string; spend: number }[]>();
  for (const d of dailySpend ?? []) {
    const list = dailySpendByClient.get(d.client_id) ?? [];
    list.push({ date: d.date, spend: d.spend });
    dailySpendByClient.set(d.client_id, list);
  }

  const plannedAllocationsByClient = new Map<string, { date: string; sprintId: string; amount: number }[]>();
  for (const a of plannedAllocations ?? []) {
    const list = plannedAllocationsByClient.get(a.client_id) ?? [];
    list.push({ date: a.date, sprintId: a.sprint_id, amount: a.planned_amount });
    plannedAllocationsByClient.set(a.client_id, list);
  }

  // Etapa "Múltiplos Objetivos": só o objetivo PRINCIPAL — nunca deixa a
  // linha de um objetivo secundário virar investimento aqui.
  const primaryGoalByClientId = new Map(clients.map((c) => [c.id, c.performance_goal]));
  const budgetChangesByClient = new Map<string, { channel: TrafficChannel; month: string; investment: number; changedAt: string }[]>();
  for (const c of filterRowsToPrimaryGoal(budgetChanges ?? [], primaryGoalByClientId)) {
    const list = budgetChangesByClient.get(c.client_id) ?? [];
    list.push({ channel: c.channel as TrafficChannel, month: c.month, investment: c.new_amount, changedAt: c.changed_at });
    budgetChangesByClient.set(c.client_id, list);
  }

  const currentRange = currentMonthRange(today);

  /**
   * KOFF Analytics — Etapa 1.8: esta listagem usava `buildOperationClientCard`
   * (`app/operation/operation-data.ts`, removido junto com Operação) só por
   * conveniência — o card inteiro (tarefas, alertas, saúde, atividade
   * operacional) nunca foi exibido aqui (ver doc-comment do componente),
   * só `monthPlanned`/`monthActual` eram realmente lidos. Substituído por
   * este cálculo mínimo, com as mesmas funções analíticas centrais de
   * sempre (`resolveConsolidatedMonthlyPlanned`/`sumPlannedForMonth`/
   * `sumActualSpendForMonth`, as mesmas que o Cockpit usa) — mesmo
   * resultado numérico, sem nenhuma dependência de tarefas/atividade
   * operacional/account_reviews.
   */
  let cards = clients.map((client) => {
    const clientSprints = sprintsByClient.get(client.id) ?? [];
    const monthPlanned = resolveConsolidatedMonthlyPlanned(
      AVAILABLE_TRAFFIC_CHANNELS,
      budgetChangesByClient.get(client.id) ?? [],
      firstDay,
      sumPlannedForMonth(plannedAllocationsByClient.get(client.id) ?? [], currentRange),
    );
    const monthActual = sumActualSpendForMonth(clientSprints, currentRange, dailySpendByClient.get(client.id) ?? []);
    return {
      clientId: client.id,
      clientName: client.name,
      managerIds: client.primary_manager ? [client.primary_manager.id] : [],
      monthPlanned,
      monthActual,
    };
  });
  // Auditoria de Estados Vazios: distingue "não existe cliente nenhum" de
  // "os filtros não encontraram nada" — capturado ANTES de search/manager/
  // status filtrarem `cards` abaixo, nunca recalculado depois.
  const hasAnyClients = cards.length > 0;

  // Dados estruturais (Etapa 27) — status contratual, início de contrato e
  // nome do gestor principal não fazem parte do cálculo de orçamento acima,
  // então ficam num map à parte, indexado pelo mesmo clientId.
  const clientMetaById = new Map(
    (clients ?? []).map((c) => [
      c.id,
      { status: c.status, contractStartDate: c.contract_start_date, primaryManagerName: c.primary_manager?.name ?? null },
    ]),
  );

  if (search) {
    cards = cards.filter((card) => card.clientName.toLowerCase().includes(search));
  }

  if (managerFilter !== "all") {
    cards = cards.filter((card) => card.managerIds.includes(managerFilter));
  }

  if (statusFilter !== "todos") {
    cards = cards.filter((card) => clientMetaById.get(card.clientId)?.status === statusFilter);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Clientes</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Localizar e abrir qualquer cliente da carteira.</p>
        </div>
        {isAdmin && (
          <Link
            href="/clients/new"
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover"
          >
            + Novo cliente
          </Link>
        )}
      </div>

      <ClientsFilters search={search} managerFilter={managerFilter} statusFilter={statusFilter} gestores={gestores ?? []} />

      <p className="mt-3 text-xs text-muted-foreground">
        {cards.length} cliente{cards.length !== 1 ? "s" : ""}
      </p>

      <div className="mt-3 overflow-hidden rounded-lg border border-border">
        {cards.length > 0 ? (
          <ul>
            {cards.map((card) => {
              const meta = clientMetaById.get(card.clientId);
              // Etapa "Horizonte de Planejamento": `computeMonthProjectionForRange`
              // com o horizonte do cliente, não `computeMonthProjection`
              // (sempre calendário) — cliente de evento projeta o ritmo até
              // a data da campanha, não até o fim do mês.
              const projection = computeMonthProjectionForRange(
                card.monthPlanned,
                card.monthActual,
                resolvePlanningHorizon(currentRange, monthHorizonsByClient.get(card.clientId) ?? null),
                today,
              );
              return (
                <li
                  key={card.clientId}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-card px-3 py-2 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/clients/${card.clientId}`}
                        className="font-semibold text-foreground hover:underline"
                      >
                        {card.clientName}
                      </Link>
                      {meta && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CLIENT_STATUS_BADGE_CLASSES[meta.status]}`}
                        >
                          {CLIENT_STATUS_LABEL[meta.status]}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>{formatRelationshipDuration(meta?.contractStartDate ?? null, today)}</span>
                      <span>
                        Projeção:{" "}
                        {card.monthPlanned > 0 ? formatCurrency(projection.projectedSpend) : "—"}
                      </span>
                      <span>{meta?.primaryManagerName ?? "Sem gestor"}</span>
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {/* KOFF Analytics Fase 2 — ajuste do usuário: "acesso
                        fácil ao dashboard individual de cada cliente",
                        reaproveitando esta listagem em vez de um módulo
                        novo. Visão consolidada de todas as contas (mesmo
                        pedido) fica pra uma etapa própria — este link só
                        cobre a navegação direta pro dashboard de UM
                        cliente. */}
                    <Link
                      href={`/clients/${card.clientId}/meta-ads`}
                      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-overview-surface-hover"
                    >
                      Meta Ads
                    </Link>
                    <Link
                      href={`/clients/${card.clientId}`}
                      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-overview-surface-hover"
                    >
                      Abrir
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState className="bg-card p-4">
            {hasAnyClients ? "Nenhum cliente encontrado com esses filtros." : "Nenhum cliente cadastrado ainda."}
          </EmptyState>
        )}
      </div>

      {/* Etapa "MEGA FACELIFT — Fase 4.5": "Organizar carteira" — mesma
          árvore "Contas da Agência" de sempre (busca + agrupamento por
          gestor + arrastar pra reordenar/transferir `wallet_position`),
          realocada da Sidebar pra aqui (seção 8 do pedido). Recolhida por
          padrão (é organização, não o fluxo principal desta tela) — mesmo
          padrão de "Configurar funis" em Performance. */}
      <details className="mt-6 rounded-lg border border-border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">Organizar carteira</summary>
        <div className="border-t border-border p-3">
          <div className="overflow-hidden rounded-lg bg-sidebar-surface">
            <AgencyAccountsTree />
          </div>
        </div>
      </details>
    </div>
  );
}
