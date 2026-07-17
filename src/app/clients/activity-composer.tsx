"use client";

import { useRef, useState, useTransition } from "react";
import { createTaskInlineAction } from "./tasks-actions";
import { useToast } from "@/app/toast-provider";
import { isRedirectSignal } from "@/lib/next-redirect";
import { todayDateString } from "@/lib/today";
import type { TaskListItem } from "./task-row";

/**
 * Linha de criação de "Atividades" — Etapa "UX de linha, não formulário".
 * Renderiza como `<li>`, primeiro item do MESMO `<ul>` de `ActivitySection`
 * (não mais um bloco separado acima da lista): parada, é só "+ Adicionar
 * atividade..." — texto discreto, sem caixa, sem borda, do tamanho de uma
 * linha comum. Clicar transforma a própria linha num círculo + input
 * (mesma linguagem visual do checkbox/título de `TaskRow`), sem abrir
 * modal/drawer/popover. Depois de salvar (ou cancelar com Esc/blur vazio),
 * a linha volta sozinha ao estado colapsado, pronta pra próxima.
 *
 * A lógica de criação é EXATAMENTE a mesma de antes (mesma
 * `createTaskInlineAction`, mesmo optimistic UI via `onCreated`, mesmo
 * tratamento de erro com toast + texto restaurado) — só ganhou um estado
 * `isEditing` a mais pra controlar a troca de aparência colapsada ↔
 * editando. "Atividade" continua sendo só a palavra que a interface usa;
 * o domínio continua Tarefa. Revisão de conta continua nascendo em
 * "Performance" (`SprintPerformanceSection`), nunca aqui.
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
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  function cancelEditing() {
    setIsEditing(false);
    setValue("");
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = value.trim();
    if (!title || isPending) return;

    const dueDate = todayDateString();
    setValue("");

    startTransition(async () => {
      // Otimista ANTES do await: a atividade aparece na lista na hora,
      // mesmo com a linha de criação ainda fechando.
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
          inputRef.current?.focus();
          return;
        }
      } catch (err) {
        if (isRedirectSignal(err)) throw err;
        showToast("Não foi possível criar a atividade. Tente novamente.", "error");
        setValue(title);
        inputRef.current?.focus();
        return;
      }
      // Sucesso: volta pro estado colapsado, pronta pra adicionar a próxima.
      setIsEditing(false);
    });
  }

  if (!isEditing) {
    return (
      <li className="border-b border-border/60 last:border-0">
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="mitza-pressable flex min-h-[28px] w-full items-center px-2 py-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          + Adicionar atividade...
        </button>
      </li>
    );
  }

  return (
    <li className="flex min-h-[28px] items-center gap-2.5 border-b border-border/60 px-2 py-1 last:border-0">
      <span
        aria-hidden
        className="block h-4 w-4 shrink-0 rounded-full border-2 border-zinc-300 dark:border-zinc-600"
      />
      <form onSubmit={handleSubmit} className="min-w-0 flex-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            if (!value.trim()) cancelEditing();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEditing();
            }
          }}
          placeholder="Adicionar atividade..."
          disabled={isPending}
          autoFocus
          aria-label="Nova atividade"
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
      </form>
    </li>
  );
}
