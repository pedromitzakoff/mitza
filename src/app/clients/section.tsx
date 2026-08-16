import type { ReactNode } from "react";

/** Etapa "Unificação visual da página do cliente": título migrado pro token
 * `overview-*` — mesmo tamanho/peso de sempre, só a cor lida do token
 * certo. */
export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-overview-text-primary">{title}</h2>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}
