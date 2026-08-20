import type { OptimizationType } from "@/lib/supabase/database.types";

/**
 * Tipos centrais do motor de Conquistas — três universos que nunca se
 * misturam semanticamente (Auditoria "Sistema de Conquistas", seção 2).
 */
export type AchievementScope = "client" | "agency" | "person";

/** `milestone` = relevante mas recorrente (ex.: 3 dias); `highlight` =
 * resultado claramente significativo (ex.: 7/14 dias, 125% da meta);
 * `record` = recorde histórico. Nomes internos, nunca "medalha"/"nível" na
 * UI. */
export type AchievementSeverity = "milestone" | "highlight" | "record";

export type ClientAchievementFamily = "recordes" | "metas" | "consistencia" | "evolucao" | "escala" | "recuperacao";
export type AgencyAchievementFamily = "crescimento" | "carteira" | "operacao" | "relacionamento" | "escala_midia";
export type PersonAchievementFamily = "revisoes" | "otimizacoes" | "clientes_atendidos" | "reports" | "tempo_de_casa" | "experiencia";

/** Snapshot da métrica por trás da conquista — guardado no metadata do
 * evento pra permitir (no futuro, fora desta etapa) gerar uma mensagem de
 * comemoração sem reprocessar nada (Auditoria, seção 28). Nunca usado pra
 * decidir estado atual — é só o retrato do momento em que a conquista
 * aconteceu. */
export interface AchievementMetricSnapshot {
  metric: "cpa" | "roas" | "result_count" | "investment" | "count";
  actual: number;
  unit: "currency" | "ratio" | "count";
  target?: number | null;
  windowStart?: string;
  windowEnd?: string;
  windowLabel?: string;
  comparisonActual?: number;
  comparisonWindowStart?: string;
  comparisonWindowEnd?: string;
  sampleResultCount?: number;
  sampleSpend?: number;
  streakDays?: number;
  optimizationType?: OptimizationType;
}

/** Um candidato produzido por uma regra pura — ainda não persistido. O
 * motor (`achievement-engine.ts`) decide qual candidato de uma mesma
 * família emitir (maior patamar só, ver seção 29 da Auditoria) e monta a
 * `idempotencyKey`/chamada da RPC. */
export interface AchievementCandidate {
  type: string;
  scope: AchievementScope;
  family: ClientAchievementFamily | AgencyAchievementFamily | PersonAchievementFamily;
  severity: AchievementSeverity;
  /** Data (civil, fuso da agência) em que a conquista de fato aconteceu —
   * nunca "agora" (o job pode rodar horas depois). Vira `occurred_at`. */
  occurredOnDate: string;
  /** Chave que distingue esta ocorrência específica dentro do tipo/escopo —
   * o motor combina com type/scope/subjectId pra formar a idempotency_key
   * final (Auditoria, seção 15). Determinístico: reprocessar o mesmo estado
   * sempre produz a mesma windowKey. */
  windowKey: string;
  clientId?: string;
  clientName?: string;
  actorTeamMemberId?: string;
  metric: AchievementMetricSnapshot;
  /** Texto curto e honesto (nunca "confete") descrevendo o que aconteceu —
   * a Página lê isso direto, nenhuma tela reconstrói a frase. */
  headline: string;
  detail: string;
}
