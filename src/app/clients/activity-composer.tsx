"use client";

import { useRef, useState, useTransition } from "react";
import { createTaskInlineAction } from "./tasks-actions";
import { useToast } from "@/app/toast-provider";
import { isRedirectSignal } from "@/lib/next-redirect";
import { todayDateString } from "@/lib/today";
import type { TaskListItem } from "./task-row";
import type { InlineTaskManagerOption } from "./inline-task-form";

/**
 * Linha de criação de "Atividades" — Etapa "UX de linha, não formulário".
 * Renderiza como `<li>`, primeiro item do MESMO `<ul>` de `ActivitySection`
 * (não mais um bloco separado acima da lista): parada, é só "+ Adicionar
 * atividade..." — texto discreto, sem caixa, sem borda, do tamanho de uma
 * linha comum. Clicar transforma a própria linha num círculo + input +
 * data + responsável (mesma linguagem visual/densidade de `TaskRow`), sem
 * abrir modal/drawer/popover. Depois de salvar (ou cancelar com Esc/blur
 * fora da linha com título vazio), a linha volta sozinha ao estado
 * colapsado, pronta pra próxima.
 *
 * Etapa "Reduzir atrito da criação": além do título, a linha expandida já
 * oferece responsável e data — os dois campos que "quase sempre já são
 * conhecidos no momento da criação" (não é mais preciso reabrir a
 * expansão de edição logo em seguida só pra isso). Título continua sendo
 * o único campo obrigatório; data já nasce preenchida com "hoje" (mesma
 * regra que o composer já usava — não existe uma regra de "data da
 * sprint" separada nesta plataforma: `due_date` da tarefa é independente
 * do período da sprint) e responsável já nasce com o gestor principal do
 * cliente, se houver — ambos continuam editáveis antes do Enter. Depois
 * de criada, descrição/notas/comentários/demais propriedades continuam
 * só na expansão inline de edição (`TaskRow`), nunca aqui.
 *
 * A lógica de criação é EXATAMENTE a mesma de antes (mesma
 * `createTaskInlineAction`, mesmo optimistic UI via `onCreated`, mesmo
 * tratamento de erro com toast + texto restaurado) — só ganhou estado a
 * mais pra controlar a troca de aparência colapsada ↔ editando e os
 * valores de responsável/data. "Atividade" continua sendo só a palavra
 * que a interface usa; o domínio continua Tarefa. Revisão de conta
 * continua nascendo em "Performance" (`SprintPerformanceSection`), nunca
 * aqui.
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
   * usado só pra pré-selecionar o responsável ao abrir a linha, resolvido
   * por NOME contra `managers` (mesma limitação já aceita em
   * `TaskDrawerPanel`/`TaskRow`: se dois gestores ativos tiverem o mesmo
   * nome, pode pré-selecionar o errado — o usuário ainda pode trocar antes
   * do Enter). `null`/ausente deixa "Sem responsável" pré-selecionado. */
  defaultAssigneeName?: string | null;
  /** Despacha a inserção otimista na lista compartilhada — mesmo padrão
   * de sempre (`useOptimisticTasks`). */
  onCreated: (task: TaskListItem) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(() => todayDateString());
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const titleInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  function openEditing() {
    setIsEditing(true);
    // Valores padrão recalculados a cada abertura — "hoje" sempre atual,
    // responsável resolvido contra a lista de gestores mais recente.
    setDueDate(todayDateString());
    setAssigneeId(defaultAssigneeName ? (managers.find((m) => m.name === defaultAssigneeName)?.id ?? null) : null);
  }

  function cancelEditing() {
    setIsEditing(false);
    setTitle("");
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
      // Otimista ANTES do await: a atividade aparece na lista na hora,
      // mesmo com a linha de criação ainda fechando.
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
      // Sucesso: volta pro estado colapsado, pronta pra adicionar a próxima.
      setIsEditing(false);
    });
  }

  function handleEscape(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  }

  if (!isEditing) {
    return (
      <li className="border-b border-border/60 last:border-0">
        <button
          type="button"
          onClick={openEditing}
          className="mitza-pressable flex min-h-[28px] w-full items-center px-2 py-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          + Adicionar atividade...
        </button>
      </li>
    );
  }

  return (
    <li className="border-b border-border/60 last:border-0">
      <form
        onSubmit={handleSubmit}
        // Cancela só quando o foco sai da linha inteira (não a cada Tab
        // entre título → data → responsável) — checa se o próximo elemento
        // focado ainda está dentro deste `<form>`.
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if ((!next || !event.currentTarget.contains(next)) && !title.trim()) {
            cancelEditing();
          }
        }}
        className="flex min-h-[28px] items-center gap-2.5 px-2 py-1"
      >
        <span
          aria-hidden
          className="block h-4 w-4 shrink-0 rounded-full border-2 border-zinc-300 dark:border-zinc-600"
        />
        <input
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={handleEscape}
          placeholder="Adicionar atividade..."
          disabled={isPending}
          autoFocus
          aria-label="Título da atividade"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          onKeyDown={handleEscape}
          disabled={isPending}
          required
          aria-label="Data da atividade"
          className="w-[112px] shrink-0 bg-transparent text-xs tabular-nums text-muted-foreground outline-none disabled:opacity-60"
        />
        <select
          value={assigneeId ?? ""}
          onChange={(event) => setAssigneeId(event.target.value || null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              handleEscape(event);
            } else if (event.key === "Enter") {
              // `<select>` nem sempre dispara submit nativo no Enter —
              // garante o mesmo comportamento de título/data.
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          disabled={isPending}
          aria-label="Responsável pela atividade"
          className="w-24 shrink-0 truncate bg-transparent text-xs text-muted-foreground outline-none disabled:opacity-60"
        >
          <option value="">Sem responsável</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name}
            </option>
          ))}
        </select>
      </form>
    </li>
  );
}
