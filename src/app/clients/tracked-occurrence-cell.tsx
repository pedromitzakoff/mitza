"use client";

import Link from "next/link";
import { useTransition } from "react";
import type { OperationalTrackingRow } from "@/lib/operational-tracking";
import { completeTaskAction, markTaskNotDoneAction } from "./tasks-actions";
import { todayDateString } from "@/lib/today";
import { formatShortDate } from "@/lib/format";
import { useToast } from "@/app/toast-provider";

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

/** Anexa parâmetros a uma URL que já pode ou não ter query string (usada
 * pra montar os links do drawer de agendamento sempre em cima da URL atual
 * da página do cliente — que já pode ter `?month=...`). */
function appendParams(url: string, params: Record<string, string>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) usp.set(key, value);
  return `${url}${url.includes("?") ? "&" : "?"}${usp.toString()}`;
}

/**
 * Célula de reunião/entrega dentro do Acompanhamento da Conta — só usada
 * quando o mês selecionado é o atual; meses anteriores usam
 * `MonthlyOccurrenceCell` (em `account-activity-summary.tsx`), que nunca
 * mostra "próxima" (não faz sentido pra um mês que já passou). Agendar/
 * editar/reagendar abrem o drawer compacto (`ScheduleOccurrenceDrawer`) na
 * própria página — nunca navegam pra edição completa do cliente.
 *
 * Etapa "MITZA Platform Integrity Wave 2" — extraído de
 * `account-activity-summary.tsx` e convertido pra Client Component:
 * `completeTaskAction`/`markTaskNotDoneAction` deixaram de redirecionar em
 * caso de erro (contrato único de Server Action), então as duas ações
 * precisam ser chamadas diretamente (não mais via `<form action>`) pra
 * poder mostrar o toast de erro em vez de falhar silenciosamente.
 */
export function TrackedOccurrenceCell({
  row,
  clientId,
  returnTo,
}: {
  row: OperationalTrackingRow;
  clientId: string;
  returnTo: string;
}) {
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
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

  const taskId = row.nextTaskId;
  const isDue = row.nextIsOverdue || (row.nextDueDate !== null && row.nextDueDate <= todayDateString());
  const editHref = appendParams(returnTo, { scheduleOccurrence: row.type, scheduleTaskId: taskId });

  function handleComplete() {
    startTransition(async () => {
      const result = await completeTaskAction(taskId, clientId);
      if (result?.error) {
        showToast(result.error, "error");
        return;
      }
      showToast("Marcada como realizada.");
    });
  }

  function handleNotDone() {
    startTransition(async () => {
      const result = await markTaskNotDoneAction(taskId, clientId);
      if (result?.error) {
        showToast(result.error, "error");
        return;
      }
      showToast("Marcada como não realizada.");
    });
  }

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
            <button
              type="button"
              disabled={isPending}
              onClick={handleComplete}
              className="text-xs font-medium text-brand hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              Marcar como realizada
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleNotDone}
              className="text-xs font-medium text-muted-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              Marcar como não realizada
            </button>
          </>
        )}
      </div>
    </div>
  );
}
