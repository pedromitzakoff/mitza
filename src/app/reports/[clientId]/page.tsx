import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC } from "@/lib/today";
import { formatCurrency, formatMonthLabel, formatShortDate } from "@/lib/format";
import { shiftMonthParam, monthRangeFromParam } from "@/lib/sprint-financials";
import { classifySpendStatus } from "@/lib/spend-status";
import { resolveMonthPeriodSummary } from "@/lib/financial-period";
import { getMonthTemporalStatus } from "@/lib/monthly-budget";
import {
  MONTHLY_REPORT_STATUS_BADGE_CLASSES,
  MONTHLY_REPORT_STATUS_LABEL,
  KPI_TARGET_STATUS_BADGE_CLASSES,
  KPI_TARGET_STATUS_LABEL,
  REPORT_ACTION_ITEM_DEPENDENCY_LABEL,
  classifyKpiTargetStatus,
  computeKpiVariationPct,
  formatKpiValue,
} from "@/lib/monthly-reports";
import { SPEND_STATUS_BADGE_CLASSES } from "@/lib/spend-status";
import { AgencyInvestmentBar } from "@/app/agency-investment-bar";
import { buildReportViewData } from "../report-data";
import {
  addActionItemAction,
  addTimelineEventAction,
  deleteTimelineEventAction,
  finalizeReportAction,
  reopenReportAction,
  sendActionItemToSprintAction,
  updateActionItemStatusAction,
  updateKpiValueAction,
  updateReportFieldsAction,
  updateReportStatusAction,
} from "../report-actions";
import type {
  ReportActionItemDependency,
  ReportActionItemStatus,
  ReportTimelineEventType,
} from "@/lib/supabase/database.types";

const SITUATION_LABEL = {
  dentro: "Dentro do esperado",
  acima: "Acima do esperado",
  abaixo: "Abaixo do esperado",
  sem_meta: "Sem planejamento",
  nao_iniciado: "Ainda não iniciada",
  em_andamento: "Em andamento",
} as const;

const TIMELINE_TYPE_LABEL: Record<ReportTimelineEventType, string> = {
  orcamento: "Orçamento",
  investimento: "Investimento",
  otimizacao: "Otimização",
  estrategia: "Mudança de estratégia",
  teste_iniciado: "Teste iniciado",
  teste_encerrado: "Teste encerrado",
  problema: "Problema identificado",
  reuniao: "Reunião",
  entrega_criativo: "Entrega de criativo",
  performance: "Mudança de performance",
  comentario: "Comentário",
  outro: "Outro",
};

const ACTION_ITEM_STATUS_LABEL: Record<ReportActionItemStatus, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluido: "Concluído",
};

const DEPENDENCY_OPTIONS: ReportActionItemDependency[] = ["agencia", "cliente", "terceiro"];

function SectionCard({ id, title, action, children }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function ClientReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ month?: string; error?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const isAdmin = profile.role === "admin";

  const { clientId } = await params;
  const { month, error } = await searchParams;
  const today = todayUTC();

  const supabase = await createSupabaseClient();
  const data = await buildReportViewData(supabase, clientId, month, today, formatMonthLabel);
  if (!data) notFound();

  const { data: managers } = await supabase
    .from("client_managers")
    .select("team_members(id, name)")
    .eq("client_id", clientId);
  const responsibleOptions = (managers ?? []).flatMap((m) => (m.team_members ? [m.team_members] : []));

  const monthRange = monthRangeFromParam(month, today);
  const monthParam = (overrideMonth: string) => `?month=${overrideMonth}`;
  const prevMonthHref = `/reports/${clientId}${monthParam(shiftMonthParam(monthRange, -1))}`;
  const nextMonthHref = `/reports/${clientId}${monthParam(shiftMonthParam(monthRange, 1))}`;

  const isReadOnly = data.status === "finalizado";
  const financialStatus = classifySpendStatus(data.financial.actual, data.financial.expectedToDate, data.financial.planned);
  const pct = data.financial.planned > 0 ? Math.round((data.financial.actual / data.financial.planned) * 100) : null;
  const monthTemporalStatus = getMonthTemporalStatus(monthRange, today.toISOString().slice(0, 10));

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/reports${month ? `?month=${month}` : ""}`} className="text-sm text-muted-foreground hover:underline">
          &larr; Relatórios
        </Link>
        <Link
          href={`/clients/${clientId}`}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          Voltar ao cliente
        </Link>
      </div>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{data.clientName}</h1>
          <p className="text-sm text-muted-foreground">
            {data.monthLabel}
            {data.managerName ? ` · ${data.managerName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${MONTHLY_REPORT_STATUS_BADGE_CLASSES[data.status]}`}>
            {MONTHLY_REPORT_STATUS_LABEL[data.status]}
          </span>
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-card px-1 py-1 text-sm">
            <Link href={prevMonthHref} className="rounded-md px-1.5 py-0.5 text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900" aria-label="Mês anterior">
              &lsaquo;
            </Link>
            <Link href={nextMonthHref} className="rounded-md px-1.5 py-0.5 text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900" aria-label="Próximo mês">
              &rsaquo;
            </Link>
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}

      {data.status === "finalizado" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Finalizado por {data.finalizedByName ?? "—"} em {data.finalizedAt ? formatShortDate(data.finalizedAt.slice(0, 10)) : "—"} —
          os dados abaixo são um snapshot congelado deste mês.
        </p>
      )}

      {/* Navegação interna */}
      <nav className="mt-4 flex flex-wrap gap-1 border-b border-border pb-2 text-xs">
        {[
          ["#resumo", "Resumo do mês"],
          ["#performance", "Performance"],
          ["#execucao", "Execução da agência"],
          ["#comportamento-sprint", "Comportamento por sprint"],
          ["#linha-do-tempo", "Acontecimentos e decisões"],
          ["#analise-gestor", "Análise do gestor"],
          ["#pendencias", "Pendências"],
          ["#proximos-passos", "Próximos passos"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="rounded-md px-2 py-1 font-medium text-muted-foreground hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-900">
            {label}
          </a>
        ))}
      </nav>

      <div className="mt-4 flex flex-col gap-4">
        {/* Bloco 1 — Resumo do mês */}
        <SectionCard id="resumo" title="Resumo do mês">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Planejado</p>
              <p className="mt-0.5 text-lg font-bold text-navy">{formatCurrency(data.financial.planned)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Realizado</p>
              <p className="mt-0.5 text-lg font-bold text-navy">{formatCurrency(data.financial.actual)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">% realizado</p>
              <p className="mt-0.5 text-lg font-semibold text-foreground">{pct !== null ? `${pct}%` : "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Situação</p>
              <span className="mt-0.5 inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {financialStatus === "dentro" ? "Dentro do esperado" : financialStatus === "acima" ? "Acima do esperado" : financialStatus === "abaixo" ? "Abaixo do esperado" : "Sem planejamento"}
              </span>
            </div>
          </div>

          {data.financial.planned > 0 && (
            <div className="mt-3">
              <AgencyInvestmentBar
                summary={resolveMonthPeriodSummary(
                  {
                    monthPlanned: data.financial.planned,
                    monthActual: data.financial.actual,
                    monthExpectedToDate: data.financial.expectedToDate,
                    monthStatus: data.financial.status,
                  },
                  data.monthLabel,
                  monthRange,
                )}
                monthTemporalStatus={monthTemporalStatus}
              />
            </div>
          )}

          {data.kpis.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-4 border-t border-border pt-3">
              {data.kpis.map((kpi) => (
                <div key={kpi.id}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{kpi.name}</p>
                  <p className="mt-0.5 text-base font-semibold text-foreground">{formatKpiValue(kpi.result, kpi.unit)}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Resumo executivo do mês</p>
            {isReadOnly ? (
              <p className="text-sm text-foreground">{data.executiveSummary || "Sem resumo executivo registrado."}</p>
            ) : (
              <form action={updateReportFieldsAction.bind(null, clientId, data.monthStart)} className="flex flex-col gap-1.5">
                <textarea
                  name="executive_summary"
                  defaultValue={data.executiveSummary ?? ""}
                  rows={3}
                  placeholder="O que aconteceu com a conta neste mês?"
                  className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground outline-none focus:border-zinc-500"
                />
                <button type="submit" className="self-end rounded-md bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-hover">
                  Salvar
                </button>
              </form>
            )}
          </div>
        </SectionCard>

        {/* Bloco 2 — Performance */}
        <SectionCard id="performance" title="Performance">
          {data.kpis.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum KPI configurado para este cliente ainda. Configure em{" "}
              <Link href={`/clients/${clientId}/edit`} className="text-brand hover:underline">
                Editar cliente
              </Link>
              .
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-3">KPI</th>
                    <th className="py-1.5 pr-3">Meta</th>
                    <th className="py-1.5 pr-3">Resultado do mês</th>
                    <th className="py-1.5 pr-3">Mês anterior</th>
                    <th className="py-1.5 pr-3">Variação</th>
                    <th className="py-1.5 pr-3">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {data.kpis.map((kpi) => {
                    const targetStatus = classifyKpiTargetStatus(kpi.result, kpi.target, kpi.direction);
                    const variation = computeKpiVariationPct(kpi.result, kpi.previousResult);
                    return (
                      <tr key={kpi.id} className="border-b border-border/60 last:border-0">
                        <td className="py-1.5 pr-3 font-medium text-foreground">{kpi.name}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{kpi.target !== null ? formatKpiValue(kpi.target, kpi.unit) : "—"}</td>
                        <td className="py-1.5 pr-3">
                          {isReadOnly ? (
                            <span className="text-foreground">{formatKpiValue(kpi.result, kpi.unit)}</span>
                          ) : (
                            <form action={updateKpiValueAction.bind(null, clientId, data.monthStart, kpi.id)} className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.01"
                                name="result"
                                defaultValue={kpi.result ?? ""}
                                className="w-24 rounded-md border border-border bg-transparent px-1.5 py-0.5 text-sm text-foreground outline-none focus:border-zinc-500"
                              />
                              <button type="submit" className="rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900">
                                Salvar
                              </button>
                            </form>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{formatKpiValue(kpi.previousResult, kpi.unit)}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{variation !== null ? `${variation > 0 ? "+" : ""}${Math.round(variation)}%` : "—"}</td>
                        <td className="py-1.5 pr-3">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${KPI_TARGET_STATUS_BADGE_CLASSES[targetStatus]}`}>
                            {KPI_TARGET_STATUS_LABEL[targetStatus]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* Bloco 3 — Execução da agência */}
        <SectionCard
          id="execucao"
          title="Execução da agência"
          action={
            <Link href={`/clients/${clientId}${month ? `?month=${month}` : ""}`} className="text-xs font-medium text-brand hover:underline">
              Ver execução completa
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Otimizações realizadas</p>
              <p className="text-base font-semibold text-foreground">{data.execution.optimizationsDone}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Reuniões realizadas</p>
              <p className="text-base font-semibold text-foreground">{data.execution.meetingsDone}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Entregas de criativos</p>
              <p className="text-base font-semibold text-foreground">{data.execution.creativeDeliveriesDone}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Tarefas concluídas</p>
              <p className="text-base font-semibold text-foreground">{data.execution.operationalTasksDone}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Tarefas atrasadas</p>
              <p className="text-base font-semibold text-red-600 dark:text-red-400">{data.execution.overdueTasks}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cadências não cumpridas</p>
              <p className="text-base font-semibold text-amber-600 dark:text-amber-400">{data.execution.missedCadences}</p>
            </div>
          </div>
        </SectionCard>

        {/* Bloco 4 — Comportamento por sprint */}
        <SectionCard id="comportamento-sprint" title="Comportamento por sprint">
          {data.sprintBehavior.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-3">Sprint</th>
                    <th className="py-1.5 pr-3 text-right">Planejado</th>
                    <th className="py-1.5 pr-3 text-right">Realizado</th>
                    <th className="py-1.5 pr-3 text-right">%</th>
                    <th className="py-1.5 pr-3">Situação</th>
                    <th className="py-1.5 pr-3 text-right">Execução</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sprintBehavior.map((sprint) => (
                    <tr key={sprint.sprintId} className="border-b border-border/60 last:border-0">
                      <td className="py-1.5 pr-3 font-medium text-foreground">{sprint.periodLabel}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{formatCurrency(sprint.planned)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{formatCurrency(sprint.actual)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                        {sprint.pct !== null ? `${Math.round(sprint.pct)}%` : "—"}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SPEND_STATUS_BADGE_CLASSES[sprint.status]}`}>
                          {SITUATION_LABEL[sprint.status]}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                        {sprint.executionPct !== null ? `${Math.round(sprint.executionPct)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma sprint neste mês ainda.</p>
          )}
        </SectionCard>

        {/* Bloco 5 — Acontecimentos e decisões */}
        <SectionCard id="linha-do-tempo" title="Acontecimentos e decisões">
          {data.timelineEvents.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {data.timelineEvents.map((event) => (
                <li key={event.id} className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">{formatShortDate(event.date)}</span>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {TIMELINE_TYPE_LABEL[event.type]}
                      </span>
                      {event.responsibleName && <span>{event.responsibleName}</span>}
                    </div>
                    <p className="mt-1 text-foreground">{event.description}</p>
                  </div>
                  {!isReadOnly && (
                    <form action={deleteTimelineEventAction.bind(null, event.id, clientId, data.monthStart)}>
                      <button type="submit" className="shrink-0 text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400">
                        Remover
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum acontecimento registrado ainda.</p>
          )}

          {!isReadOnly && (
            <form action={addTimelineEventAction.bind(null, clientId, data.monthStart)} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">Data</label>
                <input type="date" name="event_date" required className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">Tipo</label>
                <select name="type" defaultValue="outro" className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground">
                  {Object.entries(TIMELINE_TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">Responsável</label>
                <select name="responsible_id" defaultValue="" className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground">
                  <option value="">—</option>
                  {responsibleOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">Descrição</label>
                <input name="description" required placeholder="O que aconteceu?" className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground" />
              </div>
              <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">
                Adicionar
              </button>
            </form>
          )}
        </SectionCard>

        {/* Bloco 6 — Análise do gestor: retrospectiva do mês (diferente do
            Bloco 8, que é prospectivo — nunca a mesma pergunta duas vezes). */}
        <SectionCard id="analise-gestor" title="Análise do gestor">
          {isReadOnly ? (
            <div className="flex flex-col gap-3 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground">O que funcionou?</p>
                <p className="text-foreground">{data.analysisWhatWorked || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">O que não funcionou?</p>
                <p className="text-foreground">{data.analysisWhatDidntWork || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Quais problemas foram identificados?</p>
                <p className="text-foreground">{data.analysisProblems || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Quais oportunidades foram identificadas?</p>
                <p className="text-foreground">{data.analysisOpportunities || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">O que aprendemos neste mês?</p>
                <p className="text-foreground">{data.analysisLearnings || "—"}</p>
              </div>
            </div>
          ) : (
            <form action={updateReportFieldsAction.bind(null, clientId, data.monthStart)} className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">O que funcionou?</label>
                <textarea
                  name="analysis_what_worked"
                  defaultValue={data.analysisWhatWorked ?? ""}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">O que não funcionou?</label>
                <textarea
                  name="analysis_what_didnt_work"
                  defaultValue={data.analysisWhatDidntWork ?? ""}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Quais problemas foram identificados?</label>
                <textarea
                  name="analysis_problems"
                  defaultValue={data.analysisProblems ?? ""}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Quais oportunidades foram identificadas?</label>
                <textarea
                  name="analysis_opportunities"
                  defaultValue={data.analysisOpportunities ?? ""}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">O que aprendemos neste mês?</label>
                <textarea
                  name="analysis_learnings"
                  defaultValue={data.analysisLearnings ?? ""}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-zinc-500"
                />
              </div>
              <button type="submit" className="self-end rounded-md bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-hover">
                Salvar
              </button>
            </form>
          )}
        </SectionCard>

        {/* Bloco 7 — Pendências: execução em aberto (responsável/prazo/
            dependência/status) — nunca as tarefas da sprint, que continuam
            só em /clients/[id]. Diferente do Bloco 8 (síntese estratégica,
            sem checklist). */}
        <SectionCard id="pendencias" title="Pendências">
          {data.actionItems.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {data.actionItems.map((item) => (
                <li key={item.id} className="rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-foreground">{item.title || item.description}</p>
                    {!isReadOnly && (
                      <form action={updateActionItemStatusAction.bind(null, item.id, clientId, data.monthStart)} className="flex items-center gap-1">
                        <select
                          name="status"
                          defaultValue={item.status}
                          className="rounded-md border border-border bg-transparent px-1.5 py-0.5 text-xs text-foreground"
                        >
                          {Object.entries(ACTION_ITEM_STATUS_LABEL).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900">
                          Salvar
                        </button>
                      </form>
                    )}
                    {isReadOnly && (
                      <span className="text-xs text-muted-foreground">{ACTION_ITEM_STATUS_LABEL[item.status]}</span>
                    )}
                  </div>
                  {item.title && <p className="mt-0.5 text-foreground">{item.description}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {item.responsibleName && <span>{item.responsibleName}</span>}
                    {item.dueDate && <span>Prazo: {formatShortDate(item.dueDate)}</span>}
                    {item.dependency && <span>Depende de: {REPORT_ACTION_ITEM_DEPENDENCY_LABEL[item.dependency]}</span>}
                    {!isReadOnly && !item.sentToTaskId && (
                      <form action={sendActionItemToSprintAction.bind(null, item.id, clientId, data.monthStart)}>
                        <button type="submit" className="font-medium text-brand hover:underline">
                          Enviar para próxima sprint
                        </button>
                      </form>
                    )}
                    {item.sentToTaskId && <span className="text-brand">Enviado para a próxima sprint</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma pendência registrada.</p>
          )}

          {!isReadOnly && (
            <form action={addActionItemAction.bind(null, clientId, data.monthStart)} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">Título</label>
                <input name="title" placeholder="Título curto" className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground" />
              </div>
              <div className="flex min-w-[220px] flex-1 flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">Descrição</label>
                <input name="description" required placeholder="O que precisa acontecer?" className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">Responsável</label>
                <select name="responsible_id" defaultValue="" className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground">
                  <option value="">—</option>
                  {responsibleOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">Prazo</label>
                <input type="date" name="due_date" className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">Depende de</label>
                <select name="dependency" defaultValue="" className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground">
                  <option value="">—</option>
                  {DEPENDENCY_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {REPORT_ACTION_ITEM_DEPENDENCY_LABEL[value]}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">
                Adicionar
              </button>
            </form>
          )}
        </SectionCard>

        {/* Bloco 8 — Próximos passos: síntese estratégica, nunca um checklist
            operacional (isso são as Pendências, acima, ou as tarefas da
            sprint em /clients/[id]). */}
        <SectionCard id="proximos-passos" title="Próximos passos">
          {isReadOnly ? (
            <div className="flex flex-col gap-3 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Principal prioridade</p>
                <p className="text-foreground">{data.nextMonthPriority || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Ajustes recomendados</p>
                <p className="text-foreground">{data.nextMonthProblems || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Oportunidades e recomendações</p>
                <p className="text-foreground">{data.nextMonthOpportunities || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Testes planejados</p>
                <p className="text-foreground">{data.nextMonthTests || "—"}</p>
              </div>
            </div>
          ) : (
            <form action={updateReportFieldsAction.bind(null, clientId, data.monthStart)} className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Principal prioridade</label>
                <input
                  name="next_month_priority"
                  defaultValue={data.nextMonthPriority ?? ""}
                  className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Ajustes recomendados</label>
                <textarea
                  name="next_month_problems"
                  defaultValue={data.nextMonthProblems ?? ""}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Oportunidades e recomendações</label>
                <textarea
                  name="next_month_opportunities"
                  defaultValue={data.nextMonthOpportunities ?? ""}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Testes planejados</label>
                <textarea
                  name="next_month_tests"
                  defaultValue={data.nextMonthTests ?? ""}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus:border-zinc-500"
                />
              </div>
              <button type="submit" className="self-end rounded-md bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-hover">
                Salvar
              </button>
            </form>
          )}
        </SectionCard>

        {/* Status do relatório */}
        <SectionCard id="status" title="Status do relatório">
          <div className="flex flex-wrap items-center gap-3">
            {!isReadOnly && (
              <form action={updateReportStatusAction.bind(null, clientId, data.monthStart)} className="flex items-center gap-2">
                <select
                  name="status"
                  defaultValue={data.status}
                  className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
                >
                  <option value="nao_iniciado">Não iniciado</option>
                  <option value="em_andamento">Em andamento</option>
                  <option value="pronto_revisao">Pronto para revisão</option>
                </select>
                <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900">
                  Salvar
                </button>
              </form>
            )}

            {isAdmin && data.status === "pronto_revisao" && (
              <form action={finalizeReportAction.bind(null, clientId, data.monthStart)}>
                <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">
                  Finalizar relatório
                </button>
              </form>
            )}

            {isAdmin && data.status === "finalizado" && (
              <form action={reopenReportAction.bind(null, clientId, data.monthStart)}>
                <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900">
                  Reabrir relatório
                </button>
              </form>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
