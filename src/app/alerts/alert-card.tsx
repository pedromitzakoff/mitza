import Link from "next/link";
import { COCKPIT_CARD_CLASSES } from "@/lib/cockpit-pace";
import { formatCurrency, formatRelativeDateTime } from "@/lib/format";
import { getTrafficChannelConfig } from "@/lib/traffic-channels";
import { buildWorkspaceHref } from "@/lib/client-workspace-nav";
import { ALERT_SEVERITY_BADGE_CLASSES, ALERT_SEVERITY_LABEL, ALERT_TYPE_LABEL } from "@/lib/alerts/alert-labels";
import { AlertActionButtons } from "@/app/alerts/alert-action-buttons";
import type { AlertListItem } from "@/app/alerts/alerts-data";
import type { AlertSeverity } from "@/lib/alerts/alert-types";

/** Cor do desvio em reais/% — segue a GRAVIDADE do alerta (não a direção
 * acima/abaixo), mesmo tom de `DANGER`/`WARNING` já usado no Status
 * Registry (`lib/status-registry.ts`), só que como texto solto (o
 * registry só expõe classe de BADGE completa, pill+fundo, errada pra uma
 * ênfase inline no meio de uma frase). */
const SEVERITY_TEXT_CLASSES: Record<AlertSeverity, string> = {
  critico: "text-red-600 dark:text-red-400",
  atencao: "text-amber-600 dark:text-amber-400",
  oportunidade: "text-green-600 dark:text-green-400",
};

function formatSignedCurrency(value: number): string {
  return `${value > 0 ? "+" : ""}${formatCurrency(value)}`;
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${Math.round(value)}%`;
}

/**
 * Melhoria visual da aba "Alertas" (pedido do usuário) — card compacto,
 * pra "bater o olho, entender qual conta precisa de atenção primeiro e
 * agir no próprio painel". Mantém os campos/fluxos já existentes
 * (gravidade/tipo/período/links/histórico) — só reorganiza e REALÇA o que
 * importa pra triagem rápida (valor observado/previsto/diferença em
 * destaque, explicação do cálculo movida pra dentro de "Ver detalhes").
 */
export function AlertCard({ alert }: { alert: AlertListItem }) {
  const channelConfig = getTrafficChannelConfig(alert.channel);
  const isToday = alert.periodKind === "in_progress";
  const periodLabel = isToday
    ? "Hoje"
    : alert.periodStart === alert.periodEnd
      ? new Date(`${alert.periodStart}T00:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
      : `${alert.periodStart} a ${alert.periodEnd}`;

  const referenceLabel = alert.referenceSource === "monthly_budget" ? "orçamento mensal ÷ dias do mês" : alert.referenceSource === "historical_average" ? "média do histórico recente" : null;

  const hasAmounts = alert.observedValue !== null && alert.referenceValue !== null;
  // Mês (pedido, seção 2): só mostra quando há referência confiável —
  // `monthExpectedToDate === null` normalmente significa "sem orçamento
  // mensal configurado pra este canal", nunca um 0 fabricado.
  const hasMonthContext = alert.monthActual !== null && alert.monthExpectedToDate !== null;

  return (
    <div className={`flex flex-col gap-2.5 rounded-lg border p-3.5 ${COCKPIT_CARD_CLASSES}`}>
      <div className="flex flex-col gap-1.5 md:flex-row md:items-start md:justify-between md:gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={buildWorkspaceHref(alert.clientId, "", null)} className="truncate text-sm font-semibold text-overview-text-primary hover:underline">
              {/* Pedido do usuário: "um número do alerta antes do nome do
                  cliente... como se fosse um número do código do alerta" —
                  `displayNumber` nunca muda (nem reaberto, nem reordenado
                  por filtro). */}
              {String(alert.displayNumber).padStart(2, "0")} - {alert.clientName}
            </Link>
            <span className="rounded-full bg-overview-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">{channelConfig.shortLabel}</span>
          </div>
          <p className="text-xs font-medium text-overview-text-secondary">{ALERT_TYPE_LABEL[alert.alertType]}</p>
        </div>
        <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1.5 md:w-auto">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ALERT_SEVERITY_BADGE_CLASSES[alert.severity]}`}>{ALERT_SEVERITY_LABEL[alert.severity]}</span>
          {/* "Dia em andamento" (pedido, seção 3: "indique que o dado é
              parcial") — nunca comparamos com uma previsão até o mesmo
              horário (não existe referência intradiária confiável hoje),
              só sinalizamos que o número ainda está se formando. */}
          {isToday && (
            <span className="rounded-full bg-overview-surface-hover px-2 py-0.5 text-[11px] font-medium text-overview-text-muted">Dado parcial</span>
          )}
        </div>
      </div>

      {/* Valor observado/previsto/diferença (pedido, seção 2 — exemplo:
          "Byma · R$ 234,60 gastos · R$ 120,00 previstos · +R$ 114,60
          (+95%)") — a linha mais importante do card, por isso em destaque
          logo no topo, antes de qualquer outro detalhe. */}
      {hasAmounts && (
        <p className="text-sm text-overview-text-primary">
          <span className="font-semibold">{formatCurrency(alert.observedValue!)}</span> gastos · {formatCurrency(alert.referenceValue!)} previstos
          {alert.diffReais !== null && (
            <>
              {" · "}
              <span className={`font-semibold ${SEVERITY_TEXT_CLASSES[alert.severity]}`}>
                {formatSignedCurrency(alert.diffReais)}
                {alert.diffPercent !== null && ` (${formatSignedPercent(alert.diffPercent)})`}
              </span>
            </>
          )}
          {referenceLabel && <span className="text-xs text-overview-text-muted"> · {referenceLabel}, estimativa</span>}
        </p>
      )}

      {/* Acumulado do mês vs. previsto até a mesma data (pedido, seção 2) —
          contexto de ritmo mensal pra triagem, nunca um critério de
          detecção novo (isso continua só no motor, seção 3 do pedido:
          "preserve os critérios atuais de detecção e gravidade"). */}
      {hasMonthContext && (
        <p className="text-xs text-overview-text-secondary">
          Mês: {formatCurrency(alert.monthActual!)} de {formatCurrency(alert.monthExpectedToDate!)} previsto até hoje
          <span className="text-overview-text-muted"> (estimativa — orçamento mensal ÷ dias do mês)</span>
        </p>
      )}

      {/* Responsável/próxima checagem ("Em acompanhamento") ou motivo/
          autor/data ("Resolvido") — pedido, seção 4: reaproveita os
          campos já existentes (`latestNote*`, `followUpUntil`), nenhum
          campo novo precisou ser criado. */}
      {alert.status === "acompanhamento" && (
        <div className="rounded-md bg-overview-surface-hover px-2.5 py-1.5 text-xs text-overview-text-secondary">
          <p className="font-medium text-overview-text-primary">
            Em acompanhamento
            {alert.latestNoteByName && ` · Responsável: ${alert.latestNoteByName}`}
            {alert.followUpUntil && ` · Próxima checagem: ${alert.followUpUntil}`}
          </p>
          {alert.latestNote && <p className="mt-1">“{alert.latestNote}”</p>}
        </div>
      )}
      {alert.status === "resolvido" && (
        <div className="rounded-md bg-overview-surface-hover px-2.5 py-1.5 text-xs text-overview-text-secondary">
          <p className="font-medium text-overview-text-primary">
            {alert.latestNoteByName
              ? `Resolvido por ${alert.latestNoteByName}${alert.latestNoteAt ? ` · ${formatRelativeDateTime(alert.latestNoteAt, new Date())}` : ""}`
              : "Resolvido automaticamente — o gasto normalizou sozinho"}
          </p>
          {alert.latestNote && <p className="mt-1">“{alert.latestNote}”</p>}
        </div>
      )}

      {/* Explicação do cálculo (pedido, seção 2: "deixe a explicação do
          cálculo nos detalhes do alerta") — nunca mais sempre visível,
          card fica mais compacto/fácil de comparar vários de uma vez. */}
      <details className="text-xs text-overview-text-secondary">
        <summary className="cursor-pointer select-none text-overview-text-muted hover:text-overview-text-secondary">Ver detalhes do cálculo</summary>
        <p className="mt-1">{alert.explanation}</p>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-overview-border pt-2 text-[11px] text-overview-text-muted">
        <div className="flex flex-wrap items-center gap-3">
          <span>Período: {periodLabel}</span>
          <span>Atualizado: {formatRelativeDateTime(alert.lastEvaluatedAt, new Date())}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href={buildWorkspaceHref(alert.clientId, "", null)} className="text-brand hover:underline">
            Ver cliente
          </Link>
          <Link href={buildWorkspaceHref(alert.clientId, "/campanhas", null)} className="text-brand hover:underline">
            Ver campanhas
          </Link>
          {/* Pedido, seção 4: "quando a resolução for por aumento
              planejado e já houver uma tela de edição de previsão,
              ofereça um atalho para ela" — a tela de orçamento/metas já
              existe (`/clients/[id]/metas`), nunca uma ação automática:
              o ajuste em si continua uma decisão explícita do gestor
              naquela tela, nunca disparado daqui. */}
          <Link href={buildWorkspaceHref(alert.clientId, "/metas", null)} className="text-brand hover:underline">
            Editar orçamento
          </Link>
        </div>
      </div>

      {/* Ações principais à vista (pedido, seção 4: "mostre Acompanhar e
          Resolver diretamente nos cards abertos") — nunca mais escondidas
          atrás de um menu "•••" (só 2 ações hoje, não precisa de menu). */}
      <AlertActionButtons alertId={alert.id} status={alert.status} />
    </div>
  );
}
