import type { ReactNode } from "react";
import type { StatusTone } from "./status-dot";

const BADGE_CLASSES: Record<StatusTone, string> = {
  success: "bg-overview-success-subtle text-overview-success",
  warning: "bg-overview-warning-subtle text-overview-warning",
  danger: "bg-overview-danger-subtle text-overview-danger",
  neutral: "bg-overview-surface-subtle text-overview-text-secondary",
  brand: "bg-overview-brand-subtle text-brand",
};

/** Etiqueta discreta — reservada pra quando o formato de "pill" ajuda de
 * verdade (ex.: situação do investimento); em listas densas (tabela,
 * Prioridades), preferir `StatusDot`. */
export function Badge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}
