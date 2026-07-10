import Link from "next/link";
import { formatDateRange } from "@/lib/format";
import type { AccountHealth } from "@/lib/attention-alerts";
import { HEALTH_BADGE_CLASSES, HEALTH_LABEL } from "./client-header";
import { syncClientMetaAction } from "./meta-actions";

/**
 * Subheader sticky do cliente — fica abaixo da Top Bar global em toda rota
 * /clients/[id]/**, pra o nome do cliente nunca sumir da tela ao rolar pras
 * sprints. Só CSS sticky (sem JS), então não interfere em scroll/âncoras.
 */
export function ClientContextBar({
  clientId,
  clientName,
  metaAdAccountId,
  managerNames,
  accountHealth,
  sprintNumber,
  sprint,
  isAdmin,
}: {
  clientId: string;
  clientName: string;
  metaAdAccountId: string;
  managerNames: string[];
  accountHealth: AccountHealth;
  sprintNumber: number | null;
  sprint: { startDate: string; endDate: string } | null;
  isAdmin: boolean;
}) {
  const sprintLabel =
    sprint && sprintNumber
      ? `Sprint ${sprintNumber} atual · ${formatDateRange(sprint.startDate, sprint.endDate)}`
      : "Sem sprint atual";

  const gestorLabel = managerNames.length > 0 ? `Gestor: ${managerNames.join(", ")}` : "Sem gestor atribuído";

  return (
    <div className="sticky top-14 z-20 border-b border-border bg-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
          <p className="min-w-0 shrink truncate border-l-2 border-brand pl-2.5 text-sm font-semibold text-foreground">
            {clientName}
          </p>
          <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground lg:inline">
            {metaAdAccountId}
          </span>
          <span className="shrink-0 truncate text-xs text-muted-foreground">{sprintLabel}</span>
          <span className="hidden shrink-0 truncate text-xs text-muted-foreground md:inline">{gestorLabel}</span>
          <span
            className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium md:inline-block ${HEALTH_BADGE_CLASSES[accountHealth]}`}
          >
            {HEALTH_LABEL[accountHealth]}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isAdmin && (
            <Link
              href={`/clients/${clientId}/edit`}
              className="hidden rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900 sm:inline-block"
            >
              Editar
            </Link>
          )}
          <form action={syncClientMetaAction.bind(null, clientId)}>
            <button
              type="submit"
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Atualizar Meta
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
