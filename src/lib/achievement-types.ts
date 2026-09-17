import type { OptimizationType } from "@/lib/supabase/database.types";

/**
 * Tipos centrais do motor de Conquistas — três universos que nunca se
 * misturam semanticamente (Auditoria "Sistema de Conquistas", seção 2).
 */
export type AchievementScope = "client" | "agency" | "person";

/**
 * Etapa "Conquistas por Granularidade" — a que nível a conquista pertence
 * dentro da conta do cliente. Só existe pra escopo `client` (Agência/Pessoa
 * nunca têm campanha/público/criativo). `"account"` é o nível de sempre (as
 * 11 regras da V1, consolidado por canal) — as demais são novas nesta
 * etapa, condicionadas a dado granular confiável existir pro cliente (ver
 * `achievement-sub-entity.ts`/auditoria no relatório final). Interno/tag
 * pequena na UI, nunca o protagonista do card (Cliente + Acontecimento é).
 */
export type AchievementLevel = "account" | "campaign" | "ad_set" | "creative";

/** `milestone` = relevante mas recorrente (ex.: 3 dias); `highlight` =
 * resultado claramente significativo (ex.: 7/14 dias, 125% da meta);
 * `record` = recorde histórico. Nomes internos, nunca "medalha"/"nível" na
 * UI. */
export type AchievementSeverity = "milestone" | "highlight" | "record";

/** `destaque` (Etapa "Conquistas por Granularidade") — nova família: uma
 * campanha/público/criativo é a MELHOR entre concorrentes comparáveis da
 * mesma conta, no período (nunca comparado contra o histórico do próprio
 * sujeito — isso é `recordes`, mantido exclusivo de escopo `account`). Só
 * emitida quando há ≥2 entidades com amostra válida no período (ver
 * `SUB_ENTITY_MIN_COMPARABLE_ENTITIES`, `achievement-thresholds.ts`) —
 * nunca "melhor" sem concorrência real. */
export type ClientAchievementFamily = "recordes" | "metas" | "consistencia" | "evolucao" | "escala" | "recuperacao" | "destaque";
export type AgencyAchievementFamily = "crescimento" | "carteira" | "operacao" | "relacionamento" | "escala_midia";
/** "performance" (Etapa "Equipe — Fase 4"): único acréscimo aditivo a este
 * union — carteira sob responsabilidade temporal confiável avaliada contra
 * a PRÓPRIA meta de cada cliente (nunca CPA absoluto, nunca volume/
 * investimento). Reaproveita 100% a infraestrutura já existente
 * (`operational_events`/`achievement_unlocked`/`record_achievement_event`) —
 * nenhuma tabela, nenhuma constraint nova (ver `achievement-person-performance-rules.ts`). */
export type PersonAchievementFamily =
  | "revisoes"
  | "otimizacoes"
  | "clientes_atendidos"
  | "reports"
  | "tempo_de_casa"
  | "experiencia"
  | "performance";

/** Snapshot da métrica por trás da conquista — guardado no metadata do
 * evento pra permitir (no futuro, fora desta etapa) gerar uma mensagem de
 * comemoração sem reprocessar nada (Auditoria, seção 28). Nunca usado pra
 * decidir estado atual — é só o retrato do momento em que a conquista
 * aconteceu.
 *
 * Etapa "Conquistas Auditáveis": campos `sample*`/`comparison*` adicionais
 * (investimento/faturamento/resultado por trás do CPA/ROAS, dos dois lados
 * de uma comparação) e `historySinceDate` — o "comprovante" que a Página de
 * Detalhes (`achievement-detail-drawer.tsx`) lê pra mostrar de onde cada
 * número veio, sem recalcular nada. Todos opcionais e adicionados só onde a
 * regra que gera a conquista já tinha o dado em mãos (nenhum valor é
 * inventado/estimado pra preencher um campo vazio) — um tipo com campo
 * ausente na UI é honesto; um campo preenchido com valor fabricado não
 * seria (contradiria o próprio motivo desta etapa existir). */
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
  /** `undefined` = não coletado pela regra; `null` = coletado, cliente não
   * rastreia faturamento (mesma convenção de `ClientDailyPoint.revenue`). */
  sampleRevenue?: number | null;
  comparisonResultCount?: number;
  comparisonSpend?: number;
  comparisonRevenue?: number | null;
  /** Data mais antiga do histórico diário considerado ao calcular um
   * recorde — "desde quando" o recorde vale, nunca "desde sempre" vago. */
  historySinceDate?: string;
  streakDays?: number;
  optimizationType?: OptimizationType;
}

/** De onde vieram os dados por trás de uma conquista de CLIENTE — Agência/
 * Pessoa não têm fonte de sincronização própria (contam eventos internos da
 * própria plataforma), por isso este campo só existe no escopo Cliente.
 * Capturado uma vez por cliente no momento da avaliação (`achievement-metrics.ts`)
 * e anexado a todo candidato daquele cliente pelo motor
 * (`achievement-engine.ts`) — nunca recalculado/relido na renderização
 * (salvaguarda de aprovação nº4: a Página de Detalhes só EXIBE o que já foi
 * decidido no cron, mesmo que a sincronização real tenha avançado desde
 * então). */
export interface AchievementSourceInfo {
  /** Ex.: "Meta Ads", "Meta Ads + Google Ads" — canais ativos do cliente no
   * momento da avaliação. */
  channelLabel: string;
  /** `started_at` da sincronização mais recente entre as fontes ativas do
   * cliente, no momento em que esta conquista foi avaliada — `null` só no
   * caso teórico de nunca ter havido nenhum run (não deveria acontecer:
   * sem sync confiável a conquista nem seria gerada). */
  syncedAt: string | null;
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
  /** Etapa "Conquistas por Granularidade" — `"account"` pra toda regra de
   * escopo `agency`/`person` e pras 11 regras de conta da V1. Regras novas
   * de campanha/público/criativo preenchem o nível real. */
  level: AchievementLevel;
  /** Nome da campanha/público/criativo — só quando `level !== "account"`.
   * Nunca um id (Meta/Google não garantem estabilidade, mesma decisão já
   * tomada por `creative-analytics.ts`/`campaign-analytics.ts`). */
  entityName?: string;
  metric: AchievementMetricSnapshot;
  /** Texto curto e honesto (nunca "confete") descrevendo o que aconteceu —
   * NUNCA inclui o nome do cliente (ele já é a primeira informação do card,
   * sempre separado — ver `achievements-feed.tsx`). A Página lê isso direto,
   * nenhuma tela reconstrói a frase. */
  headline: string;
  detail: string;
  /** Só escopo `client` (ver `AchievementSourceInfo`) — anexado pelo motor
   * (`achievement-engine.ts`), nunca preenchido pelas regras puras
   * (`achievement-client-rules.ts`) diretamente. */
  source?: AchievementSourceInfo;
}
