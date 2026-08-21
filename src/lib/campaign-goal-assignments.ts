import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import type { CampaignAssignmentRow, CampaignSpendRow } from "@/lib/goal-spend";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/** Janela "recente" pro drawer de classificação (spend de contexto, nunca
 * usada em nenhum cálculo de custo — isso é sempre o período real que quem
 * chama `computeGoalSpend`/`computeAssignmentCoverage` escolher). Fixa em
 * 30 dias: suficiente pra mostrar se uma campanha está ativa, sem virar uma
 * tela de Analytics (auditoria seção 20: "o objetivo é classificação"). */
export const CAMPAIGN_ASSIGNMENT_RECENT_WINDOW_DAYS = 30;

/** Uma campanha real do cliente, pronta pro drawer "Classificar campanhas".
 * `campaignId: null` = fonte sem `campaign_id_column` configurado — a
 * campanha aparece (nunca escondida), mas não pode ser classificada (select
 * desabilitado na UI, nunca um id fabricado a partir do nome). */
export interface CampaignForAssignment {
  channel: TrafficChannel;
  campaignId: string | null;
  campaignName: string;
  recentSpend: number;
  currentResultType: PerformanceGoal | null;
}

function assignmentGroupKey(channel: TrafficChannel, campaignId: string | null, campaignName: string): string {
  // Sem campaignId (fonte não configurada), agrupa por nome só pra exibição
  // nesta janela — nunca usado como identidade de vínculo (essa exige
  // campaignId, ver client-goals.sql).
  return `${channel}:${campaignId ?? `name:${campaignName}`}`;
}

/**
 * Campanhas reais do cliente nos últimos `CAMPAIGN_ASSIGNMENT_RECENT_WINDOW_DAYS`
 * dias, uma linha por campanha (agrupada de `campaign_daily_metrics`),
 * já cruzada com a classificação atual (`client_campaign_goal_assignments`).
 * Nome mostrado é sempre o mais recente (campanha renomeada não perde
 * histórico — só passa a mostrar o nome novo, auditoria seção 24).
 */
export async function listCampaignsForAssignment(supabase: Supabase, clientId: string, today: string): Promise<CampaignForAssignment[]> {
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - CAMPAIGN_ASSIGNMENT_RECENT_WINDOW_DAYS);
  const sinceDate = since.toISOString().slice(0, 10);

  const [metricsRows, assignmentRows] = await Promise.all([
    requireQuery(
      supabase
        .from("campaign_daily_metrics")
        .select("date, channel, campaign_id, campaign_name, spend")
        .eq("client_id", clientId)
        .gte("date", sinceDate)
        .order("date", { ascending: true }),
      "campaign_daily_metrics:assignment",
    ),
    requireQuery(
      supabase.from("client_campaign_goal_assignments").select("channel, campaign_id, result_type").eq("client_id", clientId),
      "client_campaign_goal_assignments:list",
    ),
  ]);

  // Chave de assignment é só (channel, campaignId) — nunca inclui o nome
  // (identidade é sempre campaignId).
  const currentByKey = new Map(assignmentRows.map((row) => [`${row.channel}:${row.campaign_id}`, row.result_type as PerformanceGoal]));
  const currentResultTypeFor = (channel: TrafficChannel, campaignId: string | null): PerformanceGoal | null =>
    campaignId ? (currentByKey.get(`${channel}:${campaignId}`) ?? null) : null;

  const groups = new Map<string, CampaignForAssignment>();
  for (const row of metricsRows) {
    const channel = row.channel as TrafficChannel;
    const campaignId = row.campaign_id;
    const key = assignmentGroupKey(channel, campaignId, row.campaign_name);
    const existing = groups.get(key);
    if (existing) {
      existing.recentSpend += row.spend;
      existing.campaignName = row.campaign_name; // linhas vêm ordenadas por data crescente — a última sobrescreve, então o nome final é sempre o mais recente.
    } else {
      groups.set(key, {
        channel,
        campaignId,
        campaignName: row.campaign_name,
        recentSpend: row.spend,
        currentResultType: currentResultTypeFor(channel, campaignId),
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.recentSpend - a.recentSpend);
}

/**
 * Salva em lote as classificações do drawer — nunca fecha/perde seleção em
 * caso de erro (isso é responsabilidade de quem chama, na Server Action).
 * `assignments` com `resultType: null` remove o vínculo (delete, nunca um
 * valor "sem objetivo" gravado — auditoria seção 5). Campanha sem
 * `campaignId` é ignorada silenciosamente aqui (a UI nunca deveria enviar
 * uma, mas isso protege contra um payload malformado sem quebrar o resto do
 * lote).
 */
export async function saveCampaignGoalAssignments(
  supabase: Supabase,
  clientId: string,
  assignedBy: string,
  changes: { channel: TrafficChannel; campaignId: string | null; resultType: PerformanceGoal | null }[],
): Promise<void> {
  const toUpsert = changes.filter((c): c is { channel: TrafficChannel; campaignId: string; resultType: PerformanceGoal } => c.campaignId !== null && c.resultType !== null);
  const toDelete = changes.filter((c) => c.campaignId !== null && c.resultType === null);

  if (toUpsert.length > 0) {
    const { error } = await supabase.from("client_campaign_goal_assignments").upsert(
      toUpsert.map((c) => ({
        client_id: clientId,
        channel: c.channel,
        campaign_id: c.campaignId,
        result_type: c.resultType,
        assigned_by: assignedBy,
      })),
      { onConflict: "client_id,channel,campaign_id" },
    );
    if (error) throw new Error(`Falha ao salvar classificação de campanhas: ${error.message}`);
  }

  for (const c of toDelete) {
    const { error } = await supabase
      .from("client_campaign_goal_assignments")
      .delete()
      .eq("client_id", clientId)
      .eq("channel", c.channel)
      .eq("campaign_id", c.campaignId as string);
    if (error) throw new Error(`Falha ao remover classificação de campanha: ${error.message}`);
  }
}

/** `campaign_daily_metrics` já resolvido pro formato puro de `lib/goal-spend.ts`
 * (`CampaignSpendRow`), pronto pra `computeGoalSpend`/`computeAssignmentCoverage`.
 * Um canal sem restrição (`channels.length === 0` em `ClientGoal`) deve
 * passar `channels: null` aqui pra nunca filtrar. */
export async function fetchCampaignSpendForCoverage(
  supabase: Supabase,
  clientId: string,
  period: { start: string; end: string },
  channels: TrafficChannel[] | null,
): Promise<CampaignSpendRow[]> {
  let query = supabase
    .from("campaign_daily_metrics")
    .select("channel, campaign_id, spend")
    .eq("client_id", clientId)
    .gte("date", period.start)
    .lte("date", period.end);

  if (channels && channels.length > 0) {
    query = query.in("channel", channels);
  }

  const rows = await requireQuery(query, "campaign_daily_metrics:coverage");
  return rows.map((row) => ({ channel: row.channel as TrafficChannel, campaignId: row.campaign_id, spend: row.spend }));
}

export async function fetchCampaignAssignments(supabase: Supabase, clientId: string): Promise<CampaignAssignmentRow[]> {
  const rows = await requireQuery(
    supabase.from("client_campaign_goal_assignments").select("channel, campaign_id, result_type").eq("client_id", clientId),
    "client_campaign_goal_assignments:coverage",
  );
  return rows.map((row) => ({ channel: row.channel as TrafficChannel, campaignId: row.campaign_id, resultType: row.result_type as PerformanceGoal }));
}
