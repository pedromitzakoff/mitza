import type { AccountReviewDiagnosis, AccountReviewOutcome, AccountReviewReason, OptimizationType } from "@/lib/supabase/database.types";

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

/**
 * Diagnóstico (Etapa "Histórico de Decisões Operacionais") — o que o gestor
 * OBSERVOU na conta, dimensão nova e ortogonal a reason ("por que revisou")
 * e outcome ("o que resultou da revisão"). Comparado contra o que já existe
 * antes de nascer: `performance_goal`/CPA-CPL são classificação AUTOMÁTICA
 * (lib/account-health-engine.ts) — este campo é percepção MANUAL do gestor
 * e NUNCA alimenta aquele motor (nenhum código desta etapa lê `diagnosis`
 * fora de apresentação/histórico). Lista enxuta de propósito — cobre os
 * dois eixos que realmente aparecem na operação (custo vs. meta, volume,
 * orçamento, fadiga de criativo/público/campanha, dados insuficientes) sem
 * duplicar o que `reason`/`outcome` já perguntam.
 */
export const ACCOUNT_REVIEW_DIAGNOSES: AccountReviewDiagnosis[] = [
  "HEALTHY",
  "COST_ABOVE_TARGET",
  "COST_BELOW_TARGET",
  "LOW_VOLUME",
  "BUDGET_LIMITED",
  "CREATIVE_FATIGUE",
  "AUDIENCE_FATIGUE",
  "CAMPAIGN_UNDERPERFORMING",
  "INSUFFICIENT_DATA",
];

export const ACCOUNT_REVIEW_DIAGNOSIS_LABEL: Record<AccountReviewDiagnosis, string> = {
  HEALTHY: "Conta saudável",
  COST_ABOVE_TARGET: "Custo por resultado acima da meta",
  COST_BELOW_TARGET: "Custo por resultado melhor que a meta",
  LOW_VOLUME: "Baixo volume de resultados",
  BUDGET_LIMITED: "Orçamento limitado",
  CREATIVE_FATIGUE: "Criativo perdendo performance",
  AUDIENCE_FATIGUE: "Público perdendo performance",
  CAMPAIGN_UNDERPERFORMING: "Campanha com baixa performance",
  INSUFFICIENT_DATA: "Dados insuficientes",
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

/**
 * AÇÃO por chips (Etapa "Histórico de Decisões Operacionais", seção 4/6 do
 * pedido: "o gestor não pensa em categorias, pensa nas decisões que
 * tomou"). Cada chip já É a decisão (tipo + ação real de
 * `account_optimizations`) — nenhuma ação nova no banco, só uma seleção
 * curada das combinações que a operação realmente usa. Antes vivia só em
 * `lib/recurring-tasks.ts` (usado só pela tarefa recorrente "Otimização");
 * nesta etapa passa a ser a ÚNICA forma de registrar AÇÃO em qualquer
 * entrada (revisão manual e execução de recorrência), então mora aqui, ao
 * lado do resto da taxonomia central.
 *
 * Ampliada nesta etapa (era só Campanhas/Públicos/Criativos/Orçamento com 2
 * ações cada) pra cobrir exatamente a lista pedida — "Alterou campanha"/
 * "Criou campanha" (CAMPAIGN.CONFIGURATION_CHANGED/CREATED, já existiam no
 * banco, só não apareciam nos chips) e "Alterou público"
 * (AUDIENCE.SEGMENTATION_CHANGED, idem) — zero mudança de schema.
 */
export interface OptimizationQuickAction {
  type: OptimizationType;
  action: string;
  icon: string;
  label: string;
}

export interface OptimizationQuickGroup {
  type: OptimizationType;
  groupLabel: string;
  actions: OptimizationQuickAction[];
}

/** Valida um valor solto de diagnóstico contra a lista oficial — mesmo
 * princípio de defesa em profundidade já usado pra reason/outcome/tipo de
 * otimização: o servidor nunca confia num valor vindo do formulário sem
 * checar contra a taxonomia central primeiro. */
export function isValidAccountReviewDiagnosis(value: string): value is AccountReviewDiagnosis {
  return (ACCOUNT_REVIEW_DIAGNOSES as string[]).includes(value);
}

export const OPTIMIZATION_QUICK_GROUPS: OptimizationQuickGroup[] = [
  {
    type: "CAMPAIGN",
    groupLabel: "Campanhas",
    actions: [
      { type: "CAMPAIGN", action: "CREATED", icon: "＋", label: "Criou" },
      { type: "CAMPAIGN", action: "ACTIVATED", icon: "▶", label: "Ativou" },
      { type: "CAMPAIGN", action: "PAUSED", icon: "⏸", label: "Pausou" },
      { type: "CAMPAIGN", action: "CONFIGURATION_CHANGED", icon: "✎", label: "Alterou" },
    ],
  },
  {
    type: "AUDIENCE",
    groupLabel: "Públicos",
    actions: [
      { type: "AUDIENCE", action: "ACTIVATED", icon: "▶", label: "Ativou" },
      { type: "AUDIENCE", action: "PAUSED", icon: "⏸", label: "Pausou" },
      { type: "AUDIENCE", action: "SEGMENTATION_CHANGED", icon: "✎", label: "Alterou" },
    ],
  },
  {
    type: "CREATIVE",
    groupLabel: "Criativos",
    actions: [
      { type: "CREATIVE", action: "ADDED", icon: "＋", label: "Adicionou" },
      { type: "CREATIVE", action: "PAUSED", icon: "⏸", label: "Pausou" },
    ],
  },
  {
    type: "BUDGET",
    groupLabel: "Orçamento",
    actions: [
      { type: "BUDGET", action: "INCREASED", icon: "⬆", label: "Aumentou" },
      { type: "BUDGET", action: "DECREASED", icon: "⬇", label: "Reduziu" },
      { type: "BUDGET", action: "REDISTRIBUTED", icon: "⇄", label: "Redistribuiu" },
    ],
  },
];

export interface OptimizationSelection {
  type: OptimizationType;
  action: string;
  quantity: number;
}

/** Valida o JSON do picker de chips (`optimization_selections_json`,
 * montado no cliente por `OptimizationQuickPicker`) contra as combinações
 * curadas de `OPTIMIZATION_QUICK_GROUPS` — nunca confia em type/action/
 * quantity vindos do formulário sem checar contra a lista oficial (defesa em
 * profundidade). Centralizada aqui nesta etapa: antes existia uma cópia só
 * em `recurring-task-actions.ts` (pra recorrência "Otimização"); agora a
 * revisão manual da conta usa exatamente o mesmo picker/formato, então
 * precisa da mesma validação — uma função só, dois chamadores. */
export function parseOptimizationSelections(raw: string): OptimizationSelection[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const valid: OptimizationSelection[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const type = (item as Record<string, unknown>).type;
    const action = (item as Record<string, unknown>).action;
    const quantity = Math.trunc(Number((item as Record<string, unknown>).quantity));

    const isKnownCombo = OPTIMIZATION_QUICK_GROUPS.some((group) =>
      group.actions.some((quickAction) => quickAction.type === type && quickAction.action === action),
    );
    if (!isKnownCombo || !(quantity > 0)) continue;

    valid.push({ type: type as OptimizationType, action: action as string, quantity });
  }
  return valid;
}
