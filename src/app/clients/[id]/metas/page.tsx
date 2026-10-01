import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { monthRangeFromParam } from "@/lib/sprint-financials";
import { resolveBudgetEffectiveDate, resolvePlanningHorizon } from "@/lib/monthly-budget";
import { getClientMonthHorizon } from "@/lib/client-month-horizons";
import { todayDateString, todayUTC } from "@/lib/today";
import { formatMonthLabel } from "@/lib/format";
import { AVAILABLE_TRAFFIC_CHANNELS } from "@/lib/traffic-channels";
import { loadMetasPageData } from "../../metas-data";
import { MetasSummaryTable } from "../../metas-summary-table";
import { MetasSecondaryTargetForm } from "../../metas-secondary-target-form";
import { ChannelPlanEditor } from "../../channel-plan-editor";
import { MonthSelect } from "../../month-select";
import { GoalSelect } from "../../goal-select";
import { WorkspaceContainer } from "../../workspace-container";

/**
 * `/clients/[id]/metas` — Etapa "MEGA FACELIFT — Fase 2: Metas". Primeira
 * tela genuinamente nova da Growth Infra: "pra onde estamos indo e
 * estamos no ritmo certo?", nunca uma investigação de origem do resultado
 * (isso é `/relatorio`/Performance). Contexto GLOBAL é o cliente (header
 * do workspace, inalterado); contextos LOCAIS são Mês + Objetivo
 * (`?month=`/`?goal=`, mesmo vocabulário já usado em `[id]/page.tsx` —
 * nunca um terceiro param pra uma ideia que já existe).
 */
export function buildMetasHref(clientId: string, current: { month?: string; goal?: string }, overrides: { month?: string; goal?: string | null }): string {
  const params = new URLSearchParams();
  const monthValue = overrides.month ?? current.month;
  if (monthValue) params.set("month", monthValue);
  const goalValue = overrides.goal !== undefined ? overrides.goal : current.goal;
  if (goalValue) params.set("goal", goalValue);
  const qs = params.toString();
  return `/clients/${clientId}/metas${qs ? `?${qs}` : ""}`;
}

export default async function ClientMetasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; goal?: string; error?: string }>;
}) {
  const { id } = await params;
  const { month: monthQueryParam, goal: goalParam, error } = await searchParams;

  function buildHref(overrides: { month?: string; goal?: string | null }): string {
    return buildMetasHref(id, { month: monthQueryParam, goal: goalParam }, overrides);
  }

  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  const supabase = await createSupabaseClient();

  const today = todayUTC();
  const todayStr = todayDateString();
  const { firstDay, lastDay } = monthRangeFromParam(monthQueryParam, today);
  const monthParam = firstDay.slice(0, 7);
  const monthLabel = formatMonthLabel(firstDay);
  const returnTo = buildHref({});

  const data = await loadMetasPageData(supabase, id, { firstDay, lastDay }, todayStr, goalParam);
  if (!data) notFound();

  const planningEndDate = await getClientMonthHorizon(supabase, id, firstDay);
  const planningHorizon = resolvePlanningHorizon({ firstDay, lastDay }, planningEndDate);
  const { effectiveDate, isClosedMonth } = resolveBudgetEffectiveDate(planningHorizon, todayStr);

  return (
    <WorkspaceContainer>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-overview-text-primary">Metas</h1>
          <p className="mt-0.5 text-sm text-overview-text-secondary">Para onde este cliente está indo, e se o ritmo até aqui está certo.</p>
        </div>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <MonthSelect today={today} selectedMonthParam={monthParam} buildHref={(value) => buildHref({ month: value })} />
        <GoalSelect
          goals={data.goals}
          selectedResultType={data.selectedGoal?.resultType ?? null}
          buildHref={(resultType) => buildHref({ goal: resultType })}
        />
      </div>

      {data.goals.length === 0 ? (
        <div className="mt-4 rounded-lg border border-overview-border bg-overview-surface p-6">
          <p className="text-sm text-overview-text-secondary">
            Nenhum objetivo configurado ainda para este cliente.{" "}
            <Link href={`/clients/${id}/edit`} className="font-medium text-brand hover:underline">
              Configurar em Cadastro do cliente →
            </Link>
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4">
            <MetasSummaryTable rows={data.rows} />
          </div>

          <div className="mt-4">
            {!isAdmin || isClosedMonth || !effectiveDate ? (
              <p className="text-xs text-overview-text-secondary">
                {isClosedMonth ? "Período de planejamento encerrado — o histórico não pode ser alterado por aqui." : "Planejamento visível só para administradores."}
              </p>
            ) : data.isPrimary ? (
              <ChannelPlanEditor
                clientId={id}
                monthParam={monthParam}
                monthLabel={monthLabel}
                monthRange={{ firstDay, lastDay }}
                currentPlanningEndDate={planningEndDate}
                channels={AVAILABLE_TRAFFIC_CHANNELS}
                byChannel={data.selectedGoalPlan.byChannel}
                performanceGoal={data.selectedGoal?.resultType ?? null}
              />
            ) : (
              data.selectedGoal && (
                <MetasSecondaryTargetForm
                  clientId={id}
                  returnTo={returnTo}
                  resultType={data.selectedGoal.resultType}
                  monthFirstDay={firstDay}
                  channels={data.selectedGoal.channels.length > 0 ? data.selectedGoal.channels : AVAILABLE_TRAFFIC_CHANNELS}
                  currentTargetByChannel={data.selectedGoalPlan.byChannel}
                />
              )
            )}
          </div>
        </>
      )}
    </WorkspaceContainer>
  );
}
