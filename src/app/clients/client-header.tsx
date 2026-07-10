import { formatDateTime } from "@/lib/format";
import type { AccountHealth } from "@/lib/attention-alerts";

/** Reaproveitados pelo ClientContextBar (sticky) — a fonte visível da saúde
 * da conta agora é só ali, não duplica mais aqui. */
export const HEALTH_LABEL: Record<AccountHealth, string> = {
  saudavel: "Conta saudável",
  atencao: "Atenção",
  critico: "Crítico",
};

export const HEALTH_BADGE_CLASSES: Record<AccountHealth, string> = {
  saudavel: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  atencao: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  critico: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

/**
 * Só o nome do cliente (título da página) + um "Detalhes do cliente"
 * recolhível com o que é secundário — ID Meta, gestores por extenso, última
 * sync. Nome, sprint atual, gestor resumido, status e ações principais já
 * aparecem sempre no ClientContextBar (sticky logo abaixo da Top Bar), então
 * não repetimos aqui.
 */
export function ClientHeader({
  clientName,
  metaAdAccountId,
  managerNames,
  lastSyncedAt,
}: {
  clientName: string;
  metaAdAccountId: string;
  managerNames: string[];
  lastSyncedAt: string | null;
}) {
  return (
    <div>
      <h1 className="text-lg font-semibold text-foreground">{clientName}</h1>
      <details className="mt-0.5 [&_summary]:cursor-pointer [&_summary]:list-none">
        <summary className="text-xs text-muted-foreground hover:text-brand">Detalhes do cliente</summary>
        <div className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
          <p className="font-mono">{metaAdAccountId}</p>
          <p>{managerNames.length > 0 ? managerNames.join(", ") : "Sem gestor atribuído"}</p>
          <p>{lastSyncedAt ? `Última sync: ${formatDateTime(lastSyncedAt)}` : "Nunca sincronizado"}</p>
        </div>
      </details>
    </div>
  );
}
