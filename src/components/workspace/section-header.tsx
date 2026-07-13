import type { ReactNode } from "react";

/** Título pequeno de seção dentro do workspace — uppercase discreto (só o
 * bastante pra marcar hierarquia, sem gritar), com um slot opcional de
 * ação à direita (ex.: "Ver todas", "Ordenar por"). */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">{title}</h2>
      {action}
    </div>
  );
}
