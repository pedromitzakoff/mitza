import Link from "next/link";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { StatusDot } from "@/components/workspace/status-dot";
import type { StatusTone as WorkspaceStatusTone } from "@/components/workspace/status-dot";
import type { StatusTone } from "@/lib/status-registry";
import { OPERATION_TRIAGE_BAND_REGISTRY } from "@/lib/status-registry";
import { formatCurrency } from "@/lib/format";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { MIN_RELIABLE_RESULT_COUNT } from "@/lib/operation-health-thresholds";
import type { DimensionSeverity } from "@/lib/account-health-engine";
import {
  bandFromHealthStatus,
  formatDataFreshnessLabel,
  type OperationClientCard as OperationClientCardData,
} from "@/lib/operation-triage";
import { collectAccountHealthReasons } from "@/lib/account-health-engine";
import { MetricThermometer, type MetricThermometerTone } from "./metric-thermometer";

/** `StatusTone` do registry central inclui "info"/"brand", que as bandas da
 * Operação nunca usam — mesmo motivo do mapeamento que já existia aqui
 * antes do redesenho. */
function toWorkspaceTone(tone: StatusTone): WorkspaceStatusTone {
  if (tone === "info") return "neutral";
  return tone;
}

const SEVERITY_TONE: Record<DimensionSeverity, MetricThermometerTone> = {
  nenhum: "neutral",
  leve: "neutral",
  relevante: "warning",
  grave: "danger",
};

const countFormatter = new Intl.NumberFormat("pt-BR");

export function OperationClientCard({ card, todayStr }: { card: OperationClientCardData; todayStr: string }) {
  const { evaluation } = card;
  const band = bandFromHealthStatus(evaluation.healthStatus);
  const badge = OPERATION_TRIAGE_BAND_REGISTRY[`operation_triage.${band}`];
  const reasons = collectAccountHealthReasons(evaluation);
  const secondaryReasons = reasons.slice(1);
  const freshnessLabel = formatDataFreshnessLabel(card.lastDataSyncAt, todayStr);

  const investment = evaluation.dimensions.investment;
  const results = evaluation.dimensions.results;
  const cost = evaluation.dimensions.cost;

  const resultLabel = card.performanceGoal ? PERFORMANCE_GOALS[card.performanceGoal].resultMetricLabel : "Resultado";
  const costLabel = card.performanceGoal ? PERFORMANCE_GOALS[card.performanceGoal].costMetricLabel : "Custo por resultado";

  const investmentEmptyMessage =
    investment.planned === null
      ? "Planejamento não definido"
      : !investment.hasSyncedData
        ? "Sem dados de investimento"
        : undefined;

  const resultsEmptyMessage = !card.performanceGoal
    ? "Objetivo não configurado"
    : results.planned === null
      ? "Meta não definida"
      : !results.hasPerformanceData
        ? "Sem resultados registrados"
        : undefined;

  const costEmptyMessage = !cost.hasReliableSample
    ? `Aguardando amostra suficiente — ${cost.sampleSize} de ${MIN_RELIABLE_RESULT_COUNT}`
    : cost.planned === null
      ? "Meta não definida"
      : cost.actual === null
        ? "Sem dados de custo"
        : undefined;

  return (
    <Link
      href={`/clients/${card.clientId}`}
      className="mitza-pressable group flex flex-col gap-3 rounded-xl border border-border p-4 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:border-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:border-zinc-700"
    >
      <div className="flex items-start gap-3">
        <ClientAvatar name={card.clientName} imageUrl={card.avatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{card.clientName}</p>
          <p className="truncate text-xs text-muted-foreground">{card.managerName ?? "Sem responsável"}</p>
        </div>
      </div>

      {/* Motivo principal — o elemento que mais chama atenção no card
       * (seção 3 do pedido), nunca escondido em tooltip. */}
      <p className="text-sm font-medium text-foreground">{evaluation.primaryReason}</p>
      {secondaryReasons.length > 0 && (
        <p className="-mt-2 truncate text-xs text-muted-foreground">
          {secondaryReasons[0]}
          {secondaryReasons.length > 1 ? ` +${secondaryReasons.length - 1}` : ""}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricThermometer
          label="Investimento"
          mode="higher-better"
          actual={investment.actual}
          planned={investment.planned}
          expected={investment.expected}
          formattedActual={formatCurrency(investment.actual)}
          formattedPlanned={investment.planned !== null ? formatCurrency(investment.planned) : "—"}
          tone={SEVERITY_TONE[investment.status]}
          emptyMessage={investmentEmptyMessage}
        />
        <MetricThermometer
          label={resultLabel}
          mode="higher-better"
          actual={results.actual}
          planned={results.planned}
          expected={results.expected}
          formattedActual={countFormatter.format(results.actual)}
          formattedPlanned={results.planned !== null ? countFormatter.format(results.planned) : "—"}
          tone={SEVERITY_TONE[results.status]}
          emptyMessage={resultsEmptyMessage}
        />
        <MetricThermometer
          label={costLabel}
          mode="lower-better"
          actual={cost.actual}
          planned={cost.planned}
          expected={cost.expected}
          formattedActual={cost.actual !== null ? formatCurrency(cost.actual) : "—"}
          formattedPlanned={cost.planned !== null ? formatCurrency(cost.planned) : "—"}
          tone={SEVERITY_TONE[cost.status]}
          emptyMessage={costEmptyMessage}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <StatusDot tone={toWorkspaceTone(badge.tone)} label={badge.label} emphasize={band !== "saudavel"} />
          <span className="text-xs text-muted-foreground">{freshnessLabel}</span>
          {card.overdueTasksCount > 0 && (
            <span className="text-xs text-red-600 dark:text-red-400">
              {card.overdueTasksCount} tarefa{card.overdueTasksCount > 1 ? "s" : ""} atrasada
              {card.overdueTasksCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <span className="text-xs font-medium text-brand opacity-0 transition-opacity group-hover:opacity-100">
          Abrir cliente →
        </span>
      </div>
    </Link>
  );
}
