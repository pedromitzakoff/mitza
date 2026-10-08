"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/app/submit-button";
import { registerRecurringExecutionAction, type RegisterExecutionState } from "@/app/clients/recurring-task-actions";

// Precisa viver aqui, não dentro do arquivo "use server" — mesmo motivo já
// documentado em `register-execution-form.tsx`.
const INITIAL_STATE: RegisterExecutionState = { status: "idle" };

/**
 * MITZA ONE — Minha Rotina (seção 2 do pedido): "Rotinas simples" (sem
 * checklist, sem diagnóstico de Otimização, sem integração de Report) se
 * registram em UM clique — MESMA Server Action oficial
 * (`registerRecurringExecutionAction`) que o drawer completo usa, só sem
 * nenhum campo extra no FormData (a action já trata ausência de
 * `optimization_selections_json` como "não é fluxo de revisão de conta",
 * nunca exige diagnóstico nesse caso). Nunca um atalho que pula validação:
 * esta mesma action é usada tanto aqui quanto no drawer completo
 * (`RegisterExecutionForm`), e só é oferecida (ver `canOneClick`,
 * `lib/minha-rotina.ts`) quando a recorrência realmente não tem nenhum
 * campo obrigatório a preencher.
 */
export function MinhaRotinaRegisterButton({ recurringTaskId, clientId, returnTo }: { recurringTaskId: string; clientId: string; returnTo: string }) {
  const boundAction = registerRecurringExecutionAction.bind(null, recurringTaskId, clientId, returnTo);
  const [state, formAction] = useActionState(boundAction, INITIAL_STATE);

  return (
    <span className="shrink-0">
      <form action={formAction}>
        <SubmitButton
          pendingChildren="Registrando..."
          className="mitza-pressable rounded-md border border-overview-border px-1.5 py-0.5 text-[11px] font-medium text-overview-text-secondary hover:bg-overview-surface-hover hover:text-overview-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          Registrar
        </SubmitButton>
      </form>
      {state.status === "error" && <span className="ml-1.5 text-[11px] text-red-600 dark:text-red-400">{state.message}</span>}
    </span>
  );
}
