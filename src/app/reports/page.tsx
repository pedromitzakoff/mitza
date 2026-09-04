import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { todayUTC } from "@/lib/today";
import { monthRangeFromParam, shiftMonthParam } from "@/lib/sprint-financials";
import { formatMonthLabel } from "@/lib/format";
import { loadClientOperationalStates } from "@/lib/client-operational-state-data";
import { getActiveDiagnosticFilters } from "@/lib/metric-diagnostics";
import { MONTHLY_REPORT_STATUS_BADGE_CLASSES, MONTHLY_REPORT_STATUS_LABEL } from "@/lib/monthly-reports";
import type { MonthlyReportStatus } from "@/lib/supabase/database.types";
import { SubmitButton } from "@/app/submit-button";
import { finalizeReportAction, reopenReportAction, updateReportStatusAction } from "./report-actions";
import { buildPerformanceReportHref, resolveMonthlyReportRow, type MonthlyReportRow } from "./report-panel";
import { ReportStatusSelect } from "./report-status-select";
import { ReportsFilters } from "./reports-filters";

/**
 * Etapa "Separação Relatório Operacional × Documento de Performance":
 * `/reports` deixa de tentar ser um segundo documento de performance
 * (Campanhas/Criativos/KPIs saíram — isso é 100% do Relatório de
 * Performance agora, `/clients/[id]/relatorio`) e vira só o painel de
 * FECHAMENTO — a pergunta que esta tela responde é sempre "quais
 * relatórios deste mês ainda faltam fechar?", nunca "como foi a
 * performance?". Status/finalizar/reabrir continuam as MESMAS 3 Server
 * Actions de sempre (`report-actions.ts`), só que chamadas direto da linha
 * da tabela em vez de uma página própria por cliente — `/reports/[clientId]`
 * (aposentada, ver esse arquivo) nunca teve nenhuma regra própria, só
 * apresentação.
 */
const STATUS_OPTIONS: { value: MonthlyReportStatus; label: string }[] = [
  { value: "nao_iniciado", label: "Não iniciado" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "pronto_revisao", label: "Pronto para revisão" },
];

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
  const monthStart = monthRange.firstDay;

  const managerFilter = params.manager ?? (isAdmin ? "all" : "me");

  const supabase = await createSupabaseClient();

  // Etapa "Consolidação da Arquitetura — Fase C": a lista já migrou pra
  // `ClientOperationalState` (mesmo pipeline que Operação e Visão Geral já
  // usam) — nenhuma query própria de sprints/daily_spend/tasks/planejamento
  // aqui, `loadClientOperationalStates` já resolve tudo internamente.
  // Investimento/situação do mês SAÍRAM desta tela (Etapa "Separação..." —
  // isso é conteúdo de performance, pertence só ao Relatório de Performance
  // agora); por isso não busca mais nada disso, só o que a tabela mostra.
  const [clientStates, gestores, reports] = await Promise.all([
    loadClientOperationalStates(supabase, monthStart),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    requireQuery(
      supabase
        .from("monthly_reports")
        .select(
          "client_id, status, updated_at, finalized_at, finalized_by_profile:team_members!monthly_reports_finalized_by_fkey(name)",
        )
        .eq("month_start", monthStart),
      "monthly_reports",
    ),
  ]);

  const reportRowByClient = new Map<string, MonthlyReportRow>(
    (reports ?? []).map((r) => [
      r.client_id,
      { status: r.status, updated_at: r.updated_at, finalized_at: r.finalized_at, finalized_by_profile: r.finalized_by_profile },
    ]),
  );
  const resolvedReportFor = (clientId: string) => resolveMonthlyReportRow(reportRowByClient.get(clientId));

  const clientOptions = [...clientStates]
    .map((s) => ({ id: s.clientId, name: s.clientName }))
    .sort((a, b) => a.name.localeCompare(b.name));

  let states = clientStates;
  // Auditoria de Estados Vazios: distingue "não existe cliente nenhum" de
  // "os filtros não encontraram nada" — capturado ANTES de gestor/cliente
  // filtrarem `states` abaixo.
  const hasAnyClients = clientStates.length > 0;
  if (managerFilter === "me") {
    states = states.filter((s) => s.managerId === profile.id);
  } else if (managerFilter !== "all") {
    states = states.filter((s) => s.managerId === managerFilter);
  }

  const clientFilter = params.client && states.some((s) => s.clientId === params.client) ? params.client : undefined;
  if (clientFilter) states = states.filter((s) => s.clientId === clientFilter);

  // Ordenação alfabética por nome — decisão de APRESENTAÇÃO (a lista é pra
  // encontrar um cliente, não pra priorizar atenção), preservada da versão
  // legada sem alteração.
  states = [...states].sort((a, b) => a.clientName.localeCompare(b.clientName));

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

  const monthLabel = formatMonthLabel(monthStart);

  const completeCount = states.filter((s) => resolvedReportFor(s.clientId).status === "finalizado").length;
  const pendingCount = states.length - completeCount;
  const attentionCount = states.filter((s) => getActiveDiagnosticFilters(s.diagnostics).some((f) => f !== "atividade")).length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Relatórios</h1>
        <p className="text-sm text-muted-foreground">Controle de fechamento mensal por cliente.</p>
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
        {states.length} cliente{states.length !== 1 ? "s" : ""} acompanhado{states.length !== 1 ? "s" : ""} · {completeCount}{" "}
        relatório{completeCount !== 1 ? "s" : ""} completo{completeCount !== 1 ? "s" : ""} · {pendingCount} pendente
        {pendingCount !== 1 ? "s" : ""} · {attentionCount} conta{attentionCount !== 1 ? "s" : ""} exige
        {attentionCount === 1 ? "" : "m"} atenção
      </p>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-muted-foreground dark:bg-zinc-900">
              <th className="py-2 px-3">Cliente</th>
              <th className="py-2 px-3">Responsável</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">Atualizado</th>
              <th className="py-2 px-3 text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {states.length > 0 ? (
              states.map((state) => {
                const resolved = resolvedReportFor(state.clientId);
                const isFinalized = resolved.status === "finalizado";
                return (
                  <tr key={state.clientId} className="border-b border-border/60 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <td className="py-2 px-3 font-bold text-foreground">{state.clientName}</td>
                    <td className="py-2 px-3 text-muted-foreground">{state.managerName ?? "Sem gestor"}</td>
                    <td className="py-2 px-3">
                      {isFinalized ? (
                        <div className="flex flex-col gap-1">
                          <span
                            className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ${MONTHLY_REPORT_STATUS_BADGE_CLASSES[resolved.status]}`}
                          >
                            {MONTHLY_REPORT_STATUS_LABEL[resolved.status]}
                          </span>
                          {resolved.finalizedLabel && <span className="text-[11px] text-muted-foreground">{resolved.finalizedLabel}</span>}
                          {isAdmin && (
                            <form action={reopenReportAction.bind(null, state.clientId, monthStart)}>
                              <SubmitButton className="text-[11px] font-medium text-brand hover:underline" pendingChildren="Reabrindo...">
                                Reabrir
                              </SubmitButton>
                            </form>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <form action={updateReportStatusAction.bind(null, state.clientId, monthStart)}>
                            <ReportStatusSelect
                              name="status"
                              defaultValue={resolved.status}
                              options={STATUS_OPTIONS}
                              className={`rounded-full border-0 px-2 py-0.5 text-[11px] font-medium ${MONTHLY_REPORT_STATUS_BADGE_CLASSES[resolved.status]}`}
                            />
                          </form>
                          {isAdmin && resolved.status === "pronto_revisao" && (
                            <form action={finalizeReportAction.bind(null, state.clientId, monthStart)}>
                              <SubmitButton
                                className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
                                pendingChildren="Finalizando..."
                              >
                                Finalizar
                              </SubmitButton>
                            </form>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">{resolved.updatedAtLabel}</td>
                    <td className="py-2 px-3 text-right">
                      <Link
                        href={buildPerformanceReportHref(state.clientId, monthRange)}
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
                <td colSpan={5} className="py-4 px-3 text-center">
                  <EmptyState>{hasAnyClients ? "Nenhum cliente encontrado com esses filtros." : "Nenhum cliente cadastrado ainda."}</EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
