import type { AccountReviewOutcome, AccountReviewReason, OptimizationType } from "@/lib/supabase/database.types";

/** Taxonomia central de Análises da Conta e Otimizações (Etapa 57) — nenhuma
 * string solta de motivo/resultado/tipo/ação deve ser escrita fora daqui.
 * Espelha exatamente as constraints `check` de account_reviews/
 * account_optimizations (supabase/account-reviews.sql). */

export const ACCOUNT_REVIEW_REASONS: AccountReviewReason[] = [
  "ROUTINE",
  "PERFORMANCE_ALERT",
  "INVESTMENT_ALERT",
  "CLIENT_REQUEST",
  "OPPORTUNITY",
  "OTHER",
];

export const ACCOUNT_REVIEW_REASON_LABEL: Record<AccountReviewReason, string> = {
  ROUTINE: "Rotina",
  PERFORMANCE_ALERT: "Alerta de performance",
  INVESTMENT_ALERT: "Alerta de investimento",
  CLIENT_REQUEST: "Solicitação do cliente",
  OPPORTUNITY: "Oportunidade identificada",
  OTHER: "Outro",
};

export const ACCOUNT_REVIEW_OUTCOMES: AccountReviewOutcome[] = ["NO_CHANGE", "OPTIMIZATION_PERFORMED", "ISSUE_IDENTIFIED"];

export const ACCOUNT_REVIEW_OUTCOME_LABEL: Record<AccountReviewOutcome, string> = {
  NO_CHANGE: "Sem alteração necessária",
  OPTIMIZATION_PERFORMED: "Otimização realizada",
  ISSUE_IDENTIFIED: "Problema identificado",
};

export const ACCOUNT_REVIEW_OUTCOME_DESCRIPTION: Record<AccountReviewOutcome, string> = {
  NO_CHANGE: "A conta foi analisada e nenhuma mudança foi necessária.",
  OPTIMIZATION_PERFORMED: "Uma ou mais alterações foram realizadas na conta.",
  ISSUE_IDENTIFIED: "Foi encontrada uma pendência ou problema que exige acompanhamento.",
};

export const OPTIMIZATION_TYPES: OptimizationType[] = [
  "CREATIVE",
  "AUDIENCE",
  "BID",
  "BUDGET",
  "CAMPAIGN",
  "AD_SET",
  "PLACEMENT",
  "ACCOUNT_STRUCTURE",
  "TRACKING",
  "OTHER",
  "REMARKETING",
];

export const OPTIMIZATION_TYPE_LABEL: Record<OptimizationType, string> = {
  CREATIVE: "Criativo",
  AUDIENCE: "Público",
  BID: "Lance",
  BUDGET: "Orçamento",
  CAMPAIGN: "Campanha",
  AD_SET: "Conjunto de anúncios",
  PLACEMENT: "Posicionamento",
  ACCOUNT_STRUCTURE: "Estrutura da conta",
  TRACKING: "Tracking / Mensuração",
  OTHER: "Outro",
  REMARKETING: "Remarketing",
};

/** Ações compatíveis por tipo — a UI só mostra as ações desta lista pro tipo
 * selecionado; o banco valida a mesma combinação via check constraint
 * (defesa em profundidade, nunca confiar só no frontend). */
export const OPTIMIZATION_ACTIONS_BY_TYPE: Record<OptimizationType, string[]> = {
  CREATIVE: ["PAUSED", "ACTIVATED", "ADDED", "REPLACED", "TEST_CREATED", "OTHER"],
  AUDIENCE: ["CREATED", "PAUSED", "ACTIVATED", "SEGMENTATION_CHANGED", "SEGMENTATION_EXCLUDED", "OTHER"],
  BID: ["INCREASED", "DECREASED", "STRATEGY_CHANGED", "LIMIT_CHANGED", "OTHER"],
  BUDGET: ["INCREASED", "DECREASED", "REDISTRIBUTED", "OTHER"],
  CAMPAIGN: ["CREATED", "PAUSED", "ACTIVATED", "CONFIGURATION_CHANGED", "OTHER"],
  AD_SET: ["CREATED", "PAUSED", "ACTIVATED", "CONFIGURATION_CHANGED", "OTHER"],
  PLACEMENT: ["ADDED", "REMOVED", "CHANGED", "OTHER"],
  ACCOUNT_STRUCTURE: ["REORGANIZED", "CONSOLIDATED", "SPLIT", "OTHER"],
  TRACKING: ["CONFIGURED", "CORRECTED", "VALIDATED", "OTHER"],
  OTHER: ["OTHER"],
  REMARKETING: ["OTHER"],
};

export const OPTIMIZATION_ACTION_LABEL: Record<string, string> = {
  PAUSED: "Pausou",
  ACTIVATED: "Ativou",
  ADDED: "Adicionou",
  REPLACED: "Substituiu",
  TEST_CREATED: "Criou teste",
  CREATED: "Criou",
  SEGMENTATION_CHANGED: "Alterou segmentação",
  SEGMENTATION_EXCLUDED: "Excluiu segmentação",
  INCREASED: "Aumentou",
  DECREASED: "Reduziu",
  STRATEGY_CHANGED: "Mudou estratégia",
  LIMIT_CHANGED: "Alterou limite",
  REDISTRIBUTED: "Redistribuiu",
  CONFIGURATION_CHANGED: "Alterou configuração",
  REMOVED: "Removeu",
  CHANGED: "Alterou",
  REORGANIZED: "Reorganizou",
  CONSOLIDATED: "Consolidou",
  SPLIT: "Dividiu",
  CONFIGURED: "Configurou",
  CORRECTED: "Corrigiu",
  VALIDATED: "Validou",
  OTHER: "Outro",
};

export interface OptimizationDraft {
  type: OptimizationType;
  action: string;
  description: string;
  reason: string;
  expectedImpact: string;
}

export function emptyOptimizationDraft(): OptimizationDraft {
  return { type: "CREATIVE", action: OPTIMIZATION_ACTIONS_BY_TYPE.CREATIVE[0], description: "", reason: "", expectedImpact: "" };
}
