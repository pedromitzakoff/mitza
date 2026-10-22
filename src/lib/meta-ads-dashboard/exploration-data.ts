import { formatCurrency, formatCount, formatPercent } from "@/lib/format";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { CampaignSummary } from "@/lib/campaign-analytics";
import type { AdSetSummary } from "@/lib/ad-set-analytics";
import type { CreativeSummary } from "@/lib/creative-analytics";
import { resolveResultLabels } from "./metric-cards";

/**
 * MITZA ONE — KOFF Analytics Fase 2, Etapa 2.4 (Exploração de campanhas,
 * conjuntos e anúncios). Núcleo puro da tabela de exploração — normaliza os
 * três `Summary` já existentes (`CampaignSummary`/`AdSetSummary`/
 * `CreativeSummary`, `lib/campaign-analytics.ts`/`ad-set-analytics.ts`/
 * `creative-analytics.ts`) pra UMA forma comum (`ExplorationRow`), sempre
 * reaproveitando os totais/índices JÁ calculados por essas funções — nenhum
 * cálculo novo aqui, só adaptação de formato pra uma tabela genérica.
 *
 * Alcance NUNCA é uma coluna aqui — pedido explícito do usuário (item 8 da
 * Etapa 2.4: "não somar métricas não aditivas, especialmente alcance e
 * frequência"). Achado da auditoria desta etapa: `CampaignSummary.totalReach`/
 * `AdSetSummary.totalReach`/`CreativeSummary.totalReach` (consumidos hoje
 * pelo Relatório de Performance) já somam `reach` diário entre dias — uma
 * limitação PRÉ-EXISTENTE fora do escopo desta etapa (o Relatório continua
 * intocado), mas que esta tabela NOVA não deveria herdar: por isso nenhuma
 * das colunas abaixo exibe alcance. Frequência nunca existiu nesses
 * `Summary` (nenhum `totalFrequency`), então já nasce ausente.
 */

export interface ExplorationRow {
  id: string;
  name: string;
  spend: number;
  impressions: number | null;
  clicks: number | null;
  /** Cliques no link/CTA de destino — DISTINTO de `clicks`. */
  linkClicks: number | null;
  resultCount: number | null;
  revenue: number | null;
  cpa: number | null;
  cpc: number | null;
  linkCpc: number | null;
  ctr: number | null;
  linkCtr: number | null;
  cpm: number | null;
  roas: number | null;
  resultType: PerformanceGoal | null;
  /** Só criativos — `undefined` pra campanhas/conjuntos (nunca `null`
   * fabricado pra um nível que nem tem esse conceito). */
  previewImageUrl?: string | null;
  /** Campanhas onde este conjunto/anúncio aparece — vem de
   * `AdSetSummary.campaignNames`/`CreativeSummary.campaignNames` (já
   * calculado, nunca um cálculo novo). `undefined` pra campanhas (não se
   * aplica); exibido como legenda da linha só quando a tabela está em modo
   * "entrada direta" (sem campanha selecionada), pra deixar explícito a
   * qual campanha cada conjunto/anúncio pertence. */
  campaignNames?: string[];
}

export function campaignSummaryToRow(summary: CampaignSummary): ExplorationRow {
  return {
    id: summary.campaignName,
    name: summary.campaignName,
    spend: summary.totalSpend,
    impressions: summary.totalImpressions,
    clicks: summary.totalClicks,
    linkClicks: summary.totalLinkClicks,
    resultCount: summary.totalResultCount,
    revenue: summary.totalRevenue,
    cpa: summary.cpa,
    cpc: summary.cpc,
    linkCpc: summary.linkCpc,
    ctr: summary.ctr,
    linkCtr: summary.linkCtr,
    cpm: summary.cpm,
    roas: summary.roas,
    resultType: summary.resultType,
  };
}

export function adSetSummaryToRow(summary: AdSetSummary): ExplorationRow {
  return {
    id: summary.adSetName,
    name: summary.adSetName,
    spend: summary.totalSpend,
    impressions: summary.totalImpressions,
    clicks: summary.totalClicks,
    linkClicks: summary.totalLinkClicks,
    resultCount: summary.totalResultCount,
    revenue: summary.totalRevenue,
    cpa: summary.cpa,
    cpc: summary.cpc,
    linkCpc: summary.linkCpc,
    ctr: summary.ctr,
    linkCtr: summary.linkCtr,
    cpm: summary.cpm,
    roas: summary.roas,
    resultType: summary.resultType,
    campaignNames: summary.campaignNames,
  };
}

export function creativeSummaryToRow(summary: CreativeSummary): ExplorationRow {
  return {
    id: summary.creativeName,
    name: summary.creativeName,
    spend: summary.totalSpend,
    impressions: summary.totalImpressions,
    clicks: summary.totalClicks,
    linkClicks: summary.totalLinkClicks,
    resultCount: summary.totalResultCount,
    revenue: summary.totalRevenue,
    cpa: summary.cpa,
    cpc: summary.cpc,
    linkCpc: summary.linkCpc,
    ctr: summary.ctr,
    linkCtr: summary.linkCtr,
    cpm: summary.cpm,
    roas: summary.roas,
    resultType: summary.resultType,
    previewImageUrl: summary.previewImageUrl,
    campaignNames: summary.campaignNames,
  };
}

export type ExplorationColumnId =
  | "name"
  | "spend"
  | "impressions"
  | "clicks"
  | "linkClicks"
  | "ctr"
  | "linkCtr"
  | "cpc"
  | "linkCpc"
  | "cpm"
  | "resultCount"
  | "cpa"
  | "revenue"
  | "roas";

export interface ExplorationColumnDef {
  id: ExplorationColumnId;
  label: string;
  align: "left" | "right";
  defaultVisible: boolean;
}

/** Ordem canônica das colunas + seleção inicial — "Nome" nunca é
 * removível (identidade da linha, sempre presente e sempre fixa à
 * esquerda); resultado/custo usam o rótulo dinâmico do objetivo do
 * cliente, mesma fonte de `metric-cards.ts`/`evolution-data.ts`. */
export function buildExplorationColumns(resultType: PerformanceGoal | null): ExplorationColumnDef[] {
  const { resultLabel, costLabel } = resolveResultLabels(resultType);
  return [
    { id: "name", label: "Nome", align: "left", defaultVisible: true },
    { id: "spend", label: "Investimento", align: "right", defaultVisible: true },
    { id: "impressions", label: "Impressões", align: "right", defaultVisible: true },
    { id: "clicks", label: "Cliques totais", align: "right", defaultVisible: true },
    { id: "linkClicks", label: "Cliques no link", align: "right", defaultVisible: false },
    { id: "ctr", label: "CTR geral", align: "right", defaultVisible: false },
    { id: "linkCtr", label: "CTR do link", align: "right", defaultVisible: false },
    { id: "cpc", label: "CPC geral", align: "right", defaultVisible: false },
    { id: "linkCpc", label: "CPC do link", align: "right", defaultVisible: false },
    { id: "cpm", label: "CPM", align: "right", defaultVisible: false },
    { id: "resultCount", label: resultLabel, align: "right", defaultVisible: true },
    { id: "cpa", label: costLabel, align: "right", defaultVisible: true },
    { id: "revenue", label: "Receita", align: "right", defaultVisible: false },
    { id: "roas", label: "ROAS", align: "right", defaultVisible: false },
  ];
}

const NUMERIC_ACCESSOR: Record<Exclude<ExplorationColumnId, "name">, (row: ExplorationRow) => number | null> = {
  spend: (row) => row.spend,
  impressions: (row) => row.impressions,
  clicks: (row) => row.clicks,
  linkClicks: (row) => row.linkClicks,
  ctr: (row) => row.ctr,
  linkCtr: (row) => row.linkCtr,
  cpc: (row) => row.cpc,
  linkCpc: (row) => row.linkCpc,
  cpm: (row) => row.cpm,
  resultCount: (row) => row.resultCount,
  cpa: (row) => row.cpa,
  revenue: (row) => row.revenue,
  roas: (row) => row.roas,
};

/** Valor numérico de UMA coluna, pra ordenação — `null` vira `-1` (mesma
 * convenção já usada em `report-table-section.tsx`: "sem dado" ordena
 * sempre antes de qualquer valor real, nunca no meio). */
export function explorationSortValue(id: ExplorationColumnId, row: ExplorationRow): number {
  if (id === "name") return 0;
  return NUMERIC_ACCESSOR[id](row) ?? -1;
}

const PERCENT_COLUMNS = new Set<ExplorationColumnId>(["ctr", "linkCtr"]);
const CURRENCY_COLUMNS = new Set<ExplorationColumnId>(["spend", "cpc", "linkCpc", "cpm", "cpa", "revenue"]);
const COUNT_COLUMNS = new Set<ExplorationColumnId>(["impressions", "clicks", "linkClicks", "resultCount"]);

/** Texto formatado de UMA célula — moeda/percentual/contagem corretos por
 * coluna (pedido do usuário: "valores e unidades formatados corretamente"),
 * `"—"` quando o valor é `null` (nunca `0` fabricado). */
export function formatExplorationCell(id: ExplorationColumnId, row: ExplorationRow): string {
  if (id === "name") return row.name;
  if (id === "roas") return row.roas !== null ? `${row.roas.toFixed(2)}x` : "—";

  const value = NUMERIC_ACCESSOR[id](row);
  if (value === null) return "—";
  if (PERCENT_COLUMNS.has(id)) return formatPercent(value * 100);
  if (CURRENCY_COLUMNS.has(id)) return formatCurrency(value);
  if (COUNT_COLUMNS.has(id)) return formatCount(value);
  return String(value);
}
