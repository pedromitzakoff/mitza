import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { todayUTC } from "@/lib/today";
import { currentMonthRange, monthRangeFromParam, shiftMonthParam } from "@/lib/sprint-financials";
import { formatCurrency, formatMonthLabel } from "@/lib/format";
import { buildOperationClientCard, type OperationClientRawData } from "@/app/operation/operation-data";
import { SPEND_STATUS_BADGE_CLASSES } from "@/lib/spend-status";
import type { SpendStatus } from "@/lib/spend-status";
import { MONTHLY_REPORT_STATUS_BADGE_CLASSES, MONTHLY_REPORT_STATUS_LABEL } from "@/lib/monthly-reports";
import type { MonthlyReportStatus } from "@/lib/supabase/database.types";
import { ReportsFilters } from "./reports-filters";

/** Mesmo rótulo/cor de "Situação do mês" já usado na Visão Geral
 * (`card.monthStatus`) — texto local só pra não importar um componente de
 * outra tela, mesma classificação central (classifySpendStatus). */
const SITUATION_LABEL: Record<SpendStatus, string> = {
  dentro: "Dentro do esperado",
  acima: "Acima do esperado",
  abaixo: "Abaixo do esperado",
  sem_meta: "Sem planejamento",
  nao_iniciado: "Ainda não iniciada",
  em_andamento: "Em andamento",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; manager?: string; client?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const isAdmin = profile.role === "admin";
  const params = await searchParams;

  const today = todayUTC();
  const monthRange = monthRangeFromParam(params.month, today);
  const currentRange = currentMonthRange(today);
  const rangeStart = monthRange.firstDay < currentRange.firstDay ? monthRange.firstDay : currentRange.firstDay;
  const rangeEnd = monthRange.lastDay > currentRange.lastDay ? monthRange.lastDay : currentRange.lastDay;

  const managerFilter = params.manager ?? (isAdmin ? "all" : "me");

  const supabase = await createSupabaseClient();

  const [clients, gestores, sprints, dailySpend, tasks, reports, plannedAllocations, budgetChanges] = await Promise.all([
    requireQuery(
      supabase
        .from("clients")
        .select("id, name, meta_ad_account_id, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)")
        .is("deleted_at", null)
        .order("name"),
      "clients",
    ),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    // Sobreposição com a janela (não "começa na janela") — sprint que
    // atravessa mês precisa ser encontrada mesmo com start_date fora dela.
    requireQuery(
      supabase
        .from("sprints")
        .select("id, client_id, start_date, end_date, planned_spend, spend_source, manual_actual_spend")
        .lte("start_date", rangeEnd)
        .gte("end_date", rangeStart),
      "sprints",
    ),
    requireQuery(
      supabase.from("daily_spend").select("client_id, date, spend, synced_at").gte("date", rangeStart).lte("date", rangeEnd),
      "daily_spend",
    ),
    requireQuery(
      supabase
        .from("tasks")
        .select(
          "id, client_id, sprint_id, title, type, due_date, status, notes, assignee:team_members!tasks_assignee_id_fkey(name, status)",
        ),
      "tasks",
    ),
    requireQuery(
      supabase.from("monthly_reports").select("client_id, status").eq("month_start", monthRange.firstDay),
      "monthly_reports",
    ),
    requireQuery(
      supabase
        .from("sprint_planned_allocations")
        .select("client_id, sprint_id, date, planned_amount")
        .gte("date", rangeStart)
        .lte("date", rangeEnd),
      "sprint_planned_allocations",
    ),
    // Orçamento vigente (Etapa 66) — só do mês SELECIONADO (`monthRange`),
    // não da janela união com o mês corrente.
    requireQuery(
      supabase
        .from("monthly_budget_changes")
        .select("client_id, new_amount, changed_at")
        .eq("month", monthRange.firstDay),
      "monthly_budget_changes",
    ),
  ]);

  const sprintsByClient = new Map<string, typeof sprints>();
  for (const s of sprints) {
    const list = sprintsByClient.get(s.client_id) ?? [];
    list.push(s);
    sprintsByClient.set(s.client_id, list);
  }

  const dailySpendByClient = new Map<string, { date: string; spend: number }[]>();
  const lastSyncedByClient = new Map<string, string>();
  for (const d of dailySpend) {
    const list = dailySpendByClient.get(d.client_id) ?? [];
    list.push({ date: d.date, spend: d.spend });
    dailySpendByClient.set(d.client_id, list);
    const current = lastSyncedByClient.get(d.client_id);
    if (!current || d.synced_at > current) lastSyncedByClient.set(d.client_id, d.synced_at);
  }

  const tasksByClient = new Map<string, OperationClientRawData["tasks"]>();
  for (const t of tasks) {
    const list = tasksByClient.get(t.client_id) ?? [];
    list.push(t);
    tasksByClient.set(t.client_id, list);
  }

  const plannedAllocationsByClient = new Map<string, OperationClientRawData["plannedAllocations"]>();
  for (const a of plannedAllocations ?? []) {
    const list = plannedAllocationsByClient.get(a.client_id) ?? [];
    list.push({ date: a.date, sprintId: a.sprint_id, amount: a.planned_amount });
    plannedAllocationsByClient.set(a.client_id, list);
  }

  const budgetChangesByClient = new Map<string, OperationClientRawData["monthlyBudgetChanges"]>();
  for (const c of budgetChanges ?? []) {
    const list = budgetChangesByClient.get(c.client_id) ?? [];
    list.push({ newAmount: c.new_amount, changedAt: c.changed_at });
    budgetChangesByClient.set(c.client_id, list);
  }

  const reportStatusByClient = new Map<string, MonthlyReportStatus>((reports ?? []).map((r) => [r.client_id, r.status]));
  const primaryManagerNameByClient = new Map((clients ?? []).map((c) => [c.id, c.primary_manager?.name ?? null]));

  const rawClients: OperationClientRawData[] = (clients ?? []).map((client) => ({
    id: client.id,
    name: client.name,
    metaAdAccountId: client.meta_ad_account_id,
    // Etapa 62: fonte única do gestor atribuído — clients.primary_manager_id.
    managerNames: client.primary_manager ? [client.primary_manager.name] : [],
    managerIds: client.primary_manager ? [client.primary_manager.id] : [],
    sprints: sprintsByClient.get(client.id) ?? [],
    dailySpend: dailySpendByClient.get(client.id) ?? [],
    plannedAllocations: plannedAllocationsByClient.get(client.id) ?? [],
    monthlyBudgetChanges: budgetChangesByClient.get(client.id) ?? [],
    tasks: tasksByClient.get(client.id) ?? [],
    clientLastActivityAt: null,
    sprintLastActivityAt: null,
    lastSyncedAt: lastSyncedByClient.get(client.id) ?? null,
    // Esta tela já aceita clientLastActivityAt/sprintLastActivityAt
    // aproximados (sempre null) pra accountHealth — mesmo padrão aqui,
    // nenhuma query nova só pra isso.
    lastReviewAt: null,
  }));

  const allCards = rawClients.map((client) => buildOperationClientCard(client, today, monthRange));

  const clientOptions = [...allCards].map((c) => ({ id: c.clientId, name: c.clientName })).sort((a, b) => a.name.localeCompare(b.name));

  let cards = allCards;
  if (managerFilter === "me") {
    cards = cards.filter((card) => card.managerIds.includes(profile.id));
  } else if (managerFilter !== "all") {
    cards = cards.filter((card) => card.managerIds.includes(managerFilter));
  }

  const clientFilter = params.client && cards.some((c) => c.clientId === params.client) ? params.client : undefined;
  if (clientFilter) cards = cards.filter((c) => c.clientId === clientFilter);

  cards = [...cards].sort((a, b) => a.clientName.localeCompare(b.clientName));

  const buildUrl = (overrides: Record<string, string>) => {
    const next = new URLSearchParams();
    next.set("manager", managerFilter);
    if (clientFilter) next.set("client", clientFilter);
    if (params.month) next.set("month", params.month);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }
    return `/reports?${next.toString()}`;
  };

  const monthLabel = formatMonthLabel(monthRange.firstDay);
  const reportStatusFor = (clientId: string): MonthlyReportStatus => reportStatusByClient.get(clientId) ?? "nao_iniciado";

  const completeCount = cards.filter((c) => reportStatusFor(c.clientId) === "finalizado").length;
  const pendingCount = cards.length - completeCount;
  const attentionCount = cards.filter((c) => c.accountHealth !== "saudavel").length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Relatórios</h1>
        <p className="text-sm text-muted-foreground">
          Acompanhamento mensal da gestão, execução e evolução das contas.
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-card px-1 py-1 text-sm">
          <Link
            href={buildUrl({ month: shiftMonthParam(monthRange, -1) })}
            className="rounded-md px-1.5 py-0.5 text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Mês anterior"
          >
            &lsaquo;
          </Link>
          <span className="min-w-[8.5rem] text-center font-medium text-foreground">{monthLabel}</span>
          <Link
            href={buildUrl({ month: shiftMonthParam(monthRange, 1) })}
            className="rounded-md px-1.5 py-0.5 text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            aria-label="Próximo mês"
          >
            &rsaquo;
          </Link>
          {params.month && (
            <Link href={buildUrl({ month: "" })} className="ml-1.5 text-xs text-brand hover:underline">
              Mês atual
            </Link>
          )}
        </div>

        <ReportsFilters
          clients={clientOptions}
          selectedClientId={clientFilter}
          month={params.month}
          isAdmin={isAdmin}
          gestores={gestores ?? []}
          manager={managerFilter}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {cards.length} cliente{cards.length !== 1 ? "s" : ""} acompanhado{cards.length !== 1 ? "s" : ""} · {completeCount}{" "}
        relatório{completeCount !== 1 ? "s" : ""} completo{completeCount !== 1 ? "s" : ""} · {pendingCount} pendente
        {pendingCount !== 1 ? "s" : ""} · {attentionCount} conta{attentionCount !== 1 ? "s" : ""} exige
        {attentionCount === 1 ? "" : "m"} atenção
      </p>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-muted-foreground dark:bg-zinc-900">
              <th className="py-2 px-3">Cliente</th>
              <th className="py-2 px-3 text-right">Investimento</th>
              <th className="py-2 px-3 text-right">% realizado</th>
              <th className="py-2 px-3">Situação do mês</th>
              <th className="py-2 px-3">Gestor</th>
              <th className="py-2 px-3">Status do relatório</th>
              <th className="py-2 px-3 text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {cards.length > 0 ? (
              cards.map((card) => {
                const pct = card.monthPlanned > 0 ? Math.round((card.monthActual / card.monthPlanned) * 100) : null;
                const reportStatus = reportStatusFor(card.clientId);
                return (
                  <tr key={card.clientId} className="border-b border-border/60 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <td className="py-2 px-3 font-bold text-foreground">{card.clientName}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      {formatCurrency(card.monthActual)} / {formatCurrency(card.monthPlanned)}
                    </td>
                    <td className="py-2 px-3 text-right font-semibold tabular-nums text-foreground">{pct !== null ? `${pct}%` : "—"}</td>
                    <td className="py-2 px-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[card.monthStatus]}`}>
                        {SITUATION_LABEL[card.monthStatus]}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {primaryManagerNameByClient.get(card.clientId) ?? "Sem gestor"}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${MONTHLY_REPORT_STATUS_BADGE_CLASSES[reportStatus]}`}
                      >
                        {MONTHLY_REPORT_STATUS_LABEL[reportStatus]}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Link
                        href={`/reports/${card.clientId}${params.month ? `?month=${params.month}` : ""}`}
                        className="rounded-md border border-transparent px-2 py-1 text-xs font-medium text-brand transition-colors hover:border-border hover:bg-zinc-100 dark:hover:bg-zinc-900"
                      >
                        Abrir relatório
                      </Link>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="py-4 px-3 text-center">
                  <EmptyState>Nenhum cliente encontrado com esses filtros.</EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
