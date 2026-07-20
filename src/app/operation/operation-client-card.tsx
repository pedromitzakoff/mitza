import Link from "next/link";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { StatusDot } from "@/components/workspace/status-dot";
import type { StatusTone as WorkspaceStatusTone } from "@/components/workspace/status-dot";
import type { StatusTone } from "@/lib/status-registry";
import { OPERATION_TRIAGE_BAND_REGISTRY } from "@/lib/status-registry";
import { MIN_RELIABLE_RESULT_COUNT } from "@/lib/operation-health-thresholds";
import type { DimensionSeverity } from "@/lib/account-health-engine";
import {
  bandFromHealthStatus,
  formatDataFreshnessLabel,
  type OperationClientCard as OperationClientCardData,
  type OperationTriageBand,
} from "@/lib/operation-triage";
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

/** Rótulo curto só de apresentação do card (rodada de refinamento fino) —
 * uma escala semântica de estado (nunca um verbo/chamada de ação), na
 * mesma ordem de severidade do badge original. `em_risco` reaproveita o
 * próprio texto do registry central (`OPERATION_TRIAGE_BAND_REGISTRY`),
 * que mantém a versão por extenso pra outros usos (ex.: chips de filtro). */
const COMPACT_BAND_LABEL: Record<OperationTriageBand, string> = {
  precisa_atencao: "Crítico",
  em_risco: "Em risco",
  em_acompanhamento: "Atenção",
  saudavel: "Saudável",
};

/** Cor da faixa de severidade lateral — lida direto da variável CSS do
 * tom (funciona em claro/escuro sem duplicar os hex aqui). Aplicada via
 * `style` (não classe) pra sempre vencer o `border-color` do hover. */
const STRIPE_COLOR_VAR: Record<StatusTone, string> = {
  success: "var(--overview-success)",
  warning: "var(--overview-warning)",
  danger: "var(--overview-danger)",
  neutral: "var(--overview-text-muted)",
  info: "var(--overview-text-muted)",
  brand: "var(--brand)",
};

const countFormatter = new Intl.NumberFormat("pt-BR");

/** Moeda compacta ("R$3,2k") — só formatação de apresentação (o valor em
 * si já vem pronto do motor, nenhum cálculo novo). Existe porque os três
 * indicadores + a metadata precisam caber numa única linha (Etapa
 * "Compactação da Operação") — "R$ 3.200,00" por extenso não cabia. */
function formatCompactCurrency(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `R$${(value / 1000).toFixed(1).replace(".", ",")}k`;
  }
  return `R$${Math.round(value)}`;
}

/**
 * Card da Operação — versão compacta de 3 linhas (Etapa "Compactação da
 * Operação"): identidade+status / motivo principal / indicadores+metadata,
 * sempre na mesma altura, nunca variando por ausência de dado ou por
 * motivo secundário (que deixou de ser exibido nesta rodada — não foi
 * removido do motor, só não tem mais uma linha fixa reservada pra ele;
 * como ele volta a aparecer é decisão de uma etapa futura).
 */
export function OperationClientCard({ card, todayStr }: { card: OperationClientCardData; todayStr: string }) {
  const { evaluation } = card;
  const band = bandFromHealthStatus(evaluation.healthStatus);
  const badge = OPERATION_TRIAGE_BAND_REGISTRY[`operation_triage.${band}`];
  const freshnessLabel = formatDataFreshnessLabel(card.lastDataSyncAt, todayStr);

  const investment = evaluation.dimensions.investment;
  const results = evaluation.dimensions.results;
  const cost = evaluation.dimensions.cost;

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
      style={{ borderLeftColor: STRIPE_COLOR_VAR[badge.tone] }}
      className="mitza-pressable group flex flex-col gap-1 rounded-lg border-y border-r border-l-[3px] border-border px-3 py-2 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:border-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:border-zinc-700"
    >
      {/* Linha 1: avatar (discreto) + nome + status compacto. Gestor
       * deixou de aparecer aqui nesta rodada de refinamento (o cliente é
       * o protagonista) — o dado continua em `card.managerName`, só não
       * tem mais espaço reservado nesta linha. */}
      <div className="flex items-center gap-2">
        <ClientAvatar name={card.clientName} imageUrl={card.avatarUrl} size="xs" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{card.clientName}</p>
        <StatusDot
          tone={toWorkspaceTone(badge.tone)}
          label={COMPACT_BAND_LABEL[band]}
          emphasize={band !== "saudavel"}
          className="shrink-0"
        />
      </div>

      {/* Linha 2: motivo principal — uma linha só, nunca aumenta a altura
       * do card (trunca em vez de quebrar). */}
      <p className="truncate text-xs text-muted-foreground">{evaluation.primaryReason}</p>

      {/* Linha 3: os três indicadores (ordem fixa: investimento → resultado
       * → custo, sempre a mesma em todo card) + metadata, tudo numa linha. */}
      <div className="flex items-center gap-3">
        <MetricThermometer
          mode="higher-better"
          actual={investment.actual}
          planned={investment.planned}
          expected={investment.expected}
          formattedActual={formatCompactCurrency(investment.actual)}
          tone={SEVERITY_TONE[investment.status]}
          emptyMessage={investmentEmptyMessage}
        />
        <MetricThermometer
          mode="higher-better"
          actual={results.actual}
          planned={results.planned}
          expected={results.expected}
          formattedActual={countFormatter.format(results.actual)}
          tone={SEVERITY_TONE[results.status]}
          emptyMessage={resultsEmptyMessage}
        />
        <MetricThermometer
          mode="lower-better"
          actual={cost.actual}
          planned={cost.planned}
          expected={cost.expected}
          formattedActual={cost.actual !== null ? formatCompactCurrency(cost.actual) : "—"}
          tone={SEVERITY_TONE[cost.status]}
          emptyMessage={costEmptyMessage}
        />

        <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
          {freshnessLabel}
          {card.overdueTasksCount > 0
            ? ` · ${card.overdueTasksCount} tarefa${card.overdueTasksCount > 1 ? "s" : ""} atrasada${card.overdueTasksCount > 1 ? "s" : ""}`
            : ""}
        </span>
      </div>
    </Link>
  );
}
