import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { currentMonthRange, monthRangeFromParam, shiftMonthParam } from "@/lib/sprint-financials";
import { todayDateString, todayUTC } from "@/lib/today";
import { formatMonthLabel } from "@/lib/format";
import { IconButton } from "@/components/workspace/button";
import { SubmitButton } from "@/app/submit-button";
import { loadOperationSectionData } from "../../operation-section-data";
import { OperationSection } from "../../operation-section";
import { generateClientUpdateAction } from "../../client-update-actions";
import { WorkspaceContainer } from "../../workspace-container";

function withParam(url: string, param: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${param}`;
}

/**
 * `/clients/[id]/operation` — Operação do cliente. Continua existindo
 * como rota de APROFUNDAMENTO/deep-link (Etapa "Correção de Direção do
 * Workspace", seção 12 do pedido: "não deletar" — o centro da experiência
 * voltou a ser `[id]/page.tsx`, que agora mostra esta MESMA seção por
 * completo, não mais um resumo).
 *
 * Dados/JSX vêm de `loadOperationSectionData`/`OperationSection`
 * (`../../operation-section-data.ts`/`../../operation-section.tsx`) —
 * extraídos 1:1 daqui pra serem reaproveitados pelo Painel principal sem
 * duplicar a lógica em dois arquivos. Tarefas aqui são SEMPRE
 * `origin='template'` — nunca `origin='manual'` (Demandas).
 */
export default async function ClientOperationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    month?: string;
    task?: string;
    taskError?: string;
    review?: string;
    reviewError?: string;
    reviewDetail?: string;
    reviewSaved?: string;
    clientUpdateError?: string;
    recurringTaskDetail?: string;
    recurringTaskSprint?: string;
    recurringTaskError?: string;
    historyPage?: string;
  }>;
}) {
  const { id } = await params;
  const {
    month: monthQueryParam,
    task: openTaskId,
    taskError,
    review: openReview,
    reviewError,
    reviewDetail: openReviewDetailId,
    reviewSaved,
    clientUpdateError,
    recurringTaskDetail: openRecurringTaskId,
    recurringTaskSprint: openRecurringTaskSprintId,
    recurringTaskError,
    historyPage: historyPageParam,
  } = await searchParams;

  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  const supabase = await createSupabaseClient();

  const { data: client, error: clientQueryError } = await supabase
    .from("clients")
    .select("id, name, status, performance_goal, target_cost_per_result, media_channels, primary_manager:team_members!clients_primary_manager_id_fkey(name)")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (clientQueryError) console.error(`[ClientOperationPage] falha ao buscar cliente ${id}:`, clientQueryError);
  if (!client) notFound();

  const canOperate = client.status === "ativo";
  const today = todayUTC();
  const todayStr = todayDateString();
  const { firstDay, lastDay } = monthRangeFromParam(monthQueryParam, today);
  const isCurrentMonth = firstDay === currentMonthRange(today).firstDay;
  const monthLabel = formatMonthLabel(firstDay);
  const monthQuery = monthQueryParam ? `?month=${monthQueryParam}` : "";
  const returnTo = `/clients/${id}/operation${monthQuery}`;
  const prevMonthHref = `/clients/${id}/operation?month=${shiftMonthParam({ firstDay }, -1)}`;
  const nextMonthHref = `/clients/${id}/operation?month=${shiftMonthParam({ firstDay }, 1)}`;
  const taskHrefPrefix = `/clients/${id}/operation${monthQuery ? `${monthQuery}&` : "?"}task=`;

  const data = await loadOperationSectionData(supabase, {
    id,
    firstDay,
    lastDay,
    today,
    todayStr,
    isCurrentMonth,
    performanceGoal: client.performance_goal,
    targetCostPerResultFallback: client.target_cost_per_result,
    returnTo,
    openTaskId,
    openReviewDetailId,
    openRecurringTaskId,
    openRecurringTaskSprintId,
    historyPageParam,
  });

  return (
    <WorkspaceContainer>
      <Link href={`/clients/${id}`} className="text-sm font-semibold text-overview-text-secondary hover:text-overview-text-primary">
        &larr; {client.name}
      </Link>

      {(taskError || reviewError || recurringTaskError || clientUpdateError) && (
        <div className="flex flex-col gap-2">
          {[taskError, reviewError, recurringTaskError, clientUpdateError].filter(Boolean).map((message, index) => (
            <p key={index} className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {message}
            </p>
          ))}
        </div>
      )}

      {reviewSaved && !data.clientUpdatesByReviewId.has(reviewSaved) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-overview-border bg-overview-surface px-3 py-2 text-sm">
          <span className="text-overview-text-primary">Revisão de conta registrada com sucesso.</span>
          <div className="flex items-center gap-2">
            <form action={generateClientUpdateAction.bind(null, reviewSaved, withParam(returnTo, `reviewDetail=${reviewSaved}`))}>
              <SubmitButton pendingChildren="Gerando..." className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">
                Gerar atualização
              </SubmitButton>
            </form>
            <Link href={returnTo} className="rounded-md border border-overview-border px-3 py-1.5 text-xs font-medium text-overview-text-secondary hover:bg-overview-surface-hover">
              Fechar
            </Link>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 border-b border-overview-border pb-2">
        <div className="flex items-center gap-0.5">
          <IconButton href={prevMonthHref} aria-label="Mês anterior" variant="ghost" size="sm">
            &lsaquo;
          </IconButton>
          <span className="min-w-[6rem] px-1 text-center text-sm font-medium text-overview-text-primary">{monthLabel}</span>
          <IconButton href={nextMonthHref} aria-label="Próximo mês" variant="ghost" size="sm">
            &rsaquo;
          </IconButton>
        </div>
        <Link href={withParam(returnTo, "review=new")} scroll={false} className="ml-auto text-sm font-medium text-brand hover:underline">
          + Registrar revisão
        </Link>
      </div>

      <OperationSection
        data={data}
        clientId={id}
        clientName={client.name}
        primaryManagerName={client.primary_manager?.name ?? null}
        monthLabel={monthLabel}
        isAdmin={isAdmin}
        canOperate={canOperate}
        returnTo={returnTo}
        taskHrefPrefix={taskHrefPrefix}
        openReview={openReview}
        reviewError={reviewError}
      />
    </WorkspaceContainer>
  );
}
