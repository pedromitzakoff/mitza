import Link from "next/link";
import { formatRelativeDateTime, formatShortDate } from "@/lib/format";
import { ACCOUNT_REVIEW_OUTCOME_LABEL, OPTIMIZATION_TYPE_LABEL } from "@/lib/account-reviews";
import type { OperationalTrackingRow, MonthlyOccurrenceSummary } from "@/lib/operational-tracking";
import { completeTaskAction, markTaskNotDoneAction } from "./tasks-actions";
import { todayDateString } from "@/lib/today";
import type { LastOptimizationInfo } from "./account-follow-up-panel";

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

/** Detalhe da última otimização, conforme o resultado da revisão (Etapa 74):
 * alteração realizada mostra a área revisada (ou a quantidade, se mais de
 * uma); problema identificado mostra a descrição; sem alteração necessária
 * não precisa de detalhe extra (o próprio rótulo já diz tudo). */
function lastOptimizationDetail(info: LastOptimizationInfo): string | null {
  if (info.outcome === "OPTIMIZATION_PERFORMED") {
    if (info.optimizationTypes.length === 1) return OPTIMIZATION_TYPE_LABEL[info.optimizationTypes[0]];
    if (info.optimizationTypes.length > 1) return `${info.optimizationTypes.length} alterações`;
    return null;
  }
  if (info.outcome === "ISSUE_IDENTIFIED") return info.issueDescription;
  return null;
}

/**
 * "Resumo operacional da conta" — última otimização (revisão estratégica da
 * conta, independentemente do resultado) + próxima reunião/entrega (ou o
 * resumo mensal, num mês passado). Etapa 74: substitui os antigos "Última
 * análise"/"Última otimização" por um único indicador — nunca dois cartões
 * pro mesmo evento.
 */
export function AccountActivitySummary({
  monthLabel,
  isCurrentMonth,
  lastOptimization,
  tracking,
  monthlySummary,
  clientId,
  returnTo,
}: {
  monthLabel: string;
  isCurrentMonth: boolean;
  lastOptimization: LastOptimizationInfo | null;
  tracking: Record<"reuniao" | "entrega_criativo", OperationalTrackingRow>;
  monthlySummary: Record<"reuniao" | "entrega_criativo", MonthlyOccurrenceSummary>;
  clientId: string;
  returnTo: string;
}) {
  const lastOptimizationLabelPrefix = isCurrentMonth ? "Última revisão de conta" : `Última revisão de conta em ${monthLabel}`;
  const lastOptimizationDateValue = lastOptimization
    ? formatRelativeDateTime(lastOptimization.reviewedAt, new Date())
    : "Sem revisão registrada";
  const detail = lastOptimization ? lastOptimizationDetail(lastOptimization) : null;

  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-2.5 sm:grid-cols-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {lastOptimizationLabelPrefix}
        </p>
        <p className="text-sm text-foreground">{lastOptimizationDateValue}</p>
        {lastOptimization && (
          <p className="text-xs text-muted-foreground">
            {ACCOUNT_REVIEW_OUTCOME_LABEL[lastOptimization.outcome]}
            {detail ? ` · ${detail}` : ""}
          </p>
        )}
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
  );
}
