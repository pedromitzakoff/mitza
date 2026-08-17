"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, User, ChevronDown } from "lucide-react";
import { createTaskInlineAction } from "./tasks-actions";
import { useToast } from "@/app/toast-provider";
import { isRedirectSignal } from "@/lib/next-redirect";
import { todayDateString } from "@/lib/today";
import type { TaskListItem } from "./task-row";
import type { InlineTaskManagerOption } from "./inline-task-form";

/**
 * Linha de criação de "Atividades" — Etapa "Padronizar e destacar criação
 * de Atividades" (referência visual explícita: caixa com borda azul,
 * ícone "+" num círculo azul sólido, título + data + responsável na mesma
 * linha, mais alta que uma linha comum da lista). Renderiza como
 * `<form>` PRÓPRIO, num bloco separado ACIMA da tabela de atividades
 * (`ActivitySection`) — ao contrário da etapa anterior, aqui a criação
 * tem destaque visual MAIOR que as linhas da lista (que continuam
 * deliberadamente discretas), não igual a elas.
 *
 * SEMPRE aberta — sem estado colapsado/expandido. A etapa anterior ("UX
 * de linha, não formulário") tinha um passo de clicar em "+ Adicionar
 * atividade..." pra revelar os campos; esta etapa substitui esse padrão
 * porque (a) a referência visual não mostra nenhum estado colapsado, e
 * (b) o próprio pedido descreve o comportamento como "ao clicar em
 * 'Adicionar atividade...', foco vai pro input de título" — ou seja,
 * clicar no PRÓPRIO input (que mostra esse placeholder) o foca, o
 * comportamento padrão de um `<input>`, não um toggle controlado por
 * JavaScript. Isso também simplifica o componente (sem `isEditing`, sem
 * lógica de cancelamento por blur entre campos).
 *
 * Título continua sendo o único campo obrigatório; data já nasce
 * preenchida com "hoje" (não existe uma regra de "data da sprint"
 * separada nesta plataforma: `due_date` da tarefa é independente do
 * período da sprint) e responsável já nasce com o gestor principal do
 * cliente, se houver — ambos continuam editáveis antes do Enter. Depois
 * de criada, descrição/notas/comentários/demais propriedades continuam
 * só na expansão inline de edição (`TaskRow`), nunca aqui.
 *
 * A lógica de criação é EXATAMENTE a mesma de sempre (mesma
 * `createTaskInlineAction`, mesmo optimistic UI via `onCreated`, mesmo
 * tratamento de erro com toast + texto restaurado) — só a apresentação
 * mudou. "Atividade" continua sendo só a palavra que a interface usa; o
 * domínio continua Tarefa. Revisão de conta continua nascendo em
 * "Performance" (`SprintPerformanceSection`), nunca aqui.
 */
export function ActivityComposer({
  clientId,
  sprintId,
  managers,
  defaultAssigneeName,
  onCreated,
}: {
  clientId: string;
  /** `null` cria uma tarefa solta, sem vínculo com sprint — mesmo campo
   * opcional que `createTaskInlineAction` já aceita (não usado hoje: este
   * composer só existe dentro de uma Sprint concreta). */
  sprintId: string | null;
  /** Gestores ativos — alimenta o select de responsável desta linha (mesma
   * lista já usada pela expansão de edição em `TaskRow`). */
  managers: InlineTaskManagerOption[];
  /** Nome do gestor principal do cliente (`clients.primary_manager_id`) —
   * usado só pra pré-selecionar o responsável, resolvido por NOME contra
   * `managers` (mesma limitação já aceita em `TaskDrawerPanel`/`TaskRow`:
   * se dois gestores ativos tiverem o mesmo nome, pode pré-selecionar o
   * errado — o usuário ainda pode trocar antes do Enter). `null`/ausente
   * deixa "Sem responsável" pré-selecionado. */
  defaultAssigneeName?: string | null;
  /** Despacha a inserção otimista na lista compartilhada — mesmo padrão
   * de sempre (`useOptimisticTasks`). */
  onCreated: (task: TaskListItem) => void;
}) {
  function resolveDefaultAssigneeId(): string | null {
    return defaultAssigneeName ? (managers.find((m) => m.name === defaultAssigneeName)?.id ?? null) : null;
  }

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(() => todayDateString());
  const [assigneeId, setAssigneeId] = useState<string | null>(resolveDefaultAssigneeId);
  const [isPending, startTransition] = useTransition();
  const titleInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  function resetToDefaults() {
    setDueDate(todayDateString());
    setAssigneeId(resolveDefaultAssigneeId());
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle || isPending) return;

    const chosenDueDate = dueDate || todayDateString();
    const chosenAssigneeId = assigneeId;
    const assigneeName = chosenAssigneeId ? (managers.find((m) => m.id === chosenAssigneeId)?.name ?? null) : null;
    setTitle("");

    startTransition(async () => {
      // Otimista ANTES do await: a atividade aparece na lista na hora.
      onCreated({
        id: `temp-${crypto.randomUUID()}`,
        title: trimmedTitle,
        type: "outro",
        due_date: chosenDueDate,
        status: "pendente",
        assignee: assigneeName ? { name: assigneeName, status: "ativo" } : null,
      });

      try {
        const result = await createTaskInlineAction(clientId, {
          title: trimmedTitle,
          type: "outro",
          assigneeId: chosenAssigneeId,
          dueDate: chosenDueDate,
          dueTime: null,
          recurrence: "nenhuma",
          notes: null,
          sprintId,
        });
        if (result?.error) {
          showToast(result.error, "error");
          setTitle(trimmedTitle);
          titleInputRef.current?.focus();
          return;
        }
      } catch (err) {
        if (isRedirectSignal(err)) throw err;
        showToast("Não foi possível criar a atividade. Tente novamente.", "error");
        setTitle(trimmedTitle);
        titleInputRef.current?.focus();
        return;
      }
      // Sucesso: volta ao estado inicial, pronta pra adicionar a próxima.
      resetToDefaults();
      titleInputRef.current?.focus();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-center gap-2 rounded-xl border border-brand bg-overview-surface px-2.5 py-2"
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-white"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </span>

      <input
        ref={titleInputRef}
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setTitle("");
          }
        }}
        placeholder="Adicionar atividade..."
        disabled={isPending}
        aria-label="Título da atividade"
        className="min-w-[160px] flex-1 bg-transparent text-sm text-overview-text-primary outline-none placeholder:text-overview-text-muted disabled:opacity-60"
      />

      <span className="inline-flex shrink-0 items-center rounded-md border border-overview-border px-2 py-1 text-xs text-overview-text-secondary transition-colors focus-within:border-brand">
        <input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          disabled={isPending}
          required
          aria-label="Data da atividade"
          className="bg-transparent tabular-nums outline-none disabled:opacity-60"
        />
      </span>

      <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-overview-border px-2 py-1 text-xs text-overview-text-secondary transition-colors focus-within:border-brand">
        <User className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <select
          value={assigneeId ?? ""}
          onChange={(event) => setAssigneeId(event.target.value || null)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              // `<select>` nem sempre dispara submit nativo no Enter —
              // garante o mesmo comportamento de título/data.
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          disabled={isPending}
          aria-label="Responsável pela atividade"
          className="max-w-[110px] appearance-none truncate bg-transparent outline-none disabled:opacity-60"
        >
          <option value="">Sem responsável</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name}
            </option>
          ))}
        </select>
        <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
      </span>
    </form>
  );
}
