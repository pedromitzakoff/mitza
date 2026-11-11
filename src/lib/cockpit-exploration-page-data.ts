import { notFound } from "next/navigation";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { monthRangeFromParam, shiftMonthParam } from "@/lib/sprint-financials";
import { todayUTC } from "@/lib/today";
import { resolveClientMediaChannels } from "@/lib/traffic-channels";
import { resolveMetaAdAccountId } from "@/lib/meta-ads-dashboard/dashboard-data";
import { scheduleCreativePreviewRefreshIfStale } from "@/lib/creative-preview-refresh";
import { buildPerformanceReportData } from "@/lib/performance-report/report-data";
import { campaignSummaryToRow, type ExplorationRow } from "@/lib/meta-ads-dashboard/exploration-data";
import type { AdSetDailyMetricRow } from "@/lib/ad-set-analytics";
import type { AdCreativeDailyMetricRow } from "@/lib/creative-analytics";
import type { PerformanceGoal } from "@/lib/performance-goals";
import {
  resolveCockpitFilterState,
  filterCampaignSummaries,
  filterAdSetDailyRows,
  filterCreativeDailyRows,
  type CockpitFilterState,
} from "@/lib/cockpit-global-filter";

/**
 * KOFF Analytics — "Adaptar o sistema" (pedido explícito do usuário, menu
 * lateral Dashboard/Campanhas/Anúncios/Metas/Contas): Campanhas e Anúncios
 * viram PÁGINAS PRÓPRIAS (`/clients/[id]/campanhas`, `/clients/[id]/anuncios`)
 * em vez de abas dentro da área "Exploração" do Cockpit — esta função é a
 * camada de dados COMPARTILHADA pelas duas (e só o necessário pra elas:
 * campanhas/conjuntos/anúncios + o filtro global, nunca a pilha inteira de
 * Metas/Orçamento/Diagnóstico que o Cockpit principal carrega). Reaproveita
 * INTEGRALMENTE `buildPerformanceReportData` (mesma Camada 1 oficial do
 * Relatório, já usada pelo Cockpit) — nenhuma segunda consulta/agregação de
 * campanha/conjunto/criativo.
 */
export interface CockpitExplorationPageData {
  clientId: string;
  clientName: string;
  monthParam: string;
  prevMonthHref: string;
  nextMonthHref: string;
  hasMetaChannel: boolean;
  resultType: PerformanceGoal | null;
  campaigns: ExplorationRow[];
  adSetDailyRows: AdSetDailyMetricRow[];
  creativeDailyRows: AdCreativeDailyMetricRow[];
  cockpitFilter: CockpitFilterState;
}

export async function loadCockpitExplorationPageData(
  clientId: string,
  /** Sufixo da própria rota (`/campanhas` ou `/anuncios`) — os links de
   * mês ficam NA MESMA página (nunca redirecionam pro Dashboard), mesma
   * convenção de `buildWorkspaceHref`. */
  pageSuffix: string,
  searchParams: { month?: string; filtro?: string; modo?: string },
): Promise<CockpitExplorationPageData> {
  const supabase = await createSupabaseClient();

  const { data: client, error } = await supabase
    .from("clients")
    .select("id, name, media_channels")
    .eq("id", clientId)
    .is("deleted_at", null)
    .single();

  if (error) console.error(`[loadCockpitExplorationPageData] falha ao buscar cliente ${clientId}:`, error);
  if (!client) notFound();

  const today = todayUTC();
  const { firstDay, lastDay } = monthRangeFromParam(searchParams.month, today);
  const monthParam = firstDay.slice(0, 7);

  function buildMonthHref(month: string): string {
    return `/clients/${clientId}${pageSuffix}?month=${month}`;
  }
  const prevMonthHref = buildMonthHref(shiftMonthParam({ firstDay }, -1));
  const nextMonthHref = buildMonthHref(shiftMonthParam({ firstDay }, 1));

  const hasMetaChannel = resolveClientMediaChannels(client.media_channels).includes("meta");
  const cockpitFilter = resolveCockpitFilterState(searchParams.filtro, searchParams.modo);

  if (!hasMetaChannel) {
    return {
      clientId: client.id,
      clientName: client.name,
      monthParam,
      prevMonthHref,
      nextMonthHref,
      hasMetaChannel: false,
      resultType: null,
      campaigns: [],
      adSetDailyRows: [],
      creativeDailyRows: [],
      cockpitFilter,
    };
  }

  const [metaAdAccountId, performanceReportData] = await Promise.all([
    resolveMetaAdAccountId(supabase, clientId),
    buildPerformanceReportData(supabase, clientId, { start: firstDay, end: lastDay }),
  ]);
  // Preview de criativos ("pode fazer já", pedido do usuário) — nunca
  // bloqueia a página: `after()` dentro desta função agenda a busca de
  // verdade pra DEPOIS da resposta já ter sido enviada.
  void scheduleCreativePreviewRefreshIfStale(supabase, clientId, metaAdAccountId);

  const filteredCampaigns = filterCampaignSummaries(performanceReportData.campaigns, cockpitFilter);
  const filteredAdSetDailyRows = filterAdSetDailyRows(performanceReportData.adSetDailyRows, cockpitFilter);
  const filteredCreativeDailyRows = filterCreativeDailyRows(performanceReportData.creativeDailyRows, cockpitFilter);

  return {
    clientId: client.id,
    clientName: client.name,
    monthParam,
    prevMonthHref,
    nextMonthHref,
    hasMetaChannel: true,
    resultType: performanceReportData.performanceGoal,
    campaigns: filteredCampaigns.map(campaignSummaryToRow),
    adSetDailyRows: filteredAdSetDailyRows,
    creativeDailyRows: filteredCreativeDailyRows,
    cockpitFilter,
  };
}
