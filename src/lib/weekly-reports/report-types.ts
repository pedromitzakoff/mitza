import type { WeeklyReportEventTypeDb, WeeklyReportPeriodKindDb, WeeklyReportStatusDb } from "@/lib/supabase/database.types";

export type WeeklyReportPeriodKind = WeeklyReportPeriodKindDb;
export type WeeklyReportStatus = WeeklyReportStatusDb;
export type WeeklyReportEventType = WeeklyReportEventTypeDb;

/** Um destaque de anúncio (pedido, seção 3: "nome do anúncio, formato
 * quando disponível, quantidade/CTR e custo/impressões"). `format` é
 * sempre `null` hoje — a plataforma não rastreia formato de criativo
 * (vídeo/carrossel/imagem) em nenhuma tabela ainda; o campo já existe aqui
 * pra ligar sozinho no dia em que essa coluna existir, sem exigir uma 2ª
 * mudança de schema. */
export interface AdHighlightEntry {
  adName: string;
  format: string | null;
}

export interface BestCostHighlight extends AdHighlightEntry {
  resultCount: number;
  cost: number;
}

export interface BestLinkCtrHighlight extends AdHighlightEntry {
  linkCtr: number;
  impressions: number;
}

/** `combined = true` quando o MESMO anúncio lidera os dois indicadores
 * (pedido, seção 3: "combine os destaques em uma linha") — os dois campos
 * continuam preenchidos (mesmo anúncio dos dois lados), só a apresentação
 * (template) decide juntar numa linha só. */
export interface AdHighlights {
  bestCost: BestCostHighlight | null;
  bestLinkCtr: BestLinkCtrHighlight | null;
  combined: boolean;
}

/** Snapshot serializável (jsonb `weekly_reports.metrics`) — tudo que o
 * template/card precisam pra renderizar sem recalcular nada. Sempre
 * recalculado a cada reprocessamento enquanto `status !== 'enviado'`. */
export interface WeeklyReportMetrics {
  investment: number;
  resultCount: number;
  /** `null` = indisponível (pedido: "zero resultados -> custo
   * indisponível", nunca `0`/`Infinity`). */
  costPerResult: number | null;
  highlights: AdHighlights;
  /** Limiares usados pra elegibilidade dos destaques nesta geração —
   * guardado pra transparência/auditoria (pedido, seção 3: "informe os
   * valores na entrega"), nunca lido de volta pra decidir nada. */
  thresholds: { minResults: number; minImpressions: number };
  computedAt: string;
}
