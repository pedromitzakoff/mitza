import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import type { PerformanceGoalConfig } from "@/lib/performance-goals";
import type { CreativeSummary } from "@/lib/creative-analytics";
import { CreativeThumbnail } from "./creative-thumbnail";

/**
 * Visão "Tabela" dos criativos (Etapa "Análise de Criativos") — segunda
 * forma de visualizar a MESMA lista que os cards, pra análise rápida por
 * ordenação (ex.: por CPA, todos os melhores juntos, o que o grid não faz
 * bem). Nunca uma fonte de dado paralela: recebe a mesma `CreativeSummary[]`
 * já filtrada/ordenada por quem chama (`CreativeAnalyticsList`), só
 * apresenta diferente — miniatura pequena (`CreativeThumbnail size="sm"`,
 * mesma fonte de imagem de sempre) em vez de imagem grande.
 *
 * Resultado/custo nulo (criativo sem venda) aparece como "—" na MESMA
 * coluna dos que têm valor — nunca uma célula ausente/coluna deslocada
 * (pedido explícito: o vazio precisa ficar alinhado, não parecer quebrado).
 */
export function CreativeTableView({
  summaries,
  goalConfig,
  buildDetailHref,
}: {
  summaries: CreativeSummary[];
  goalConfig: PerformanceGoalConfig | null;
  buildDetailHref: (creativeName: string) => string;
}) {
  const hasRoas = summaries.some((s) => s.roas !== null);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2">Criativo</th>
            <th className="px-3 py-2">Campanha</th>
            <th className="px-3 py-2 text-right">Invest.</th>
            {goalConfig && <th className="px-3 py-2 text-right">{goalConfig.resultMetricLabel}</th>}
            {goalConfig && <th className="px-3 py-2 text-right">{goalConfig.costMetricShortLabel}</th>}
            {hasRoas && <th className="px-3 py-2 text-right">ROAS</th>}
          </tr>
        </thead>
        <tbody>
          {summaries.map((summary) => (
            <tr key={summary.creativeName} className="border-b border-border last:border-0 hover:bg-brand/[0.03]">
              <td className="px-3 py-2">
                <Link
                  href={buildDetailHref(summary.creativeName)}
                  className="flex min-w-0 items-center gap-2.5 text-foreground hover:text-brand"
                >
                  <span className="h-9 w-9 shrink-0">
                    <CreativeThumbnail url={summary.previewImageUrl} alt={summary.creativeName} size="sm" />
                  </span>
                  <span className="max-w-[220px] truncate font-medium">{summary.creativeName}</span>
                </Link>
              </td>
              <td className="max-w-[180px] truncate px-3 py-2 text-muted-foreground">
                {summary.campaignNames.length === 1 ? summary.campaignNames[0] : `${summary.campaignNames.length} campanhas`}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatCurrency(summary.totalSpend)}</td>
              {goalConfig && (
                <td className="px-3 py-2 text-right tabular-nums text-foreground">
                  {summary.totalResultCount !== null ? summary.totalResultCount : "—"}
                </td>
              )}
              {goalConfig && (
                <td className="px-3 py-2 text-right tabular-nums text-foreground">
                  {summary.cpa !== null ? formatCurrency(summary.cpa) : "—"}
                </td>
              )}
              {hasRoas && (
                <td className="px-3 py-2 text-right tabular-nums text-foreground">
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
