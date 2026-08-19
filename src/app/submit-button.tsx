"use client";

import { useFormStatus } from "react-dom";

/**
 * Botão de submit com feedback de "processando" (Interaction & Motion
 * System 1.0) — usa `useFormStatus` em vez de um estado próprio: herda o
 * `pending` do `<form>` ancestral automaticamente, sem precisar transformar
 * cada formulário num client component só para saber se o envio está em
 * andamento. Mesma classe/texto do botão original quando não está pendente;
 * a lógica de negócio continua 100% no Server Action — isto só evita que a
 * interface pareça travada enquanto ele roda.
 *
 * Etapa "Padronização Global de Estados de Interação": `focus-visible`
 * (ring de teclado, nunca ao clicar com mouse) entra na base, junto de
 * `mitza-pressable` — antes cada chamador precisava lembrar de acrescentar
 * `focus-visible:outline...` na própria className, e vários não faziam
 * isso (nenhum feedback de foco por teclado nesses botões). Repetir a
 * classe num chamador que já a declara é inofensivo (mesma regra CSS
 * aplicada duas vezes, sem conflito) — a base cobre todo o resto.
 */
export function SubmitButton({
  children,
  pendingChildren,
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  /** Conteúdo mostrado enquanto pendente — padrão é manter o mesmo texto. */
  pendingChildren?: React.ReactNode;
  /** Condição adicional de desabilitar (ex.: validação de formulário) —
   * combinada com `pending` via OR, nunca substitui a checagem de pending. */
  disabled?: boolean;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={`${className} mitza-pressable focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? (pendingChildren ?? children) : children}
    </button>
  );
}
