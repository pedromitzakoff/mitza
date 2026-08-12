"use client";

import { X } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { PerformanceGoalConfig } from "@/lib/performance-goals";
import type { CreativeSummary } from "@/lib/creative-analytics";
import { CreativeThumbnail } from "./creative-thumbnail";

function ComparisonStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-t border-border py-1.5 first:border-t-0 first:pt-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/**
 * Comparação lado a lado (Etapa "Análise de Criativos") — a mudança que o
 * usuário marcou como mais importante desta etapa: não é uma aba nova, é um
 * painel efêmero sobre a MESMA lista, aberto a partir de 2-3 criativos
 * marcados no grid/tabela. Estado puramente local (`open` controlado por
 * quem chama, `CreativeAnalyticsList`) — nunca querystring, porque seleção
 * de comparação não é um estado que faça sentido persistir/compartilhar por
 * link (diferente dos outros drawers da plataforma, que abrem um registro
 * existente por id).
 *
 * Mesmo padrão visual dos demais drawers (`mitza-backdrop-in`/
 * `mitza-panel-in`, ver `monthly-budget-history-drawer.tsx`), só que
 * client-state em vez de Link+querystring — não existe "registro" nenhum
 * pra abrir por URL aqui.
 */
export function CreativeComparisonDrawer({
  summaries,
  goalConfig,
  onClose,
}: {
  /** 2 ou 3 criativos — quem chama garante essa faixa antes de renderizar. */
  summaries: CreativeSummary[];
  goalConfig: PerformanceGoalConfig | null;
  onClose: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar comparação"
        className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30"
      />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-y-auto border-l border-border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Comparar criativos</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {summaries.length} criativos selecionados
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className={`mt-4 grid gap-4 ${summaries.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
          {summaries.map((summary) => (
            <div key={summary.creativeName} className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div className="w-16">
                <CreativeThumbnail url={summary.previewImageUrl} alt={summary.creativeName} />
              </div>
              <p className="text-sm font-semibold leading-snug text-foreground">{summary.creativeName}</p>
              <div>
                <ComparisonStat label="Investimento" value={formatCurrency(summary.totalSpend)} />
                {goalConfig && (
                  <ComparisonStat
                    label={goalConfig.resultMetricLabel}
                    value={summary.totalResultCount !== null ? String(summary.totalResultCount) : "—"}
                  />
                )}
                {goalConfig && (
                  <ComparisonStat
                    label={goalConfig.costMetricShortLabel}
                    value={summary.cpa !== null ? formatCurrency(summary.cpa) : "—"}
                  />
                )}
                {summary.roas !== null && <ComparisonStat label="ROAS" value={`${summary.roas.toFixed(2)}x`} />}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
