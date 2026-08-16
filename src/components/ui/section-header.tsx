import type { ReactNode } from "react";

/**
 * Etapa "Sprint Workspace MVP Finalization 2.0" (Partes 4/5) — botão
 * secundário compacto único pra ações de cabeçalho de seção ("+ Tarefa",
 * "Registrar otimização") — mesma classe usada nos dois lugares, pra nunca
 * um virar botão e o outro continuar link, ou um azul e o outro cinza.
 * Mesmo padrão visual já usado em "Atualizar performance"/"Comentários"
 * (`sprint-card.tsx`): borda discreta, hover com tom da marca, pressed
 * (`mitza-pressable`), focus-visible.
 *
 * Etapa "Unificação visual da página do cliente": tokens migrados pra
 * `overview-*` — mesmo shape/comportamento, só a cor lida do token certo.
 */
export const SECONDARY_ACTION_BUTTON_CLASSES =
  "mitza-pressable inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-overview-border bg-overview-surface px-2 py-1 text-[11px] font-medium text-overview-text-primary transition-colors hover:border-brand hover:bg-brand/5 hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/**
 * Design System oficial (tokens base) — Onda 1. Só a variante "label em
 * caixa alta" de cabeçalho de seção — a string repetida em várias telas.
 * `Section`, `FormSection` e `SectionCard` (colapso, âncora de scroll,
 * outros comportamentos próprios) ficam fora desta onda. `as` preserva o
 * nível semântico do heading original (ex.: `h4` para uma subseção dentro
 * de outra seção já usando `h3`).
 */
export function SectionHeader({
  children,
  action,
  as: Tag = "h3",
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  as?: "h3" | "h4";
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 ${className ?? ""}`}>
      <Tag className="text-xs font-semibold uppercase tracking-wide text-overview-text-muted">{children}</Tag>
      {action}
    </div>
  );
}
