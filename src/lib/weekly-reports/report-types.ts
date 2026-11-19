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
  /** Pedido do usuário: "consegue colocar o link do anúncio também? pra
   * dar pra ver qual é o melhor com CPA e melhor com CTR" — permalink do
   * anúncio (`CreativeSummary.permalinkUrl`, `lib/creative-analytics.ts`),
   * sempre "enriquecimento opcional" por definição daquele módulo: `null`
   * quando o criativo nunca teve um link registrado, nunca um link
   * fabricado/adivinhado. */
  permalinkUrl: string | null;
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
  /** Faturamento do objetivo (pedido do usuário: "no caso das vendas,
   * precisa colocar valor em vendas e ROAS") — `null` sem faturamento
   * registrado pro escopo (objetivo diferente de vendas, ou sem
   * `value_column` configurado), nunca `0` fabricado. Guardado pra
   * QUALQUER objetivo (não só vendas) — é o template (`report-template.ts`)
   * quem decide mostrar essa linha só quando `goal === "sales"`. */
  revenue: number | null;
  /** ROAS (receita ÷ investimento do objetivo) — `null` sem receita ou sem
   * investimento no escopo (`computeRoas`, `lib/performance.ts`). */
  roas: number | null;
  highlights: AdHighlights;
  /** Limiares usados pra elegibilidade dos destaques nesta geração —
   * guardado pra transparência/auditoria (pedido, seção 3: "informe os
   * valores na entrega"), nunca lido de volta pra decidir nada. */
  thresholds: { minResults: number; minImpressions: number };
  computedAt: string;
}
