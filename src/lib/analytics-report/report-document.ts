import { formatDateTimeWithYear } from "@/lib/format";
import type { AnalyticsKpiCard, AnalyticsTrend } from "@/lib/analytics";
import type { PeriodHighlight } from "@/lib/period-highlights";
import type { CreativeSummary } from "@/lib/creative-analytics";
import type { CampaignSummary } from "@/lib/campaign-analytics";
import {
  CREATIVES_NOT_AVAILABLE_FOR_GOOGLE_MESSAGE,
  FUTURE_INSIGHT_CATEGORIES,
  GOOGLE_NOT_CONNECTED_MESSAGE,
  INSIGHTS_EMPTY_MESSAGE,
  NO_ANALYTICS_DATA_MESSAGE,
  NO_CAMPAIGNS_MESSAGE,
  NO_CREATIVES_MESSAGE,
  NO_HIGHLIGHTS_MESSAGE,
  NO_LEARNINGS_MESSAGE,
  NO_PERFORMANCE_GOAL_MESSAGE,
  OPPORTUNITIES_EMPTY_MESSAGE,
} from "@/lib/analytics-messages";
import type { AnalyticsReportData } from "./report-data";

/**
 * Camada 2 do AnalyticsReport — ESTRUTURA (páginas + blocos), separada do
 * dado bruto (`AnalyticsReportData`). Cada bloco só conhece o próprio tipo
 * de conteúdo, nunca um conceito de negócio — o Renderer (Camada 4) desenha
 * por `block.type`, nunca sabendo o que é "criativo" ou "campanha".
 *
 * Fase 1-2: reprodução fiel do hub de Analytics — as MESMAS 4 sub-seções
 * (`Resumo`/`Criativos`/`Campanhas`/`Insights`, ver `page.tsx`), mesma
 * ordem, mesmos textos vazios (`lib/analytics-messages.ts`). "Insights"
 * entra aqui mesmo sabendo da sobreposição de propósito já sinalizada com
 * "Oportunidades" (ambos ainda são só reserva de espaço) — o pedido do
 * usuário foi "exatamente o mesmo conteúdo do Analytics", e a aba existe
 * hoje na tela.
 */
export type AnalyticsReportBlock =
  | { type: "cover"; clientName: string; periodLabel: string; generatedAtLabel: string }
  | { type: "empty-state"; message: string }
  | { type: "hero"; headline: string; lede: string }
  | { type: "kpi-grid"; cards: AnalyticsKpiCard[] }
  | { type: "trend-chart"; trend: AnalyticsTrend; caption: string | null }
  | { type: "highlight-cards"; highlights: PeriodHighlight[] }
  | { type: "narrative"; title: string; sentences: string[] }
  | { type: "bullet-list"; title: string; items: string[] }
  | { type: "creative-cards"; creatives: CreativeSummary[] }
  | { type: "campaign-cards"; campaigns: CampaignSummary[] };

export interface AnalyticsReportPage {
  id: "cover" | "summary" | "creatives" | "campaigns" | "insights";
  title: string;
  blocks: AnalyticsReportBlock[];
}

export interface AnalyticsReportDocument {
  pages: AnalyticsReportPage[];
}

/** Blocos do Capítulo I ("Como foi o resultado?") + II ("O que mais chamou
 * atenção?") + III ("O que aprendemos?") + IV ("Quais oportunidades
 * existem?") — mesmos estados de `AnalyticsSection` (sem objetivo / sem
 * dado / com dado), mais o 4º estado da Integração Google Ads
 * (`"platform_not_connected"`, ver `report-data.ts`). */
function buildSummaryBlocks(data: AnalyticsReportData): AnalyticsReportBlock[] {
  if (data.summary.status === "no_goal") return [{ type: "empty-state", message: NO_PERFORMANCE_GOAL_MESSAGE }];
  if (data.summary.status === "no_data") return [{ type: "empty-state", message: NO_ANALYTICS_DATA_MESSAGE }];
  if (data.summary.status === "platform_not_connected") return [{ type: "empty-state", message: GOOGLE_NOT_CONNECTED_MESSAGE }];

  const { headline, lede, kpis, trend, trendCaption, highlights, learnings } = data.summary;

  const blocks: AnalyticsReportBlock[] = [
    { type: "hero", headline, lede },
    { type: "kpi-grid", cards: kpis },
  ];
  if (trend) blocks.push({ type: "trend-chart", trend, caption: trendCaption });
  blocks.push(highlights.length > 0 ? { type: "highlight-cards", highlights } : { type: "empty-state", message: NO_HIGHLIGHTS_MESSAGE });
  blocks.push(
    learnings.length > 0 ? { type: "narrative", title: "O que aprendemos", sentences: learnings } : { type: "empty-state", message: NO_LEARNINGS_MESSAGE },
  );
  // "Oportunidades" é reserva de espaço permanente (ver
  // `analytics-opportunities.tsx`) — mensagem vazia E lista de categorias
  // futuras aparecem sempre JUNTAS, nunca uma alternativa da outra (não é
  // dado que pode estar vazio ou cheio, é um placeholder honesto).
  blocks.push({ type: "empty-state", message: OPPORTUNITIES_EMPTY_MESSAGE });
  blocks.push({ type: "bullet-list", title: "Oportunidades em desenvolvimento", items: data.opportunities });

  return blocks;
}

export function buildAnalyticsReportDocument(data: AnalyticsReportData): AnalyticsReportDocument {
  const cover: AnalyticsReportBlock = {
    type: "cover",
    clientName: data.client.name,
    periodLabel: data.period.label,
    generatedAtLabel: formatDateTimeWithYear(data.generatedAt),
  };

  // Integração Google Ads: Criativos continua exclusivamente Meta — mesma
  // mensagem do hub quando a plataforma selecionada é Google, independente
  // de conexão (nunca "nenhum dado encontrado", que sugeriria que criativos
  // Google poderiam existir). Campanhas usa o mesmo "não conectado" do
  // Resumo quando aplicável, nunca a mensagem genérica de período vazio.
  const creativesBlock: AnalyticsReportBlock =
    data.platform === "google"
      ? { type: "empty-state", message: CREATIVES_NOT_AVAILABLE_FOR_GOOGLE_MESSAGE }
      : data.creatives.length > 0
        ? { type: "creative-cards", creatives: data.creatives }
        : { type: "empty-state", message: NO_CREATIVES_MESSAGE };
  const campaignsBlock: AnalyticsReportBlock =
    data.summary.status === "platform_not_connected"
      ? { type: "empty-state", message: GOOGLE_NOT_CONNECTED_MESSAGE }
      : data.campaigns.length > 0
        ? { type: "campaign-cards", campaigns: data.campaigns }
        : { type: "empty-state", message: NO_CAMPAIGNS_MESSAGE };

  return {
    pages: [
      { id: "cover", title: "Capa", blocks: [cover] },
      { id: "summary", title: "Resumo Executivo", blocks: buildSummaryBlocks(data) },
      { id: "creatives", title: "Criativos", blocks: [creativesBlock] },
      { id: "campaigns", title: "Campanhas", blocks: [campaignsBlock] },
      {
        id: "insights",
        title: "Insights",
        blocks: [{ type: "empty-state", message: INSIGHTS_EMPTY_MESSAGE }, { type: "bullet-list", title: "Em desenvolvimento", items: [...FUTURE_INSIGHT_CATEGORIES] }],
      },
    ],
  };
}
