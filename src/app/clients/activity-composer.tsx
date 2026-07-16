"use client";

import { useRef, useState, useTransition } from "react";
import { createTaskInlineAction } from "./tasks-actions";
import { useToast } from "@/app/toast-provider";
import { isRedirectSignal } from "@/lib/next-redirect";
import { todayDateString } from "@/lib/today";
import type { TaskListItem } from "./task-row";

/**
 * Composer inline de "Atividades" (MITZA Unified Activities 1.0 — correção
 * de modelo de produto): criação rápida, sempre visível, só com título —
 * nunca um modal/drawer/popover. Enter publica; nenhum outro campo é
 * pedido aqui (responsável, data, tipo ficam com o valor padrão de sempre
 * e podem ser ajustados depois, na própria linha, abrindo o drawer oficial
 * da tarefa — progressive disclosure: primeiro registra o que precisa ser
 * feito, depois adiciona detalhes só quando necessário).
 *
 * Internamente isto continua sendo `createTaskInlineAction` (a mesma
 * Server Action de sempre) e o mesmo `TaskListItem` otimista de sempre —
 * "atividade" aqui é só a palavra que a interface usa; o domínio continua
 * sendo Tarefa. Revisão de conta NUNCA é criada por este composer (ver
 * `SprintPerformanceSection`, onde "+ Registrar revisão" agora vive) — as
 * duas entidades continuam com fluxos de criação diferentes mesmo
 * aparecendo na mesma fila de leitura.
 */
export function ActivityComposer({
  clientId,
  sprintId,
  onCreated,
}: {
  clientId: string;
  /** `null` cria uma tarefa solta, sem vínculo com sprint — mesmo campo
   * opcional que `createTaskInlineAction` já aceita (não usado hoje: este
   * composer só existe dentro de uma Sprint concreta). */
  sprintId: string | null;
  /** Despacha a inserção otimista na lista compartilhada — mesmo padrão
   * de sempre (`useOptimisticTasks`). */
  onCreated: (task: TaskListItem) => void;
}) {
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = value.trim();
    if (!title || isPending) return;

    const dueDate = todayDateString();
    // Campo limpo imediatamente (Parte 1: "o campo é limpo e permanece
    // disponível para a próxima atividade") — se a criação falhar, o texto
    // volta pro campo (ver catch/error abaixo), nunca se perde.
    setValue("");

    startTransition(async () => {
      onCreated({
        id: `temp-${crypto.randomUUID()}`,
        title,
        type: "outro",
        due_date: dueDate,
        status: "pendente",
        assignee: null,
      });

      try {
        const result = await createTaskInlineAction(clientId, {
          title,
          type: "outro",
          assigneeId: null,
          dueDate,
          dueTime: null,
          recurrence: "nenhuma",
          notes: null,
          sprintId,
        });
        if (result?.error) {
          showToast(result.error, "error");
          setValue(title);
        }
      } catch (err) {
        if (isRedirectSignal(err)) throw err;
        showToast("Não foi possível criar a atividade. Tente novamente.", "error");
        setValue(title);
      }
      inputRef.current?.focus();
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Escreva uma atividade e pressione Enter…"
        disabled={isPending}
        aria-label="Nova atividade"
        className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand disabled:opacity-60"
      />
    </form>
  );
}
