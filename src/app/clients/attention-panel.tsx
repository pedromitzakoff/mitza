import type { AlertSeverity, AttentionAlert } from "@/lib/attention-alerts";

const SEVERITY_ICON: Record<AlertSeverity, string> = {
  critico: "●",
  atencao: "▲",
  informativo: "ℹ",
};

const SEVERITY_CLASSES: Record<AlertSeverity, string> = {
  critico: "text-red-600 dark:text-red-400",
  atencao: "text-amber-600 dark:text-amber-400",
  informativo: "text-blue-600 dark:text-blue-400",
};

export function AttentionPanel({ alerts }: { alerts: AttentionAlert[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h2 className="text-sm font-medium text-foreground">Precisa de atenção</h2>

      {alerts.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nenhuma ação urgente nesta conta.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {alerts.map((alert, index) => (
            <li key={index} className="flex items-start gap-2 text-sm">
              <span className={`mt-0.5 shrink-0 text-xs ${SEVERITY_CLASSES[alert.severity]}`}>
                {SEVERITY_ICON[alert.severity]}
              </span>
              <span className="text-foreground">{alert.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
