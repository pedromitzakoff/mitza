import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import type { ReportCampaignPurpose, CampaignReportClassification } from "@/lib/report-view-classification";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/** Mesma janela de `CAMPAIGN_ASSIGNMENT_RECENT_WINDOW_DAYS`
 * (`lib/campaign-goal-assignments.ts`) — spend de contexto no drawer, nunca
 * usado em nenhum cálculo real (isso é sempre o período do Relatório que
 * está sendo visto). */
export const REPORT_CLASSIFICATION_RECENT_WINDOW_DAYS = 30;

/** Uma campanha real do cliente, pronta pro drawer "Classificar campanhas
 * do Relatório". `campaignId: null` = fonte sem `campaign_id_column`
 * configurado — a campanha aparece (nunca escondida), mas não pode ser
 * classificada (select desabilitado na UI). Escopo Meta-only, mesmo escopo
 * do Relatório inteiro. */
export interface CampaignForReportClassification {
  campaignId: string | null;
  campaignName: string;
  recentSpend: number;
  currentPurpose: ReportCampaignPurpose | null;
}

/**
 * Classificações vigentes de um cliente, já no formato puro de
 * `lib/report-view-classification.ts`. Escopo Meta-only (mesmo escopo do
 * Relatório) — filtra `channel = 'meta'` mesmo que a tabela suporte outros
 * canais, pra nunca misturar finalidade de campanhas de canais que o
 * Relatório ainda nem mostra.
 */
export async function fetchReportCampaignClassifications(supabase: Supabase, clientId: string): Promise<CampaignReportClassification[]> {
  const rows = await requireQuery(
    supabase.from("campaign_report_classifications").select("campaign_id, purpose").eq("client_id", clientId).eq("channel", "meta"),
    "campaign_report_classifications:report",
  );
  return rows.map((row) => ({ campaignId: row.campaign_id, purpose: row.purpose as ReportCampaignPurpose }));
}

/**
 * Campanhas reais do cliente nos últimos `REPORT_CLASSIFICATION_RECENT_WINDOW_DAYS`
 * dias (agrupadas de `campaign_daily_metrics`, Meta-only), já cruzadas com a
 * classificação atual. Nome mostrado é sempre o mais recente (mesma
 * convenção de `listCampaignsForAssignment`).
 */
export async function listCampaignsForReportClassification(supabase: Supabase, clientId: string, today: string): Promise<CampaignForReportClassification[]> {
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - REPORT_CLASSIFICATION_RECENT_WINDOW_DAYS);
  const sinceDate = since.toISOString().slice(0, 10);

  const [metricsRows, classifications] = await Promise.all([
    requireQuery(
      supabase
        .from("campaign_daily_metrics")
        .select("date, campaign_id, campaign_name, spend")
        .eq("client_id", clientId)
        .eq("channel", "meta")
        .gte("date", sinceDate)
        .order("date", { ascending: true }),
      "campaign_daily_metrics:report-classification",
    ),
    fetchReportCampaignClassifications(supabase, clientId),
  ]);

  const purposeById = new Map(classifications.map((c) => [c.campaignId, c.purpose]));

  const groups = new Map<string, CampaignForReportClassification>();
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
        currentPurpose: row.campaign_id ? (purposeById.get(row.campaign_id) ?? null) : null,
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.recentSpend - a.recentSpend);
}

/**
 * Salva em lote as classificações do drawer — `purpose: null` remove o
 * vínculo (delete, nunca um valor "sem finalidade" gravado, mesma
 * disciplina de `saveCampaignGoalAssignments`). Campanha sem `campaignId` é
 * ignorada silenciosamente aqui (a UI nunca deveria enviar uma).
 */
export async function saveReportCampaignClassifications(
  supabase: Supabase,
  clientId: string,
  assignedBy: string,
  changes: { campaignId: string | null; purpose: ReportCampaignPurpose | null }[],
): Promise<void> {
  const toUpsert = changes.filter((c): c is { campaignId: string; purpose: ReportCampaignPurpose } => c.campaignId !== null && c.purpose !== null);
  const toDelete = changes.filter((c) => c.campaignId !== null && c.purpose === null);

  if (toUpsert.length > 0) {
    const { error } = await supabase.from("campaign_report_classifications").upsert(
      toUpsert.map((c) => ({
        client_id: clientId,
        channel: "meta" as const,
        campaign_id: c.campaignId,
        purpose: c.purpose,
        assigned_by: assignedBy,
      })),
      { onConflict: "client_id,channel,campaign_id" },
    );
    if (error) throw new Error(`Falha ao salvar classificação de campanhas do Relatório: ${error.message}`);
  }

  for (const c of toDelete) {
    const { error } = await supabase
      .from("campaign_report_classifications")
      .delete()
      .eq("client_id", clientId)
      .eq("channel", "meta")
      .eq("campaign_id", c.campaignId as string);
    if (error) throw new Error(`Falha ao remover classificação de campanha do Relatório: ${error.message}`);
  }
}
