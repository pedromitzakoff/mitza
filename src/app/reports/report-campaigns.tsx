"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { TRAFFIC_CHANNELS, type ChannelScope } from "@/lib/traffic-channels";
import { EmptyState } from "@/components/workspace/empty-state";
import { NO_CAMPAIGNS_MESSAGE } from "@/lib/analytics-messages";
import type { CampaignSummary } from "@/lib/campaign-analytics";

/** Quantas campanhas a visão inicial (compacta) mostra antes de "Ver
 * todas" — critério objetivo (maior investimento), nunca "melhores"
 * campanhas. `buildCampaignSummaries` (lib/campaign-analytics.ts) já
 * ordena por investimento decrescente; esta etapa só decide QUANTAS dessa
 * MESMA ordem aparecem de cara — nenhum resort, nenhum cálculo novo. */
const INITIAL_VISIBLE_COUNT = 10;

/**
 * Etapa "Progressive disclosure das Campanhas": clientes com 30-40+
 * campanhas num mês tornavam a seção inteira do relatório um dump de
 * dados, mesmo já compacta em tabela (etapa anterior). Aqui a camada
 * EXECUTIVA (10 campanhas de maior investimento) e a camada AUDITÁVEL
 * (todas) são o MESMO array, na MESMA ordem — só a QUANTIDADE renderizada
 * muda com um toggle local (`expanded`), nunca uma segunda consulta, nunca
 * um corte na fonte de dados. Nenhuma campanha "some": todas continuam no
 * DOM o tempo todo — as que ficam além do corte quando recolhido ganham
 * `hidden print:table-row`, então (a) hoje já imprimem corretamente numa
 * impressão/PDF-do-navegador mesmo com a seção recolhida na tela, e (b)
 * uma futura exportação de PDF de verdade não precisa reimplementar nada
 * aqui — só decidir que o modo "print" está ativo.
 *
 * Sem drawer/modal/navegação — é expansão inline (pedido explícito), por
 * isso "use client" (o único motivo desta etapa exigir um Client
 * Component: o restante do Relatório continua Server Component).
 *
 * Ainda um único consumidor real (Campanhas) — Criativos/outras seções
 * (arquitetura futura, seção 6 do pedido) NÃO viram uma abstração genérica
 * agora; quando existir um segundo consumidor de verdade, aí sim vale
 * extrair um primitive compartilhado.
 */
export function ReportCampaignsList({ summaries, channelScope }: { summaries: CampaignSummary[]; channelScope: ChannelScope }) {
  const [expanded, setExpanded] = useState(false);

  if (summaries.length === 0) {
    return <EmptyState title={NO_CAMPAIGNS_MESSAGE} />;
  }

  const total = summaries.length;
  const hasMoreThanInitial = total > INITIAL_VISIBLE_COUNT;
  const showChannelColumn = channelScope === "consolidated";
  const hasRevenue = summaries.some((s) => s.totalRevenue !== null);
  const hasRoas = summaries.some((s) => s.roas !== null);

  const resultTypes = new Set(summaries.map((s) => s.resultType).filter((t): t is PerformanceGoal => t !== null));
  const sharedGoalConfig = resultTypes.size === 1 ? PERFORMANCE_GOALS[[...resultTypes][0]] : null;
  const resultLabel = sharedGoalConfig?.resultMetricLabel ?? "Resultado";
  const costLabel = sharedGoalConfig?.costMetricShortLabel ?? "Custo por resultado";

  return (
    <div>
      <p className="text-xs text-overview-text-secondary">
        {total} campanha{total === 1 ? "" : "s"} no período
      </p>

      <div className="mt-2 overflow-x-auto">
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
            {summaries.map((summary, index) => {
              // Nunca removida do DOM — só oculta na TELA quando recolhida e
              // além do corte inicial; `print:table-row` garante que uma
              // impressão (hoje) ou uma futura exportação PDF (amanhã)
              // continue mostrando a linha mesmo com a seção recolhida.
              const isHiddenWhenCollapsed = !expanded && hasMoreThanInitial && index >= INITIAL_VISIBLE_COUNT;
              return (
                <tr
                  key={`${summary.channel}-${summary.campaignName}`}
                  className={`border-b border-overview-border/60 last:border-0 ${isHiddenWhenCollapsed ? "hidden print:table-row" : ""}`}
                >
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
              );
            })}
          </tbody>
        </table>
      </div>

      {hasMoreThanInitial && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-xs font-medium text-brand hover:underline print:hidden"
        >
          {expanded ? "Recolher campanhas ↑" : `Ver todas as ${total} campanhas ↓`}
        </button>
      )}
    </div>
  );
}
