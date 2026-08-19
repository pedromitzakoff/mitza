"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/app/submit-button";
import { registerRecurringExecutionAction, type RegisterExecutionState } from "./recurring-task-actions";
import { OptimizationQuickPicker } from "./optimization-quick-picker";
import type { RecurringTaskChecklistItem } from "@/lib/recurring-task-data";

// Precisa viver aqui, não em recurring-task-actions.ts: um arquivo
// "use server" só pode exportar funções async — exportar esta constante de
// lá (erro real já visto em produção: "A 'use server' file can only export
// async functions, found object") derruba a avaliação do módulo pra
// QUALQUER página que o importe, direta ou indiretamente.
const INITIAL_STATE: RegisterExecutionState = { status: "idle" };

/**
 * Formulário de "Registrar nova execução" — client component (`useActionState`
 * exige). Bug crítico corrigido aqui: antes, qualquer falha fazia um
 * `redirect()` de volta pro `closeHref` (o MESMO href que fecha o drawer),
 * carregando o erro na querystring — o drawer fechava, toda seleção de
 * chips/checklist e a observação eram perdidas, e a mensagem virava um
 * banner solto no topo da página, sem relação com o botão. Agora o Server
 * Action só faz `redirect()` no sucesso (fecha o drawer de propósito); no
 * erro ele retorna `{status: "error", message}` — sem navegação nenhuma, e
 * como o DOM deste formulário nunca desmonta, os chips selecionados
 * (estado próprio de `OptimizationQuickPicker`) e a observação (campo não
 * controlado) continuam exatamente como o gestor deixou, de graça.
 */
export function RegisterExecutionForm({
  recurringTaskId,
  clientId,
  closeHref,
  usesAccountReview,
  checklistItems,
}: {
  recurringTaskId: string;
  clientId: string;
  closeHref: string;
  usesAccountReview: boolean;
  checklistItems: RecurringTaskChecklistItem[];
}) {
  const boundAction = registerRecurringExecutionAction.bind(null, recurringTaskId, clientId, closeHref);
  const [state, formAction] = useActionState(boundAction, INITIAL_STATE);

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      {usesAccountReview ? (
        <OptimizationQuickPicker />
      ) : (
        checklistItems.length > 0 && (
          <div className="flex flex-col gap-1">
            {checklistItems.map((item) => (
              <label key={item.key} className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" name="checklist_items" value={item.key} className="h-3.5 w-3.5 rounded border-border" />
                {item.label}
              </label>
            ))}
          </div>
        )
      )}
      <textarea
        name="notes"
        rows={2}
        placeholder="Observações (opcional)"
        className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-zinc-500"
      />
      <div className="flex flex-col items-start gap-1.5">
        <SubmitButton
          pendingChildren="Registrando..."
          className="self-start rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
        >
          Registrar execução
        </SubmitButton>
        {state.status === "error" && <p className="text-xs text-red-600 dark:text-red-500">{state.message}</p>}
      </div>
    </form>
  );
}
