import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import type { PerformanceGoal } from "@/lib/performance-goals";
import {
  type ClientFunnel,
  type CampaignFunnelAssignment,
  type FunnelIndicator,
  type KeySuggestion,
  buildFunnelByCampaignId,
  sanitizeFunnelIndicators,
  suggestFunnelForCampaignName,
  sortFunnelsForDisplay,
} from "@/lib/client-funnels";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/** Mesma janela de contexto de `REPORT_CLASSIFICATION_RECENT_WINDOW_DAYS`
 * (Etapa anterior) — spend de contexto no drawer de classificação, nunca
 * usado em nenhum cálculo real (o Relatório sempre usa seu próprio período
 * selecionado). */
export const FUNNEL_CLASSIFICATION_RECENT_WINDOW_DAYS = 30;

/**
 * Todos os funis do cliente (ativos e desativados — desativar nunca apaga,
 * ver `supabase/client-funnels.sql`), já no formato puro de
 * `lib/client-funnels.ts`, ordenados pra exibição.
 */
export async function fetchClientFunnels(supabase: Supabase, clientId: string): Promise<ClientFunnel[]> {
  const rows = await requireQuery(
    supabase
      .from("client_funnels")
      .select("id, client_id, name, naming_key, is_active, linked_result_type, relevant_indicators, sort_order")
      .eq("client_id", clientId),
    "client_funnels:list",
  );

  const funnels: ClientFunnel[] = rows.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    namingKey: row.naming_key,
    isActive: row.is_active,
    linkedResultType: (row.linked_result_type as PerformanceGoal | null) ?? null,
    relevantIndicators: sanitizeFunnelIndicators(row.relevant_indicators ?? []),
    sortOrder: row.sort_order,
  }));

  return sortFunnelsForDisplay(funnels);
}

/**
 * Classificações vigentes (`campaign_funnel_assignments`) do cliente, já no
 * formato puro. Escopo Meta-only (mesmo escopo do Relatório inteiro) — a
 * tabela suporta outros canais (auditoria/preparação futura), mas nunca
 * misturamos com o que o Relatório ainda não mostra.
 */
export async function fetchCampaignFunnelAssignments(supabase: Supabase, clientId: string): Promise<CampaignFunnelAssignment[]> {
  const rows = await requireQuery(
    supabase.from("campaign_funnel_assignments").select("campaign_id, funnel_id").eq("client_id", clientId).eq("channel", "meta"),
    "campaign_funnel_assignments:list",
  );
  return rows.map((row) => ({ campaignId: row.campaign_id, funnelId: row.funnel_id }));
}

/** Uma campanha real do cliente, pronta pro drawer "Classificar campanhas em
 * funis". `campaignId: null` = fonte sem `campaign_id_column` configurado —
 * a campanha aparece (nunca escondida), mas não pode ser classificada (select
 * desabilitado na UI, mesma disciplina de `CampaignForReportClassification`). */
export interface CampaignForFunnelClassification {
  campaignId: string | null;
  campaignName: string;
  recentSpend: number;
  currentFunnelId: string | null;
  keySuggestion: KeySuggestion;
}

/**
 * Campanhas reais do cliente nos últimos `FUNNEL_CLASSIFICATION_RECENT_WINDOW_DAYS`
 * dias (agrupadas de `campaign_daily_metrics`, Meta-only), já cruzadas com a
 * classificação atual e a sugestão por chave — nunca aplicada
 * automaticamente, só pra exibição/confirmação no drawer.
 */
export async function listCampaignsForFunnelClassification(
  supabase: Supabase,
  clientId: string,
  today: string,
): Promise<CampaignForFunnelClassification[]> {
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - FUNNEL_CLASSIFICATION_RECENT_WINDOW_DAYS);
  const sinceDate = since.toISOString().slice(0, 10);

  const [metricsRows, funnels, assignments] = await Promise.all([
    requireQuery(
      supabase
        .from("campaign_daily_metrics")
        .select("date, campaign_id, campaign_name, spend")
        .eq("client_id", clientId)
        .eq("channel", "meta")
        .gte("date", sinceDate)
        .order("date", { ascending: true }),
      "campaign_daily_metrics:funnel-classification",
    ),
    fetchClientFunnels(supabase, clientId),
    fetchCampaignFunnelAssignments(supabase, clientId),
  ]);

  const funnelByCampaignId = buildFunnelByCampaignId(assignments);

  const groups = new Map<string, CampaignForFunnelClassification>();
  for (const row of metricsRows) {
    const key = row.campaign_id ?? `name:${row.campaign_name}`;
    const existing = groups.get(key);
    if (existing) {
      existing.recentSpend += row.spend;
      existing.campaignName = row.campaign_name; // linhas ordenadas por data crescente — a última sobrescreve, nome final é sempre o mais recente.
    } else {
      groups.set(key, {
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        recentSpend: row.spend,
        currentFunnelId: row.campaign_id ? (funnelByCampaignId.get(row.campaign_id) ?? null) : null,
        keySuggestion: suggestFunnelForCampaignName(row.campaign_name, funnels),
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.recentSpend - a.recentSpend);
}

/**
 * Salva em lote as classificações do drawer — `funnelId: null` remove o
 * vínculo (delete, nunca um valor "sem funil" gravado — pendente é sempre
 * ausência de linha, ver `client-funnels.sql`). Campanha sem `campaignId` é
 * ignorada silenciosamente aqui (a UI nunca deveria enviar uma).
 */
export async function saveCampaignFunnelAssignments(
  supabase: Supabase,
  clientId: string,
  assignedBy: string,
  changes: { campaignId: string | null; funnelId: string | null }[],
): Promise<void> {
  const toUpsert = changes.filter((c): c is { campaignId: string; funnelId: string } => c.campaignId !== null && c.funnelId !== null);
  const toDelete = changes.filter((c) => c.campaignId !== null && c.funnelId === null);

  if (toUpsert.length > 0) {
    const { error } = await supabase.from("campaign_funnel_assignments").upsert(
      toUpsert.map((c) => ({
        client_id: clientId,
        channel: "meta" as const,
        campaign_id: c.campaignId,
        funnel_id: c.funnelId,
        assigned_by: assignedBy,
        confirmed_at: new Date().toISOString(),
      })),
      { onConflict: "client_id,channel,campaign_id" },
    );
    if (error) throw new Error(`Falha ao salvar classificação de campanhas em funis: ${error.message}`);
  }

  for (const c of toDelete) {
    const { error } = await supabase
      .from("campaign_funnel_assignments")
      .delete()
      .eq("client_id", clientId)
      .eq("channel", "meta")
      .eq("campaign_id", c.campaignId as string);
    if (error) throw new Error(`Falha ao remover classificação de campanha em funil: ${error.message}`);
  }
}

export interface ClientFunnelInput {
  name: string;
  namingKey: string;
  linkedResultType: PerformanceGoal | null;
  relevantIndicators: FunnelIndicator[];
}

/** Cria um funil novo — `sortOrder` é sempre o próximo (nunca reordena os
 * existentes na criação, evita saltos inesperados na exibição). */
export async function createClientFunnel(supabase: Supabase, clientId: string, input: ClientFunnelInput): Promise<void> {
  const { data: existing, error: existingError } = await supabase.from("client_funnels").select("sort_order").eq("client_id", clientId);
  if (existingError) throw new Error(`Falha ao preparar criação de funil: ${existingError.message}`);
  const nextSortOrder = (existing ?? []).reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;

  const { error } = await supabase.from("client_funnels").insert({
    client_id: clientId,
    name: input.name,
    naming_key: input.namingKey,
    linked_result_type: input.linkedResultType,
    relevant_indicators: input.relevantIndicators,
    sort_order: nextSortOrder,
  });
  if (error) throw new Error(`Falha ao criar funil — verifique se a chave de nomenclatura já não está em uso: ${error.message}`);
}

export async function updateClientFunnel(supabase: Supabase, clientId: string, funnelId: string, input: ClientFunnelInput): Promise<void> {
  const { error } = await supabase
    .from("client_funnels")
    .update({
      name: input.name,
      naming_key: input.namingKey,
      linked_result_type: input.linkedResultType,
      relevant_indicators: input.relevantIndicators,
    })
    .eq("id", funnelId)
    .eq("client_id", clientId);
  if (error) throw new Error(`Falha ao atualizar funil — verifique se a chave de nomenclatura já não está em uso: ${error.message}`);
}

/** Desativa (nunca deleta) — campanhas já classificadas neste funil
 * continuam classificadas (o vínculo é por `funnel_id`, nunca reavaliado pela
 * chave); o funil só some das sugestões pra campanhas novas e do formulário
 * de "novo funil" da Visão por Funil. */
export async function setClientFunnelActive(supabase: Supabase, clientId: string, funnelId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from("client_funnels").update({ is_active: isActive }).eq("id", funnelId).eq("client_id", clientId);
  if (error) throw new Error(`Falha ao ${isActive ? "reativar" : "desativar"} funil: ${error.message}`);
}
