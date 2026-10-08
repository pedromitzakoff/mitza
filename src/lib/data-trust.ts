import type { ImportProviderDb, ImportSourceStatusDb, GoalResultSourceDb } from "@/lib/supabase/database.types";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";

/**
 * Núcleo puro da Etapa "MEGA FACELIFT — Fase 5: Dados" — a pergunta que
 * este módulo responde é sempre "posso confiar nesse dado?", nunca "esse
 * resultado é bom?" (isso é Performance, nunca duplicado aqui). Deliberado:
 * NENHUMA função aqui classifica "conectado/desconectado" — só reflete os 3
 * campos que `lib/stract-sync.ts`/`lib/meta-api-ingest-run.ts` já mantêm com
 * disciplina (auditados antes de escrever este arquivo):
 *
 * - `import_sources.status` (`pending`/`active`/`error`/`disabled`/`no_data`)
 *   — SAÚDE PERSISTENTE da fonte, avançada SÓ quando a leitura encontrou
 *   dado real (nunca "sempre ativa só porque rodou sem lançar exceção").
 * - `import_sources.last_imported_date` — data (civil) do dado mais recente
 *   de fato lido na última sincronização bem-sucedida — a "data efetiva do
 *   dado" (seção 5 do pedido), nunca um horário de sincronização.
 * - `import_sources.last_success_at` — INSTANTE em que essa sincronização
 *   rodou — a "data de sincronização", sempre distinta da anterior (um
 *   cliente pode sincronizar com sucesso hoje e ainda assim só ter dado real
 *   até semanas atrás — achado real documentado em `getLatestDailySpendDate`,
 *   `lib/performance-queries.ts`).
 *
 * Deliberadamente SEM threshold de "dado antigo demais" — a auditoria desta
 * fase achou só `STALE_RUNNING_RUN_THRESHOLD_MS` (`lib/stract-sync.ts`),
 * que resolve um problema diferente (execução travada em "running", nunca
 * frescor de dado) e não serve de precedente aqui. Inventar um novo número
 * ("dado velho depois de N dias") seria exatamente a heurística frágil que
 * o pedido pede pra evitar — a tela mostra a data real (`formatShortDate`/
 * `formatRelativeDateTime`, por quem monta a página) e deixa o julgamento
 * pro gestor. Nenhuma das Atenções desta tela depende de um prazo inventado.
 */

export const PROVIDER_LABEL: Record<ImportProviderDb, string> = {
  stract: "Stract",
  meta_api: "Meta API",
};

export type ImportSourceDisplayStatusKey = "disabled" | "pending" | "error" | "no_data" | "active";

export interface ImportSourceDisplayStatus {
  key: ImportSourceDisplayStatusKey;
  label: string;
  badgeClassName: string;
}

const BADGE_NEUTRAL = "bg-overview-surface-subtle text-overview-text-secondary";
const BADGE_DANGER = "bg-overview-danger-subtle text-overview-danger";
const BADGE_WARNING = "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
const BADGE_SUCCESS = "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300";

/**
 * Status exibido pra UMA fonte — reflete `enabled` + `import_sources.status`
 * literalmente, nunca uma segunda classificação. `enabled = false` sempre
 * vence (intenção declarada do admin, único campo que decide leitura em
 * todo o resto da plataforma — ver `lib/import-sources.ts`), mesmo que
 * `status` ainda diga "active" de antes de desativar.
 */
export function resolveImportSourceDisplayStatus(source: { enabled: boolean; status: ImportSourceStatusDb }): ImportSourceDisplayStatus {
  if (!source.enabled) return { key: "disabled", label: "Desativada", badgeClassName: BADGE_NEUTRAL };
  switch (source.status) {
    case "error":
      return { key: "error", label: "Erro de sincronização", badgeClassName: BADGE_DANGER };
    case "no_data":
      return { key: "no_data", label: "Sem dados recebidos", badgeClassName: BADGE_WARNING };
    case "pending":
      return { key: "pending", label: "Aguardando primeira sincronização", badgeClassName: BADGE_NEUTRAL };
    case "active":
    default:
      return { key: "active", label: "Atualizada", badgeClassName: BADGE_SUCCESS };
  }
}

export interface DataAttention {
  id: string;
  severity: "error" | "warning";
  message: string;
}

export interface ImportSourceAttentionInput {
  id: string;
  provider: ImportProviderDb;
  channel: TrafficChannel;
  enabled: boolean;
  status: ImportSourceStatusDb;
}

/** Atenções determinísticas por FONTE — só os dois estados que o próprio
 * pipeline já marca como problema real (seção 1/9 do pedido: "prefiro 2
 * diagnósticos corretos a 10 heurísticas frágeis"). Fonte desativada ou
 * aguardando primeira sincronização nunca gera atenção — desativar é uma
 * decisão deliberada, e "ainda não rodou" não é um problema comprovado. */
export function buildSourceAttentions(sources: ImportSourceAttentionInput[]): DataAttention[] {
  const attentions: DataAttention[] = [];
  for (const source of sources) {
    if (!source.enabled) continue;
    const channelLabel = TRAFFIC_CHANNELS[source.channel].label;
    const providerLabel = PROVIDER_LABEL[source.provider];
    if (source.status === "error") {
      attentions.push({
        id: `source-error-${source.id}`,
        severity: "error",
        message: `${providerLabel} · ${channelLabel}: erro na última sincronização.`,
      });
    } else if (source.status === "no_data") {
      attentions.push({
        id: `source-no-data-${source.id}`,
        severity: "warning",
        message: `${providerLabel} · ${channelLabel}: a última sincronização completa não encontrou nenhuma linha.`,
      });
    }
  }
  return attentions;
}

export interface GoalCoverageSourceInput {
  id: string;
  channel: TrafficChannel;
  status: ImportSourceStatusDb;
}

export interface GoalCoverageResult {
  /** Fontes HABILITADAS cujo canal está dentro do escopo do objetivo
   * (`goalChannels` vazio = sem restrição, qualquer fonte habilitada conta —
   * mesma regra de `channels: []` em `lib/client-goals.ts`). */
  relevantSources: GoalCoverageSourceInput[];
  /** Entre as relevantes, as que já têm status "active" (dado real recebido
   * ao menos uma vez) — nunca inferido de nenhum outro lugar. */
  activeSources: GoalCoverageSourceInput[];
}

/** Cruza o escopo de canal de UM objetivo com as fontes habilitadas do
 * cliente — nunca afirma "automático via Meta Ads" sem essa checagem
 * (seção 8 do pedido: "nunca inferir uma fonte específica só porque
 * result_source = automatic"). */
export function resolveGoalCoverage(goalChannels: TrafficChannel[], enabledSources: GoalCoverageSourceInput[]): GoalCoverageResult {
  const relevantSources = goalChannels.length > 0 ? enabledSources.filter((s) => goalChannels.includes(s.channel)) : enabledSources;
  const activeSources = relevantSources.filter((s) => s.status === "active");
  return { relevantSources, activeSources };
}

export interface GoalAttentionInput {
  resultType: PerformanceGoal;
  resultSource: GoalResultSourceDb;
  channels: TrafficChannel[];
}

/** Atenções determinísticas por OBJETIVO — só quando `result_source =
 * 'automatic'` (o próprio admin declarou que o resultado vem de
 * sincronização automática) e a checagem de cobertura prova uma lacuna real:
 * nenhuma fonte habilitada no escopo do objetivo, ou nenhuma delas com
 * `metric_mappings` ativo pra este `goal` (sem mapeamento, a fonte nunca
 * escreveria esse resultado em `daily_performance`, mesmo sincronizando com
 * sucesso todo dia). Objetivo manual nunca gera atenção aqui — é uma escolha
 * válida, não uma lacuna. */
export function buildGoalAttentions(
  goals: GoalAttentionInput[],
  enabledSources: GoalCoverageSourceInput[],
  activeMappingGoalsBySourceId: Map<string, PerformanceGoal[]>,
): DataAttention[] {
  const attentions: DataAttention[] = [];
  for (const goal of goals) {
    if (goal.resultSource !== "automatic") continue;
    const goalLabel = PERFORMANCE_GOALS[goal.resultType].label;
    const { relevantSources, activeSources } = resolveGoalCoverage(goal.channels, enabledSources);

    if (relevantSources.length === 0) {
      attentions.push({
        id: `goal-no-source-${goal.resultType}`,
        severity: "warning",
        message: `Objetivo ${goalLabel}: configurado como automático, mas nenhuma fonte ativa alimenta esse resultado.`,
      });
      continue;
    }

    const hasMapping = activeSources.some((source) => (activeMappingGoalsBySourceId.get(source.id) ?? []).includes(goal.resultType));
    if (!hasMapping) {
      attentions.push({
        id: `goal-no-mapping-${goal.resultType}`,
        severity: "warning",
        message: `Objetivo ${goalLabel}: as fontes ativas não têm mapeamento configurado para captar esse resultado.`,
      });
    }
  }
  return attentions;
}

/** Data (civil) mais recente entre `last_imported_date` das fontes
 * HABILITADAS — resposta de "até quando os dados deste cliente são reais?",
 * nunca confundida com "quando a sincronização rodou" (ver doc-comment do
 * arquivo). `null` = nenhuma fonte habilitada tem nenhum dado real ainda. */
export function resolveLatestImportedDate(sources: { enabled: boolean; lastImportedDate: string | null }[]): string | null {
  let latest: string | null = null;
  for (const source of sources) {
    if (!source.enabled || !source.lastImportedDate) continue;
    if (!latest || source.lastImportedDate > latest) latest = source.lastImportedDate;
  }
  return latest;
}

/** Instante mais recente entre `last_success_at` das fontes HABILITADAS —
 * mesma regra/formato de `resolveLatestImportedDate`, só sobre o OUTRO dos
 * 3 campos que este módulo reflete (ver doc-comment do arquivo): "quando a
 * sincronização rodou com sucesso", sempre distinto de "até quando o dado é
 * real". `null` = nenhuma fonte habilitada sincronizou com sucesso ainda
 * (nunca inferido de nenhum outro campo). */
export function resolveLatestSuccessAt(sources: { enabled: boolean; lastSuccessAt: string | null }[]): string | null {
  let latest: string | null = null;
  for (const source of sources) {
    if (!source.enabled || !source.lastSuccessAt) continue;
    if (!latest || source.lastSuccessAt > latest) latest = source.lastSuccessAt;
  }
  return latest;
}
