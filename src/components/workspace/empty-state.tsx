import type { ReactNode } from "react";

/** Estado vazio compacto — texto curto + explicação, ação só quando faz
 * sentido. Nunca uma ilustração grande; nunca uma área vazia sem
 * explicação do porquê. */
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1 px-3 py-6 text-sm">
      <p className="font-medium text-overview-text-primary">{title}</p>
      {description && <p className="text-overview-text-secondary">{description}</p>}
      {action}
    </div>
  );
}
