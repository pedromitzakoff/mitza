"use client";

import { formatCurrency, formatPercent } from "@/lib/format";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { NO_CREATIVES_MESSAGE, CREATIVES_NOT_AVAILABLE_FOR_GOOGLE_MESSAGE } from "@/lib/analytics-messages";
import { EmptyState } from "@/components/workspace/empty-state";
import type { CreativeSummary } from "@/lib/creative-analytics";
import type { ChannelScope } from "@/lib/traffic-channels";
import { ReportTable, type ReportTableColumn } from "./report-table";

/**
 * `"use client"` obrigatório: `columns` carrega funções (`render`/
 * `sortValue`) que `ReportTable` (Client Component) recebe como prop —
 * Server Component não pode passar função pra Client Component (só dá pra
 * serializar dado, nunca closure), então este arquivo precisa estar do
 * mesmo lado da fronteira que `ReportTable`. `report-view.tsx` (Server
 * Component) só passa dado puro pra cá (`summaries`/`channelScope`).
 *
 * Etapa "Três níveis de análise": Criativos é o terceiro nível (Campanhas →
 * Públicos → Criativos, seção 1 do pedido) — mesma fonte/agregação de
 * sempre (`CreativeSummary`, `buildCreativeSummaries`,
 * lib/creative-analytics.ts, a mesma que já alimenta a sub-aba Criativos do
 * Analytics), TODOS os criativos continuam disponíveis.
 *
 * `ad_creative_daily_metrics` (a fonte) NÃO tem coluna de canal — é
 * implicitamente só Meta (`creative_name` = `ad_name` do Meta, ver
 * `lib/creative-analytics.ts:4-40`). Por isso, no escopo "google",
 * `report-data.ts` já devolve `creatives: []`; aqui distinguimos esse caso
 * (mensagem "Criativos do Google ainda não estão disponíveis", igual à do
 * Analytics) de um cliente Meta genuinamente sem nenhum criativo no
 * período (mensagem genérica) — nunca a mesma mensagem pras duas coisas.
 *
 * CTR/CPC só aparecem quando a fonte realmente suporta (`totalClicks`/
 * `totalImpressions` presentes em pelo menos um criativo) — nunca
 * inventados. Sem thumbnail nesta rodada (pedido explícito: "estruturar os
 * dados" primeiro).
 */
export function ReportCreativesList({ summaries, channelScope }: { summaries: CreativeSummary[]; channelScope: ChannelScope }) {
  if (channelScope === "google") {
    return <EmptyState title={CREATIVES_NOT_AVAILABLE_FOR_GOOGLE_MESSAGE} />;
  }

  const hasRevenue = summaries.some((s) => s.totalRevenue !== null);
  const hasRoas = summaries.some((s) => s.roas !== null);
  const hasCtr = summaries.some((s) => s.ctr !== null);
  const hasCpc = summaries.some((s) => s.cpc !== null);

  const resultTypes = new Set(summaries.map((s) => s.resultType).filter((t): t is PerformanceGoal => t !== null));
  const sharedGoalConfig = resultTypes.size === 1 ? PERFORMANCE_GOALS[[...resultTypes][0]] : null;
  const resultLabel = sharedGoalConfig?.resultMetricLabel ?? "Resultado";
  const costLabel = sharedGoalConfig?.costMetricShortLabel ?? "Custo por resultado";

  const columns: ReportTableColumn<CreativeSummary>[] = [
    {
      key: "name",
      header: "Criativo",
      defaultDirection: "asc",
      sortValue: (s) => s.creativeName,
      render: (s) => <span className="block max-w-[26rem] break-words font-medium">{s.creativeName}</span>,
    },
    {
      key: "investment",
      header: "Investimento",
      align: "right",
      nowrap: true,
      defaultDirection: "desc",
      sortValue: (s) => s.totalSpend,
      render: (s) => formatCurrency(s.totalSpend),
    },
    {
      key: "result",
      header: resultLabel,
      align: "right",
      nowrap: true,
      defaultDirection: "desc",
      sortValue: (s) => s.totalResultCount,
      render: (s) => (s.totalResultCount !== null ? s.totalResultCount : "—"),
    },
    {
      key: "cost",
      header: costLabel,
      align: "right",
      nowrap: true,
      defaultDirection: "asc",
      sortValue: (s) => s.cpa,
      render: (s) => (s.cpa !== null ? formatCurrency(s.cpa) : "—"),
    },
    ...(hasCtr
      ? [
          {
            key: "ctr",
            header: "CTR",
            align: "right" as const,
            nowrap: true,
            defaultDirection: "desc" as const,
            sortValue: (s: CreativeSummary) => s.ctr,
            render: (s: CreativeSummary) => (s.ctr !== null ? formatPercent(s.ctr * 100) : "—"),
          } satisfies ReportTableColumn<CreativeSummary>,
        ]
      : []),
    ...(hasCpc
      ? [
          {
            key: "cpc",
            header: "CPC",
            align: "right" as const,
            nowrap: true,
            defaultDirection: "asc" as const,
            sortValue: (s: CreativeSummary) => s.cpc,
            render: (s: CreativeSummary) => (s.cpc !== null ? formatCurrency(s.cpc) : "—"),
          } satisfies ReportTableColumn<CreativeSummary>,
        ]
      : []),
    ...(hasRevenue
      ? [
          {
            key: "revenue",
            header: "Faturamento",
            align: "right" as const,
            nowrap: true,
            defaultDirection: "desc" as const,
            sortValue: (s: CreativeSummary) => s.totalRevenue,
            render: (s: CreativeSummary) => (s.totalRevenue !== null ? formatCurrency(s.totalRevenue) : "—"),
          } satisfies ReportTableColumn<CreativeSummary>,
        ]
      : []),
    ...(hasRoas
      ? [
          {
            key: "roas",
            header: "ROAS",
            align: "right" as const,
            nowrap: true,
            defaultDirection: "desc" as const,
            sortValue: (s: CreativeSummary) => s.roas,
            render: (s: CreativeSummary) => (s.roas !== null ? `${s.roas.toFixed(2)}x` : "—"),
          } satisfies ReportTableColumn<CreativeSummary>,
        ]
      : []),
  ];

  return (
    <ReportTable
      rows={summaries}
      getRowKey={(s) => s.creativeName}
      columns={columns}
      defaultSortKey="investment"
      emptyMessage={NO_CREATIVES_MESSAGE}
      expandLabel={(total) => `Ver todos os ${total} criativos ↓`}
      collapseLabel="Recolher criativos ↑"
    />
  );
}
