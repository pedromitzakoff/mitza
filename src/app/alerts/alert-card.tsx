import Link from "next/link";
import { COCKPIT_CARD_CLASSES } from "@/lib/cockpit-pace";
import { formatCurrency, formatRelativeDateTime } from "@/lib/format";
import { getTrafficChannelConfig } from "@/lib/traffic-channels";
import { buildWorkspaceHref } from "@/lib/client-workspace-nav";
import { ALERT_SEVERITY_BADGE_CLASSES, ALERT_SEVERITY_LABEL, ALERT_STATUS_BADGE_CLASSES, ALERT_STATUS_LABEL, ALERT_TYPE_LABEL } from "@/lib/alerts/alert-labels";
import { AlertActionsMenu } from "@/app/alerts/alert-actions-menu";
import type { AlertListItem } from "@/app/alerts/alerts-data";

/**
 * Aba "Alertas" (pedido, seção 1 — "Cada alerta deve apresentar..."):
 * cliente+conta, tipo+gravidade, período+última atualização, valor
 * observado+referência+diferença %, explicação curta, acesso ao detalhe
 * do cliente/campanhas. `spend_pace` é no nível de CONTA (não existe
 * granularidade de campanha pra orçamento), então "campanhas relacionadas"
 * aqui é o link pra Campanhas do cliente nesse canal — "quando os dados
 * permitirem" (pedido) já é satisfeito por esse link sempre existir.
 */
export function AlertCard({ alert }: { alert: AlertListItem }) {
  const channelConfig = getTrafficChannelConfig(alert.channel);
  const isToday = alert.periodKind === "in_progress";
  const periodLabel = isToday
    ? "Hoje — dia em andamento"
    : alert.periodStart === alert.periodEnd
      ? new Date(`${alert.periodStart}T00:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
      : `${alert.periodStart} a ${alert.periodEnd}`;

  const referenceLabel = alert.referenceSource === "monthly_budget" ? "orçamento mensal ÷ dias do mês" : alert.referenceSource === "historical_average" ? "média do histórico recente" : null;

  return (
    <div className={`flex flex-col gap-2.5 rounded-lg border p-3.5 ${COCKPIT_CARD_CLASSES}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={buildWorkspaceHref(alert.clientId, "", null)} className="truncate text-sm font-semibold text-overview-text-primary hover:underline">
              {alert.clientName}
            </Link>
            <span className="rounded-full bg-overview-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">{channelConfig.shortLabel}</span>
          </div>
          <p className="text-xs font-medium text-overview-text-secondary">{ALERT_TYPE_LABEL[alert.alertType]}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ALERT_SEVERITY_BADGE_CLASSES[alert.severity]}`}>{ALERT_SEVERITY_LABEL[alert.severity]}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ALERT_STATUS_BADGE_CLASSES[alert.status]}`}>{ALERT_STATUS_LABEL[alert.status]}</span>
          <AlertActionsMenu alertId={alert.id} status={alert.status} />
        </div>
      </div>

      <p className="text-sm text-overview-text-primary">{alert.explanation}</p>

      {alert.observedValue !== null && alert.referenceValue !== null && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-overview-text-secondary">
          <span>
            Observado: <span className="font-medium text-overview-text-primary">{formatCurrency(alert.observedValue)}</span>
          </span>
          <span>
            Referência: <span className="font-medium text-overview-text-primary">{formatCurrency(alert.referenceValue)}</span>
            {referenceLabel && <span className="text-overview-text-muted"> ({referenceLabel}, estimativa)</span>}
          </span>
          {alert.diffPercent !== null && (
            <span>
              Diferença: <span className="font-medium text-overview-text-primary">{alert.diffPercent > 0 ? "+" : ""}{Math.round(alert.diffPercent)}%</span>
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-overview-border pt-2 text-[11px] text-overview-text-muted">
        <div className="flex flex-wrap items-center gap-3">
          <span>Período: {periodLabel}</span>
          <span>Atualizado: {formatRelativeDateTime(alert.lastEvaluatedAt, new Date())}</span>
          {alert.status === "acompanhamento" && alert.followUpUntil && <span>Acompanhando até {alert.followUpUntil}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Link href={buildWorkspaceHref(alert.clientId, "", null)} className="text-brand hover:underline">
            Ver cliente
          </Link>
          <Link href={buildWorkspaceHref(alert.clientId, "/campanhas", null)} className="text-brand hover:underline">
            Ver campanhas
          </Link>
        </div>
      </div>
    </div>
  );
}
