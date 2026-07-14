import Link from "next/link";
import { formatRelativeDateTime, formatShortDate } from "@/lib/format";
import { OPTIMIZATION_TYPE_LABEL } from "@/lib/account-reviews";
import type { OperationalTrackingRow, MonthlyOccurrenceSummary } from "@/lib/operational-tracking";
import type { ClientHistoryRow } from "@/lib/client-operational-history";
import { completeTaskAction, markTaskNotDoneAction } from "./tasks-actions";
import { todayDateString } from "@/lib/today";
import type { OptimizationType } from "@/lib/supabase/database.types";

export interface LastReviewInfo {
  reviewedAt: string;
  managerName: string;
}

export interface LastOptimizationInfo {
  type: OptimizationType;
  occurredAt: string;
  managerName: string;
}

/** Anexa parâmetros a uma URL que já pode ou não ter query string (usada
 * pra montar os links do drawer de agendamento sempre em cima da URL atual
 * da página do cliente — que já pode ter `?month=...`). */
function appendParams(url: string, params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) usp.set(key, value);
  return `${url}${url.includes("?") ? "&" : "?"}${usp.toString()}`;
}

const TRACKED_TYPE_LABEL: Record<OperationalTrackingRow["type"], string> = {
  reuniao: "Próxima reunião",
  entrega_criativo: "Próxima entrega",
};

const TRACKED_TYPE_EMPTY_LABEL: Record<OperationalTrackingRow["type"], string> = {
  reuniao: "Nenhuma reunião agendada",
  entrega_criativo: "Nenhuma entrega agendada",
};

const TRACKED_TYPE_SCHEDULE_LABEL: Record<OperationalTrackingRow["type"], string> = {
  reuniao: "Agendar reunião",
  entrega_criativo: "Agendar entrega",
};

const MONTHLY_SUMMARY_LABEL: Record<MonthlyOccurrenceSummary["type"], string> = {
  reuniao: "Reuniões",
  entrega_criativo: "Entregas",
};

/**
 * Célula de reunião/entrega dentro do Acompanhamento da Conta — só usada
 * quando o mês selecionado é o atual (Etapa 7 do pedido); meses anteriores
 * usam `MonthlyOccurrenceCell` (Etapa 8), que nunca mostra "próxima" (não
 * faz sentido pra um mês que já passou). Agendar/editar/reagendar abrem o
 * drawer compacto (`ScheduleOccurrenceDrawer`) na própria página — nunca
 * navegam pra edição completa do cliente.
 */
function TrackedOccurrenceCell({
  row,
  clientId,
  returnTo,
}: {
  row: OperationalTrackingRow;
  clientId: string;
  returnTo: string;
}) {
  const scheduleHref = appendParams(returnTo, { scheduleOccurrence: row.type });

  if (row.nextTaskId === null) {
    return (
      <div className="flex flex-col gap-0.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {TRACKED_TYPE_LABEL[row.type]}
        </p>
        <p className="text-sm text-muted-foreground">{TRACKED_TYPE_EMPTY_LABEL[row.type]}</p>
        <Link href={scheduleHref} scroll={false} className="text-xs font-medium text-brand hover:underline">
          {TRACKED_TYPE_SCHEDULE_LABEL[row.type]}
        </Link>
      </div>
    );
  }

  const isDue = row.nextIsOverdue || (row.nextDueDate !== null && row.nextDueDate <= todayDateString());
  const editHref = appendParams(returnTo, { scheduleOccurrence: row.type, scheduleTaskId: row.nextTaskId });

  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {TRACKED_TYPE_LABEL[row.type]}
      </p>
      <p className={`text-sm ${row.nextIsOverdue ? "font-medium text-red-600 dark:text-red-400" : "text-foreground"}`}>
        {row.nextDueDate ? formatShortDate(row.nextDueDate) : "—"}
        {row.nextDueTime ? ` às ${row.nextDueTime.slice(0, 5)}` : ""}
        {row.nextIsOverdue ? " · atrasada" : " · agendada"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={editHref} scroll={false} className="text-xs font-medium text-brand hover:underline">
          Editar/Reagendar
        </Link>
        {isDue && (
          <>
            <form action={completeTaskAction.bind(null, row.nextTaskId, clientId)}>
              <button type="submit" className="text-xs font-medium text-brand hover:underline">
                Marcar como realizada
              </button>
            </form>
            <form action={markTaskNotDoneAction.bind(null, row.nextTaskId, clientId)}>
              <button type="submit" className="text-xs font-medium text-muted-foreground hover:underline">
                Marcar como não realizada
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/** Célula de reunião/entrega quando o mês selecionado NÃO é o atual (Etapa
 * 8) — só o resultado objetivo do período, sem nenhuma ação de agendar
 * (agendar sempre se refere ao futuro, e um mês passado não tem "próxima"
 * ocorrência por definição). */
function MonthlyOccurrenceCell({ summary, monthLabel }: { summary: MonthlyOccurrenceSummary; monthLabel: string }) {
  const parts: string[] = [];
  if (summary.doneCount > 0) parts.push(`${summary.doneCount} realizada${summary.doneCount === 1 ? "" : "s"}`);
  if (summary.notDoneCount > 0)
    parts.push(`${summary.notDoneCount} não realizada${summary.notDoneCount === 1 ? "" : "s"}`);
  if (summary.unresolvedCount > 0) parts.push(`${summary.unresolvedCount} sem desfecho`);

  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {MONTHLY_SUMMARY_LABEL[summary.type]} de {monthLabel}
      </p>
      <p className="text-sm text-foreground">{parts.length > 0 ? parts.join(" · ") : "Nenhuma registrada"}</p>
    </div>
  );
}

function HistoryRow({
  event,
  buildReviewDetailHref,
}: {
  event: ClientHistoryRow;
  buildReviewDetailHref: (id: string) => string;
}) {
  return (
    <li className="flex items-start justify-between gap-2 border-t border-border py-1.5 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums">{formatRelativeDateTime(event.occurredAt, new Date())}</span>
          <span className="font-medium text-foreground">{event.label}</span>
          {event.detail && <span>{event.detail}</span>}
        </div>
        {event.responsibleName && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{event.responsibleName}</p>
        )}
      </div>
      {event.reviewId && (
        <Link
          href={buildReviewDetailHref(event.reviewId)}
          scroll={false}
          className="shrink-0 text-xs font-medium text-brand hover:underline"
        >
          Ver análise
        </Link>
      )}
    </li>
  );
}

/**
 * "ACOMPANHAMENTO DA CONTA" — principal bloco operacional da página do
 * cliente. Absorve reuniões e entregas de criativo (que antes viviam num
 * bloco separado, "Rotina do cliente", removido da interface — os dados,
 * tabela e lógica de `tasks`/`computeOperationalTracking` continuam
 * exatamente os mesmos, só a apresentação muda). "Cadência" e "Intervalo
 * atual" foram removidos da interface por pedido explícito — continuam
 * existindo por baixo, intactos, só não são mais exibidos aqui.
 *
 * Etapa 62: o bloco agora respeita o mês selecionado na página inteira
 * (`isCurrentMonth`). No mês atual, última análise/otimização e próxima
 * reunião/entrega são sempre o dado GLOBAL mais recente (nunca só do mês)
 * — é assim que já funcionava. Num mês anterior, os mesmos indicadores
 * passam a ser escopados ao mês selecionado (Etapa 8): sem "próxima" (não
 * existe "próxima" num mês fechado), só o resultado objetivo do que
 * aconteceu. O histórico (antes só de análises, sempre as 2 mais recentes)
 * virou um histórico unificado (análises + otimizações + reuniões +
 * entregas) escopado ao mês selecionado, no máximo 5 linhas, com "Ver
 * todos de {mês}" pro resto (Etapa 9) — reaproveita `operational_events`
 * (nenhuma tabela nova, ver `lib/client-operational-history.ts`).
 */
export function AccountFollowUpPanel({
  monthLabel,
  isCurrentMonth,
  lastReview,
  lastOptimization,
  tracking,
  monthlySummary,
  historyRows,
  hasMoreHistory,
  historyHref,
  newReviewHref,
  buildReviewDetailHref,
  clientId,
  returnTo,
}: {
  monthLabel: string;
  isCurrentMonth: boolean;
  lastReview: LastReviewInfo | null;
  lastOptimization: LastOptimizationInfo | null;
  tracking: Record<"reuniao" | "entrega_criativo", OperationalTrackingRow>;
  monthlySummary: Record<"reuniao" | "entrega_criativo", MonthlyOccurrenceSummary>;
  historyRows: ClientHistoryRow[];
  hasMoreHistory: boolean;
  historyHref: string;
  newReviewHref: string;
  buildReviewDetailHref: (reviewId: string) => string;
  clientId: string;
  returnTo: string;
}) {
  const lastReviewLabelPrefix = isCurrentMonth ? "Última análise" : `Última análise em ${monthLabel}`;
  const lastReviewValue = lastReview
    ? formatRelativeDateTime(lastReview.reviewedAt, new Date())
    : "Sem análise registrada";

  const lastOptimizationLabelPrefix = isCurrentMonth ? "Última otimização" : `Última otimização em ${monthLabel}`;
  const lastOptimizationValue = lastOptimization
    ? `${OPTIMIZATION_TYPE_LABEL[lastOptimization.type]} · ${formatShortDate(lastOptimization.occurredAt.slice(0, 10))}`
    : "Nenhuma otimização registrada";

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h2 className="text-sm font-medium text-foreground">Acompanhamento da conta</h2>
        <Link
          href={newReviewHref}
          scroll={false}
          className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-hover"
        >
          + Registrar análise
        </Link>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {lastReviewLabelPrefix}
          </p>
          <p className="text-sm text-foreground">{lastReviewValue}</p>
          {lastReview && <p className="text-xs text-muted-foreground">{lastReview.managerName}</p>}
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {lastOptimizationLabelPrefix}
          </p>
          <p className="text-sm text-foreground">{lastOptimizationValue}</p>
          {lastOptimization && <p className="text-xs text-muted-foreground">{lastOptimization.managerName}</p>}
        </div>
        {isCurrentMonth ? (
          <>
            <TrackedOccurrenceCell row={tracking.reuniao} clientId={clientId} returnTo={returnTo} />
            <TrackedOccurrenceCell row={tracking.entrega_criativo} clientId={clientId} returnTo={returnTo} />
          </>
        ) : (
          <>
            <MonthlyOccurrenceCell summary={monthlySummary.reuniao} monthLabel={monthLabel} />
            <MonthlyOccurrenceCell summary={monthlySummary.entrega_criativo} monthLabel={monthLabel} />
          </>
        )}
      </div>

      <div className="mt-3 border-t border-border pt-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Histórico de {monthLabel}
          </p>
          {hasMoreHistory && (
            <Link href={historyHref} scroll={false} className="text-xs font-medium text-brand hover:underline">
              Ver todos de {monthLabel}
            </Link>
          )}
        </div>

        {historyRows.length > 0 ? (
          <ul className="mt-1 flex flex-col">
            {historyRows.map((event) => (
              <HistoryRow key={event.id} event={event} buildReviewDetailHref={buildReviewDetailHref} />
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Nenhum evento registrado em {monthLabel}.</p>
        )}
      </div>
    </div>
  );
}
