import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { todayUTC } from "@/lib/today";
import { monthRangeFromParam, shiftMonthParam } from "@/lib/sprint-financials";
import { formatCurrency, formatMonthLabel } from "@/lib/format";
import { loadClientOperationalStates } from "@/lib/client-operational-state-data";
import { getActiveDiagnosticFilters } from "@/lib/metric-diagnostics";
import { classifySpendStatus, SPEND_STATUS_BADGE_CLASSES, type SpendStatus } from "@/lib/spend-status";
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

  const managerFilter = params.manager ?? (isAdmin ? "all" : "me");

  const supabase = await createSupabaseClient();

  // Etapa "Consolidação da Arquitetura — Fase C": a lista migrou pra
  // `ClientOperationalState` (mesmo pipeline que Operação e Visão Geral já
  // usam) — nenhuma query própria de sprints/daily_spend/tasks/planejamento
  // aqui, `loadClientOperationalStates` já resolve tudo internamente.
  const [clientStates, gestores, reports] = await Promise.all([
    loadClientOperationalStates(supabase, monthRange.firstDay),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    requireQuery(
      supabase.from("monthly_reports").select("client_id, status").eq("month_start", monthRange.firstDay),
      "monthly_reports",
    ),
  ]);

  const reportStatusByClient = new Map<string, MonthlyReportStatus>((reports ?? []).map((r) => [r.client_id, r.status]));

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
  // legada sem alteração. Nunca `sortClientOperationalStates`: esta tela não
  // ordena por severidade/prioridade — quem precisa dessa ordem canônica é
  // Operação e Visão Geral (Prioridades de hoje/tabelas por objetivo).
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

  const monthLabel = formatMonthLabel(monthRange.firstDay);
  const reportStatusFor = (clientId: string): MonthlyReportStatus => reportStatusByClient.get(clientId) ?? "nao_iniciado";

  const completeCount = states.filter((s) => reportStatusFor(s.clientId) === "finalizado").length;
  const pendingCount = states.length - completeCount;
  // Etapa "Visão Geral + Reports no Core": "N contas exigem atenção" passa a
  // vir do Motor de Diagnóstico Único (Planejamento/Investimento/CPA/
  // Pendências — nunca Atividade, que não é um dos 4 diagnósticos do
  // Workspace) em vez do Sistema A (`evaluation.healthStatus`) — a frase
  // exibida nunca usou vocabulário Saudável/Atenção/Crítico, só o critério
  // de contagem mudou de fonte.
  const attentionCount = states.filter((s) => getActiveDiagnosticFilters(s.diagnostics).some((f) => f !== "atividade")).length;

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
        {states.length} cliente{states.length !== 1 ? "s" : ""} acompanhado{states.length !== 1 ? "s" : ""} · {completeCount}{" "}
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
            {states.length > 0 ? (
              states.map((state) => {
                const investment = state.evaluation.dimensions.investment;
                const monthPlanned = investment.planned ?? 0;
                const monthActual = investment.actual;
                // Etapa "Consolidação da Arquitetura — Fase C": "Situação do
                // mês" continua vindo da MESMA `classifySpendStatus` de
                // sempre (FinancialPace, Prioridade 4 da Fase B — nunca
                // substituída pela severidade de investimento do Motor de
                // Saúde), só que aplicada sobre o investimento já resolvido
                // por `ClientOperationalState` (que usa `resolveMonthlyPlanSnapshot`,
                // a regra de VIGÊNCIA — ver relatório de paridade: isso é uma
                // divergência conhecida e esperada em relação a
                // `/reports/[clientId]`, que ainda usa `resolveMonthlyBudget`,
                // a regra de mês exato; a unificação é uma PR futura).
                const monthStatus = classifySpendStatus(monthActual, investment.expected ?? 0, monthPlanned);
                const pct = monthPlanned > 0 ? Math.round((monthActual / monthPlanned) * 100) : null;
                const reportStatus = reportStatusFor(state.clientId);
                return (
                  <tr key={state.clientId} className="border-b border-border/60 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <td className="py-2 px-3 font-bold text-foreground">{state.clientName}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                      {formatCurrency(monthActual)} / {formatCurrency(monthPlanned)}
                    </td>
                    <td className="py-2 px-3 text-right font-semibold tabular-nums text-foreground">{pct !== null ? `${pct}%` : "—"}</td>
                    <td className="py-2 px-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[monthStatus]}`}>
                        {SITUATION_LABEL[monthStatus]}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">{state.managerName ?? "Sem gestor"}</td>
                    <td className="py-2 px-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${MONTHLY_REPORT_STATUS_BADGE_CLASSES[reportStatus]}`}
                      >
                        {MONTHLY_REPORT_STATUS_LABEL[reportStatus]}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Link
                        href={`/reports/${state.clientId}${params.month ? `?month=${params.month}` : ""}`}
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
