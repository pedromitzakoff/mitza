import type { ReactNode } from "react";

/** Cabeçalho compacto de página — título com hierarquia forte mas não
 * exagerada (24–28px/700), slot à direita pra controles (ex.: seletor de
 * mês). Sem subtítulo/data/papel do usuário: essas informações já existem
 * globalmente (Top Bar). */
export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-[26px] font-bold leading-tight tracking-tight text-navy">{title}</h1>
      {actions}
    </div>
  );
}
