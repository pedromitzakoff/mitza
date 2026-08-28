import { formatCurrency } from "@/lib/format";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { TRAFFIC_CHANNELS, type ChannelScope } from "@/lib/traffic-channels";
import { NO_CAMPAIGNS_MESSAGE } from "@/lib/analytics-messages";
import type { CampaignSummary } from "@/lib/campaign-analytics";
import { ReportTable, type ReportTableColumn } from "./report-table";

/**
 * Etapa "Três níveis de análise": Campanhas é o primeiro nível — mesma
 * fonte/agregação de sempre (`CampaignSummary`, `buildCampaignSummaries`,
 * lib/campaign-analytics.ts), TODAS as campanhas continuam disponíveis
 * (ordenação/expansão são só apresentação, ver `ReportTable`).
 *
 * Canal só vira coluna própria quando o escopo é "consolidated" — o único
 * caso em que Meta e Google de fato coexistem nesta tabela (ver
 * `report-data.ts`: um canal específico já filtra a fonte pro canal
 * selecionado antes de chegar aqui) — repetir "META" em toda linha quando
 * a página inteira já está no escopo Meta seria redundância pura.
 *
 * Rótulo de resultado/custo vem de `PERFORMANCE_GOALS` (nunca "Leads"/"CPL"
 * hardcoded) — como é UMA coluna compartilhada por todas as linhas, usa o
 * objetivo comum quando todas as campanhas do período o compartilham (o
 * caso normal); no raro caso de objetivos MISTOS entre campanhas (múltiplos
 * objetivos configurados, `client_goals`), cai pro rótulo genérico
 * "Resultado"/"Custo por resultado" — nunca rotula errado uma campanha
 * classificada num objetivo diferente. O número de cada linha continua
 * sempre o da campanha (nunca some, só o texto do cabeçalho generaliza).
 */
export function ReportCampaignsList({ summaries, channelScope }: { summaries: CampaignSummary[]; channelScope: ChannelScope }) {
  const showChannelColumn = channelScope === "consolidated";
  const hasRevenue = summaries.some((s) => s.totalRevenue !== null);
  const hasRoas = summaries.some((s) => s.roas !== null);

  const resultTypes = new Set(summaries.map((s) => s.resultType).filter((t): t is PerformanceGoal => t !== null));
  const sharedGoalConfig = resultTypes.size === 1 ? PERFORMANCE_GOALS[[...resultTypes][0]] : null;
  const resultLabel = sharedGoalConfig?.resultMetricLabel ?? "Resultado";
  const costLabel = sharedGoalConfig?.costMetricShortLabel ?? "Custo por resultado";

  const columns: ReportTableColumn<CampaignSummary>[] = [
    {
      key: "name",
      header: "Campanha",
      defaultDirection: "asc",
      sortValue: (s) => s.campaignName,
      render: (s) => (
        // `break-words`, nunca `truncate` — nome de campanha longo precisa
        // continuar legível (e sobreviver a um futuro PDF), não sumir
        // atrás de reticências.
        <span className="block max-w-[26rem] break-words font-medium">{s.campaignName}</span>
      ),
    },
    ...(showChannelColumn
      ? [
          {
            key: "channel",
            header: "Canal",
            nowrap: true,
            render: (s: CampaignSummary) => <span className="text-overview-text-muted">{TRAFFIC_CHANNELS[s.channel].shortLabel}</span>,
          } satisfies ReportTableColumn<CampaignSummary>,
        ]
      : []),
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
    ...(hasRevenue
      ? [
          {
            key: "revenue",
            header: "Faturamento",
            align: "right" as const,
            nowrap: true,
            defaultDirection: "desc" as const,
            sortValue: (s: CampaignSummary) => s.totalRevenue,
            render: (s: CampaignSummary) => (s.totalRevenue !== null ? formatCurrency(s.totalRevenue) : "—"),
          } satisfies ReportTableColumn<CampaignSummary>,
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
            sortValue: (s: CampaignSummary) => s.roas,
            render: (s: CampaignSummary) => (s.roas !== null ? `${s.roas.toFixed(2)}x` : "—"),
          } satisfies ReportTableColumn<CampaignSummary>,
        ]
      : []),
  ];

  return (
    <ReportTable
      rows={summaries}
      getRowKey={(s) => `${s.channel}-${s.campaignName}`}
      columns={columns}
      defaultSortKey="investment"
      emptyMessage={NO_CAMPAIGNS_MESSAGE}
      expandLabel={(total) => `Ver todas as ${total} campanhas ↓`}
      collapseLabel="Recolher campanhas ↑"
    />
  );
}
