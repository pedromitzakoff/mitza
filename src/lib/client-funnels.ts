/**
 * Núcleo puro da Etapa "Gestão de Funis Estratégicos por Cliente" — sem
 * Supabase, sem saber de onde vêm as linhas. Ver `supabase/client-funnels.sql`
 * pro porquê de `client_funnels`/`campaign_funnel_assignments` serem a fonte
 * única desse vínculo (substitui o núcleo da Etapa anterior,
 * `report-view-classification.ts`, com o mesmo padrão de nome-ponte pra
 * granularidades sem id — ver `buildFunnelByCampaignName`).
 *
 * Três conceitos que este módulo NUNCA confunde:
 *   - Funil estratégico (`ClientFunnel`): definido pelo gestor, configurável.
 *   - Classificação campanha→funil (`CampaignFunnelAssignment`): vínculo
 *     manual, sempre por campaignId, nunca inferido silenciosamente.
 *   - Meta de resultado (`PerformanceGoal`, `performance-goals.ts`): um funil
 *     PODE linkar a uma já configurada em `client_goals`, nunca duplica seu
 *     armazenamento — ver `linkedResultType`.
 */

import type { PerformanceGoal } from "./performance-goals";

export const FUNNEL_INDICATOR_VALUES = ["results", "impressions", "reach", "clicks"] as const;
export type FunnelIndicator = (typeof FUNNEL_INDICATOR_VALUES)[number];

export const FUNNEL_INDICATOR_LABELS: Record<FunnelIndicator, string> = {
  results: "Resultados",
  impressions: "Impressões",
  reach: "Alcance",
  clicks: "Cliques",
};

export interface ClientFunnel {
  id: string;
  clientId: string;
  name: string;
  namingKey: string;
  isActive: boolean;
  linkedResultType: PerformanceGoal | null;
  relevantIndicators: FunnelIndicator[];
  sortOrder: number;
}

export interface CampaignFunnelAssignment {
  campaignId: string;
  funnelId: string;
}

/**
 * Normaliza o texto digitado pro campo `naming_key` — sempre maiúsculo, sem
 * espaço nas pontas, nunca com colchetes armazenados (a busca no nome da
 * campanha sempre monta `[chave]` na hora, ver `campaignNameHasKey`).
 */
export function normalizeNamingKey(input: string): string {
  return input.trim().toUpperCase().replace(/^\[+/, "").replace(/\]+$/, "");
}

export function isValidNamingKey(key: string): boolean {
  return key.length > 0 && !key.includes("[") && !key.includes("]");
}

/** Remove indicadores desconhecidos e duplicados — nunca uma lista arbitrária
 * chega em `client_funnels.relevant_indicators`. */
export function sanitizeFunnelIndicators(input: readonly string[]): FunnelIndicator[] {
  const known = new Set<string>(FUNNEL_INDICATOR_VALUES);
  const seen = new Set<FunnelIndicator>();
  const result: FunnelIndicator[] = [];
  for (const value of input) {
    if (known.has(value) && !seen.has(value as FunnelIndicator)) {
      seen.add(value as FunnelIndicator);
      result.push(value as FunnelIndicator);
    }
  }
  return result;
}

/** "results" só produz número real quando o funil tem meta vinculada — sem
 * isso, mesmo selecionado, a Visão por Funil nunca fabrica uma contagem. */
export function funnelShowsResults(funnel: Pick<ClientFunnel, "linkedResultType" | "relevantIndicators">): boolean {
  return funnel.linkedResultType !== null && funnel.relevantIndicators.includes("results");
}

function campaignNameHasKey(campaignName: string, namingKey: string): boolean {
  const needle = `[${namingKey}]`.toUpperCase();
  return campaignName.toUpperCase().includes(needle);
}

export type KeySuggestion =
  | { kind: "matched"; funnelId: string }
  | { kind: "no_key" }
  | { kind: "ambiguous"; funnelIds: string[] };

/**
 * Sugere um funil pela chave de nomenclatura reconhecida no nome da
 * campanha — NUNCA uma classificação definitiva (auditoria seção 3: "a
 * sugestão não é uma classificação definitiva"). Só considera funis ativos;
 * um funil desativado nunca aparece como sugestão pra campanha nova, mas
 * campanhas já classificadas nele continuam classificadas (desativar não
 * desclassifica, ver `data layer`).
 */
export function suggestFunnelForCampaignName(campaignName: string, funnels: readonly ClientFunnel[]): KeySuggestion {
  const matches = funnels.filter((f) => f.isActive && campaignNameHasKey(campaignName, f.namingKey));
  if (matches.length === 0) return { kind: "no_key" };
  if (matches.length > 1) return { kind: "ambiguous", funnelIds: matches.map((f) => f.id) };
  return { kind: "matched", funnelId: matches[0].id };
}

/** campaignId -> funnelId, direto das confirmações (única fonte, sempre por
 * id, nunca por nome). */
export function buildFunnelByCampaignId(assignments: readonly CampaignFunnelAssignment[]): Map<string, string> {
  return new Map(assignments.map((a) => [a.campaignId, a.funnelId]));
}

/**
 * Deriva um lookup por NOME de campanha a partir da classificação (por id) +
 * as linhas de `campaign_daily_metrics` do período (única granularidade que
 * carrega id e nome juntos) — Públicos/Criativos/Posicionamentos só têm
 * `campaignName` (auditoria), então a ponte entre eles e a classificação só
 * pode ser pelo nome, com o mesmo risco de ambiguidade já tratado na Etapa
 * anterior (campanha excluída e recriada com o mesmo nome, por exemplo): o
 * nome vira `"ambiguous"` — nunca escolhemos uma das duas classificações
 * arbitrariamente.
 */
export function buildFunnelByCampaignName(
  funnelByCampaignId: Map<string, string>,
  campaignRows: readonly { campaignId: string | null; campaignName: string }[],
): Map<string, string | "ambiguous"> {
  const byName = new Map<string, string | "ambiguous">();

  for (const row of campaignRows) {
    if (!row.campaignId) continue;
    const funnelId = funnelByCampaignId.get(row.campaignId);
    if (!funnelId) continue;
    const existing = byName.get(row.campaignName);
    if (existing === undefined) {
      byName.set(row.campaignName, funnelId);
    } else if (existing !== funnelId) {
      byName.set(row.campaignName, "ambiguous");
    }
  }

  return byName;
}

/** `null` quando o nome não resolve com segurança pra um funil (sem
 * ocorrência no período ou ambíguo) — quem consome trata isso como "não
 * filtrável com segurança", nunca escolhe um funil arbitrário. */
export function resolveFunnelForCampaignName(byName: Map<string, string | "ambiguous">, campaignName: string): string | null {
  const funnelId = byName.get(campaignName);
  return funnelId === undefined || funnelId === "ambiguous" ? null : funnelId;
}

/**
 * Resolve o funil de uma linha de Públicos/Criativos/Posicionamentos — SEMPRE
 * prioriza `campaignId` da própria linha quando presente (fonte com ID
 * confiável nessa granularidade, ex.: pipeline n8n + API oficial da Meta),
 * só cai pra ponte por nome (`resolveFunnelForCampaignName`, sempre um
 * fallback, nunca tratado como vínculo confiável) quando a linha não tem
 * `campaignId` — caso de toda fonte Stract hoje, que só entrega nome nessas
 * 3 granularidades. Nunca o contrário: uma linha com `campaignId` NUNCA cai
 * pro nome, mesmo que o nome resolvesse diferente — o ID é sempre a fonte de
 * verdade quando existe.
 */
export function resolveFunnelForRow(
  row: { campaignId: string | null; campaignName: string },
  funnelByCampaignId: Map<string, string>,
  funnelByCampaignName: Map<string, string | "ambiguous">,
): string | null {
  if (row.campaignId) return funnelByCampaignId.get(row.campaignId) ?? null;
  return resolveFunnelForCampaignName(funnelByCampaignName, row.campaignName);
}

export interface PendingCampaign {
  /** Chave de deduplicação só pra esta lista — campaignId quando confiável,
   * senão um valor derivado do nome. NUNCA usada pra classificar (isso exige
   * sempre um campaignId real). */
  key: string;
  campaignId: string | null;
  campaignName: string;
  /** `false` = campanha sem id confiável na origem; não pode ser classificada
   * por aqui (falta a identidade estável que a classificação exige) — ainda
   * assim aparece como pendente, nunca escondida. */
  hasReliableId: boolean;
  keySuggestion: KeySuggestion;
}

/**
 * Lista campanhas do período (linhas de `campaign_daily_metrics`, únicas com
 * id) que ainda não têm classificação confirmada — nunca classifica
 * silenciosamente, mesmo quando a chave sugere um funil com confiança.
 */
export function findPendingCampaigns(
  campaignRows: readonly { campaignId: string | null; campaignName: string }[],
  funnelByCampaignId: Map<string, string>,
  funnels: readonly ClientFunnel[],
): PendingCampaign[] {
  const seen = new Set<string>();
  const pending: PendingCampaign[] = [];

  for (const row of campaignRows) {
    if (row.campaignId && funnelByCampaignId.has(row.campaignId)) continue;
    const key = row.campaignId ?? `name:${row.campaignName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push({
      key,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      hasReliableId: row.campaignId !== null,
      keySuggestion: suggestFunnelForCampaignName(row.campaignName, funnels),
    });
  }

  return pending;
}

/**
 * Investimento total por funil (`null` = sem funil — pendente ou sem id
 * confiável) a partir das linhas de CAMPANHA do período — nunca soma spend de
 * ad_set/criativo/posicionamento junto (isso duplicaria investimento, cada
 * granularidade é o mesmo spend visto por um recorte diferente).
 */
export function aggregateSpendByFunnel(
  campaignRows: readonly { campaignId: string | null; spend: number }[],
  funnelByCampaignId: Map<string, string>,
): Map<string | null, number> {
  const totals = new Map<string | null, number>();
  for (const row of campaignRows) {
    const funnelId = row.campaignId ? funnelByCampaignId.get(row.campaignId) ?? null : null;
    totals.set(funnelId, (totals.get(funnelId) ?? 0) + row.spend);
  }
  return totals;
}

/** Funis ativos, na ordem de exibição (`sortOrder`, depois nome). */
export function sortFunnelsForDisplay(funnels: readonly ClientFunnel[]): ClientFunnel[] {
  return [...funnels].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt-BR"));
}
