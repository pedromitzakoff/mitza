import type { ReactNode } from "react";

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
      <Tag className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</Tag>
      {action}
    </div>
  );
}
