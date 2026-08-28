import { formatCurrency } from "@/lib/format";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { TRAFFIC_CHANNELS, type ChannelScope } from "@/lib/traffic-channels";
import { EmptyState } from "@/components/workspace/empty-state";
import { NO_CAMPAIGNS_MESSAGE } from "@/lib/analytics-messages";
import type { CampaignSummary } from "@/lib/campaign-analytics";

/**
 * Etapa "Densidade editorial das Campanhas": TODAS as campanhas do período
 * aparecem sempre (nunca top N/paginação/"ver mais") — mesma fonte/
 * agregação de sempre (`CampaignSummary`, `buildCampaignSummaries`,
 * lib/campaign-analytics.ts, já ordenada por investimento decrescente), só
 * a apresentação muda: de um bloco por campanha (Etapa anterior) pra uma
 * linha de tabela por campanha — a economia vem da densidade, nunca da
 * remoção de informação. `campaign-card.tsx`/`analytics-campaigns-section.tsx`
 * continuam intocados, servindo só o Analytics.
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
  if (summaries.length === 0) {
    return <EmptyState title={NO_CAMPAIGNS_MESSAGE} />;
  }

  const showChannelColumn = channelScope === "consolidated";
  const hasRevenue = summaries.some((s) => s.totalRevenue !== null);
  const hasRoas = summaries.some((s) => s.roas !== null);

  const resultTypes = new Set(summaries.map((s) => s.resultType).filter((t): t is PerformanceGoal => t !== null));
  const sharedGoalConfig = resultTypes.size === 1 ? PERFORMANCE_GOALS[[...resultTypes][0]] : null;
  const resultLabel = sharedGoalConfig?.resultMetricLabel ?? "Resultado";
  const costLabel = sharedGoalConfig?.costMetricShortLabel ?? "Custo por resultado";

  return (
    <div className="overflow-x-auto">
      {/* `min-w` — mesmo recurso já usado em outras tabelas densas da
          plataforma (`reports/page.tsx`, o antigo Bloco 2 do Relatório):
          garante que o nome da campanha tenha respiro mínimo pra quebrar em
          linhas legíveis; abaixo dessa largura o container rola
          horizontalmente (`overflow-x-auto` acima) em vez de espremer o
          nome palavra por palavra — desktop (a prioridade desta tela)
          nunca é afetado. */}
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-overview-border text-left text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">
            <th className="py-2 pr-4 font-medium">Campanha</th>
            {showChannelColumn && <th className="whitespace-nowrap py-2 pr-4 font-medium">Canal</th>}
            <th className="whitespace-nowrap py-2 pr-4 text-right font-medium">Investimento</th>
            <th className="whitespace-nowrap py-2 pr-4 text-right font-medium">{resultLabel}</th>
            <th className="whitespace-nowrap py-2 pr-4 text-right font-medium">{costLabel}</th>
            {hasRevenue && <th className="whitespace-nowrap py-2 pr-4 text-right font-medium">Faturamento</th>}
            {hasRoas && <th className="whitespace-nowrap py-2 text-right font-medium">ROAS</th>}
          </tr>
        </thead>
        <tbody>
          {summaries.map((summary) => (
            <tr key={`${summary.channel}-${summary.campaignName}`} className="border-b border-overview-border/60 last:border-0">
              <td className="py-2.5 pr-4 align-top font-medium text-overview-text-primary">
                {/* `break-words`, nunca `truncate` — nome de campanha longo
                    precisa continuar legível (e sobreviver a um futuro PDF),
                    não sumir atrás de reticências. */}
                <span className="block max-w-[26rem] break-words">{summary.campaignName}</span>
              </td>
              {showChannelColumn && (
                <td className="whitespace-nowrap py-2.5 pr-4 align-top text-overview-text-muted">
                  {TRAFFIC_CHANNELS[summary.channel].shortLabel}
                </td>
              )}
              <td className="whitespace-nowrap py-2.5 pr-4 align-top text-right tabular-nums text-overview-text-primary">
                {formatCurrency(summary.totalSpend)}
              </td>
              <td className="whitespace-nowrap py-2.5 pr-4 align-top text-right tabular-nums text-overview-text-primary">
                {summary.totalResultCount !== null ? summary.totalResultCount : "—"}
              </td>
              <td className="whitespace-nowrap py-2.5 pr-4 align-top text-right tabular-nums text-overview-text-primary">
                {summary.cpa !== null ? formatCurrency(summary.cpa) : "—"}
              </td>
              {hasRevenue && (
                <td className="whitespace-nowrap py-2.5 pr-4 align-top text-right tabular-nums text-overview-text-primary">
                  {summary.totalRevenue !== null ? formatCurrency(summary.totalRevenue) : "—"}
                </td>
              )}
              {hasRoas && (
                <td className="whitespace-nowrap py-2.5 align-top text-right tabular-nums text-overview-text-primary">
                  {summary.roas !== null ? `${summary.roas.toFixed(2)}x` : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
