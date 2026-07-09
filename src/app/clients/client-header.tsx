import Link from "next/link";
import { formatDateTime, formatFullDate } from "@/lib/format";
import { todayUTC } from "@/lib/today";
import type { AccountHealth } from "@/lib/attention-alerts";
import { syncClientMetaAction } from "./meta-actions";

const HEALTH_LABEL: Record<AccountHealth, string> = {
  saudavel: "Conta saudável",
  atencao: "Atenção",
  critico: "Crítico",
};

const HEALTH_BADGE_CLASSES: Record<AccountHealth, string> = {
  saudavel: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  atencao: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  critico: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export function ClientHeader({
  clientId,
  clientName,
  metaAdAccountId,
  managerNames,
  health,
  lastSyncedAt,
  isAdmin,
}: {
  clientId: string;
  clientName: string;
  metaAdAccountId: string;
  managerNames: string[];
  health: AccountHealth;
  lastSyncedAt: string | null;
  isAdmin: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-card p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{clientName}</h1>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_BADGE_CLASSES[health]}`}
          >
            {HEALTH_LABEL[health]}
          </span>
        </div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{metaAdAccountId}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {managerNames.length > 0 ? managerNames.join(", ") : "Sem gestor atribuído"}
        </p>
        <p className="mt-0.5 text-xs font-medium text-brand">Hoje: {formatFullDate(todayUTC())}</p>
      </div>

      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link
              href={`/clients/${clientId}/edit`}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Editar
            </Link>
          )}
          <form action={syncClientMetaAction.bind(null, clientId)}>
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Atualizar dados do Meta
            </button>
          </form>
        </div>
        <p className="text-xs text-muted-foreground">
          {lastSyncedAt ? `Última sync: ${formatDateTime(lastSyncedAt)}` : "Nunca sincronizado"}
        </p>
      </div>
    </div>
  );
}
