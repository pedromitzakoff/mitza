import type { AlertKind, AlertSeverity, AttentionAlert } from "@/lib/attention-alerts";

const SEVERITY_TEXT_CLASSES: Record<AlertSeverity, string> = {
  critico: "text-red-600 dark:text-red-400",
  atencao: "text-amber-600 dark:text-amber-400",
  informativo: "text-muted-foreground",
};

const SEVERITY_DOT_CLASSES: Record<AlertSeverity, string> = {
  critico: "bg-red-500",
  atencao: "bg-amber-500",
  informativo: "bg-zinc-400 dark:bg-zinc-600",
};

const MAX_VISIBLE = 3;

/** Prioridade pedida especificamente pra este painel — não é a mesma ordem
 * por severidade usada em Sprints/Visão Geral (buildAttentionAlerts não
 * muda), aqui o critério é o tipo do alerta: atrasadas > investimento >
 * atividade > sync do Meta > otimização > sem responsável > outros. */
const KIND_PRIORITY: Record<AlertKind, number> = {
  tarefas_atrasadas: 0,
  investimento: 1,
  atividade: 2,
  meta_sync: 3,
  otimizacao: 4,
  sem_responsavel: 5,
  outro: 6,
};

function byPriority(a: AttentionAlert, b: AttentionAlert): number {
  return KIND_PRIORITY[a.kind ?? "outro"] - KIND_PRIORITY[b.kind ?? "outro"];
}

/**
 * Faixa compacta "Atenção" — no máximo 3 alertas (os mais prioritários),
 * altura mínima, cor semântica só no texto do alerta crítico (nunca o
 * componente inteiro). O restante só aparece ao clicar "Ver todos", num
 * <details> que expande localmente — sem navegar pra outra página nem
 * aumentar permanentemente a altura do dashboard.
 */
export function AttentionPanel({ alerts }: { alerts: AttentionAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Atenção</span> · Nenhuma ação urgente nesta conta.
        </p>
      </div>
    );
  }

  const ordered = [...alerts].sort(byPriority);
  const visible = ordered.slice(0, MAX_VISIBLE);
  const remaining = ordered.length - visible.length;

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <details className="group/panel">
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-1 [&::-webkit-details-marker]:hidden">
          <span className="shrink-0 text-sm font-medium text-foreground">Atenção</span>
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
            {visible.map((alert, index) => (
              <span key={index}>
                {index > 0 && <span className="mr-1.5 text-muted-foreground">·</span>}
                <span className={alert.severity === "critico" ? `font-medium ${SEVERITY_TEXT_CLASSES.critico}` : "text-muted-foreground"}>
                  {alert.message}
                </span>
              </span>
            ))}
          </span>
          {remaining > 0 && (
            <span className="ml-auto shrink-0 text-xs font-medium text-brand group-open/panel:hidden">
              Ver todos ({ordered.length})
            </span>
          )}
          {remaining > 0 && (
            <span className="ml-auto hidden shrink-0 text-xs font-medium text-brand group-open/panel:inline">
              Ocultar
            </span>
          )}
        </summary>

        {remaining > 0 && (
          <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
            {ordered.map((alert, index) => (
              <li key={index} className="flex items-start gap-1.5 text-sm">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT_CLASSES[alert.severity]}`} />
                <span className={alert.severity === "critico" ? SEVERITY_TEXT_CLASSES.critico : "text-foreground"}>
                  {alert.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
