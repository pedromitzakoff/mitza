import type { StatusTone } from "@/components/workspace/status-dot";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import {
  getActiveDiagnosticFilters,
  metricToneSeverityRank,
  type ClientDiagnostics,
  type MetricDiagnostic,
} from "@/lib/metric-diagnostics";
import type { ClientOperationalState } from "@/lib/client-operational-state";

/**
 * Camada de projeção da Visão Geral (Etapa "Visão Geral + Reports no Core")
 * — transforma `ClientDiagnostics` (Motor de Diagnóstico Único) no shape que
 * "Prioridades de hoje" precisa. Nenhuma função aqui recalcula severidade,
 * limiar ou PRIORIDADE entre diagnósticos: régua de magnitude, sensibilidade
 * de direção e a ordem "qual eixo vence quando mais de um está ativo" são
 * todas centrais em `metric-diagnostics.ts` (`getDiagnosticPriorityRank`) —
 * aqui só se traduz o diagnóstico JÁ priorizado pro shape de apresentação
 * (frase do motivo, cor do badge).
 *
 * Substitui a versão anterior (Sistema A — `AccountHealthEvaluation`/
 * `HealthStatus`/`primaryReason`): a Visão Geral não lê mais `.evaluation`
 * em lugar nenhum desta tela.
 */
export type OverviewPriorityFilter = "planejamento" | "investimento" | "cpa" | "pendencias";

export interface OverviewPriorityItem {
  clientId: string;
  clientName: string;
  primaryFilter: OverviewPriorityFilter;
  primaryReason: string;
  tone: StatusTone;
  actionHref: string;
}

/** `MetricDiagnostic` de Investimento/CPA já fora do esperado → frase no
 * mesmo estilo que a conta usava antes ("Investimento 38% acima do
 * ritmo"/"Custo por resultado 34% acima da meta") — só o dado de origem
 * mudou (Core em vez do Motor de Saúde), o texto continua reconhecível pro
 * gestor. */
function formatMetricReason(label: string, diagnostic: MetricDiagnostic, suffix: string): string {
  const pct = diagnostic.deviationPct !== null ? Math.round(Math.abs(diagnostic.deviationPct) * 100) : 0;
  const direction = diagnostic.direction === "up" ? "acima" : "abaixo";
  return `${label} ${pct}% ${direction} ${suffix}`;
}

/**
 * Uma linha de "Prioridades de hoje" — `null` quando o cliente não tem
 * nenhum diagnóstico ativo (Planejamento completo, Investimento/CPA dentro
 * do esperado, sem Pendências): "silêncio = conta saudável", nunca uma linha
 * fabricada pra quem não precisa de atenção. `diagnostics` é passado à parte
 * de `state` (em vez de sempre `state.diagnostics`) pra permitir o recorte
 * por canal de "Prioridades" (Meta/Google) sem precisar mutar o estado —
 * ver `evaluateClientChannelDiagnostics`, `client-operational-state.ts`.
 */
export function buildOverviewPriorityItem(
  state: Pick<ClientOperationalState, "clientId" | "clientName" | "performanceGoal">,
  diagnostics: ClientDiagnostics,
): OverviewPriorityItem | null {
  const actionHref = `/clients/${state.clientId}`;

  if (diagnostics.planejamento.isIncomplete) {
    return {
      clientId: state.clientId,
      clientName: state.clientName,
      primaryFilter: "planejamento",
      primaryReason: diagnostics.planejamento.items.map((item) => item.label).join(" · "),
      tone: "warning",
      actionHref,
    };
  }

  const goalConfig = state.performanceGoal ? PERFORMANCE_GOALS[state.performanceGoal] : null;
  const metricCandidates: { filter: "investimento" | "cpa"; diagnostic: MetricDiagnostic; reason: string }[] = [];
  if (diagnostics.investment.isOutOfRange) {
    metricCandidates.push({
      filter: "investimento",
      diagnostic: diagnostics.investment,
      reason: formatMetricReason("Investimento", diagnostics.investment, "do ritmo"),
    });
  }
  if (diagnostics.cpa?.isOutOfRange) {
    metricCandidates.push({
      filter: "cpa",
      diagnostic: diagnostics.cpa,
      reason: formatMetricReason(goalConfig?.costMetricShortLabel ?? "Custo por resultado", diagnostics.cpa, "da meta"),
    });
  }
  if (metricCandidates.length > 0) {
    // Empate (ambos fora do esperado): o mais severo vence; entre tons
    // iguais, Investimento primeiro — mesma ordem de leitura de
    // `operation-filter-bar.tsx`.
    const chosen = [...metricCandidates].sort(
      (a, b) => metricToneSeverityRank(a.diagnostic.tone) - metricToneSeverityRank(b.diagnostic.tone),
    )[0];
    return {
      clientId: state.clientId,
      clientName: state.clientName,
      primaryFilter: chosen.filter,
      primaryReason: chosen.reason,
      tone: chosen.diagnostic.tone === "critical" ? "danger" : "warning",
      actionHref,
    };
  }

  if (diagnostics.pendencias.hasPendencias) {
    return {
      clientId: state.clientId,
      clientName: state.clientName,
      primaryFilter: "pendencias",
      primaryReason: diagnostics.pendencias.items.map((item) => item.label).join(" · "),
      tone: "warning",
      actionHref,
    };
  }

  return null;
}

/** Atalho pra quem só precisa saber se um cliente tem algum diagnóstico
 * ativo (Planejamento/Investimento/CPA/Pendências) — nunca reimplementa o
 * critério de `getActiveDiagnosticFilters` (que também inclui "atividade",
 * irrelevante pra "Prioridades de hoje": Atividade não tem filtro nesta
 * tela, mesma decisão já tomada na Operação). */
export function hasActiveOverviewDiagnostic(diagnostics: ClientDiagnostics): boolean {
  return getActiveDiagnosticFilters(diagnostics).some((filter) => filter !== "atividade");
}
