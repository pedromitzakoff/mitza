import type { ClientDiagnostics } from "@/lib/metric-diagnostics";
import type { DataAttention } from "@/lib/data-trust";

/**
 * MITZA ONE — Fase 1 (Cockpit Único do Cliente), Seção "Diagnóstico"
 * (pedido, seções 11-13): "poucos insights, priorizar os mais relevantes" —
 * nunca uma lista de 12 alertas. Núcleo puro, nenhuma classificação nova:
 * todo insight aqui é uma TRADUÇÃO em texto de um diagnóstico já calculado
 * em outro lugar —
 *
 * - `diagnostics` é o MESMO `ClientDiagnostics` que `loadClientOperationalStates`
 *   já calcula (`lib/metric-diagnostics.ts`, `evaluateClientDiagnostics`) —
 *   nenhuma segunda régua de desvio/severidade.
 * - `dataAttentions` é a MESMA lista que `/clients/[id]/dados` já exibe
 *   (`lib/data-trust.ts`, via `loadDadosPageData`) — nenhuma segunda
 *   checagem de fonte/sincronização.
 *
 * Escopo deliberado (ver relatório de entrega, seção P): Pendências e
 * Atividade (os outros 2 eixos de `ClientDiagnostics`) NÃO entram aqui —
 * Pendências já tem seção própria (Execução → Demandas, seção 24 do
 * pedido) e repeti-la aqui seria a mesma redundância que a seção 17 do
 * pedido pede para evitar; Atividade não foi pedida nos exemplos da seção
 * 11 e fica fora nesta primeira camada (pode entrar numa fase futura, se
 * fizer sentido, nunca decidido silenciosamente aqui).
 */

export type CockpitInsightSeverity = "critical" | "warning" | "info";

export interface CockpitInsight {
  id: string;
  severity: CockpitInsightSeverity;
  message: string;
}

const SEVERITY_RANK: Record<CockpitInsightSeverity, number> = { critical: 0, warning: 1, info: 2 };

export interface CockpitInsightInput {
  diagnostics: ClientDiagnostics;
  /** Rótulo goal-aware da métrica de custo (`PERFORMANCE_GOALS[goal].costMetricShortLabel`)
   * — nunca hardcoded "CPL"/"CPA", mesma convenção de `PerformanceDiagnosticCard`. */
  costLabel: string;
  dataAttentions: DataAttention[];
  /** Quantos insights mostrar no máximo — "poucos", nunca uma lista longa
   * (seção 11 do pedido). Default 4. */
  limit?: number;
}

function formatDeviationPct(deviationPct: number): string {
  return `${Math.round(Math.abs(deviationPct) * 100)}%`;
}

/** Mesmo texto/mesma regra que `PerformanceDiagnosticCard` já usa pro eixo
 * Investimento — reempacotado aqui pra caber na lista de insights do
 * cockpit (nunca uma segunda fórmula de desvio, só o mesmo
 * `MetricDiagnostic` já calculado por `evaluateClientDiagnostics`). */
export function buildCockpitInsights(input: CockpitInsightInput): CockpitInsight[] {
  const { diagnostics, costLabel, dataAttentions, limit = 4 } = input;
  const insights: CockpitInsight[] = [];

  for (const item of diagnostics.planejamento.items) {
    insights.push({ id: `planejamento-${item.type}`, severity: "info", message: item.label });
  }

  if (diagnostics.investment.isOutOfRange && diagnostics.investment.deviationPct !== null) {
    const direction = diagnostics.investment.direction === "up" ? "acima" : "abaixo";
    insights.push({
      id: "investimento",
      severity: diagnostics.investment.tone === "critical" ? "critical" : "warning",
      message: `Investimento está ${formatDeviationPct(diagnostics.investment.deviationPct)} ${direction} do ritmo esperado no mês.`,
    });
  }

  if (diagnostics.cpa?.isOutOfRange && diagnostics.cpa.deviationPct !== null) {
    insights.push({
      id: "cpa",
      severity: diagnostics.cpa.tone === "critical" ? "critical" : "warning",
      message: `${costLabel} está ${formatDeviationPct(diagnostics.cpa.deviationPct)} acima do planejado no mês.`,
    });
  }

  for (const attention of dataAttentions) {
    insights.push({
      id: attention.id,
      severity: attention.severity === "error" ? "critical" : "warning",
      message: attention.message,
    });
  }

  return insights.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, limit);
}
