import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import type { PeriodReading } from "@/lib/performance-report/report-derivatives";

export type CockpitPerformanceView =
  | { kind: "no_goal" }
  | { kind: "no_data" }
  | { kind: "investment_only"; totalSpend: number }
  | { kind: "ok"; reading: PeriodReading };

/**
 * MITZA ONE — Fase 1 (Cockpit Único do Cliente), Seção "Performance
 * essencial" (pedido, seções 18-20) — "Onde está o problema ou
 * oportunidade?". NÃO incorpora a página de Performance inteira (Campanhas/
 * Públicos/Criativos/Posicionamentos/Resultado diário continuam só em
 * `/clients/[id]/relatorio`, seção 20 do pedido) — mostra só a "Leitura do
 * período" que o Relatório já calcula (`buildPeriodReading`,
 * `lib/performance-report/report-derivatives.ts`, mesma função, nenhum
 * texto novo) e dois CTAs pra investigar sem "sair mentalmente do cliente".
 */
export function CockpitPerformanceSection({
  view,
  campaignsHref,
  fullReportHref,
}: {
  view: CockpitPerformanceView;
  campaignsHref: string;
  fullReportHref: string;
}) {
  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Performance</h2>
        <Link href={fullReportHref} className="shrink-0 text-xs font-medium text-brand hover:underline">
          Ver Performance completa →
        </Link>
      </div>

      <div className="mt-3 text-sm text-overview-text-primary">
        {view.kind === "no_goal" && <p className="text-overview-text-secondary">Este cliente ainda não tem um objetivo de performance configurado.</p>}
        {view.kind === "no_data" && <p className="text-overview-text-secondary">Não encontramos dados de Performance para o período selecionado.</p>}
        {view.kind === "investment_only" && <p className="text-overview-text-secondary">{formatCurrency(view.totalSpend)} investidos no período, sem meta de resultado vinculada.</p>}
        {view.kind === "ok" && (
          <div className="flex flex-col gap-1">
            {view.reading.kind === "neutral" ? (
              <p className="text-overview-text-secondary">{view.reading.message}</p>
            ) : (
              <>
                <p>{view.reading.summaryLine}</p>
                {view.reading.targetLine && <p className="text-overview-text-secondary">{view.reading.targetLine}</p>}
                {view.reading.bestCampaignLine && <p className="text-overview-text-secondary">{view.reading.bestCampaignLine}</p>}
              </>
            )}
          </div>
        )}
      </div>

      <Link href={campaignsHref} className="mt-3 inline-block text-xs font-medium text-brand hover:underline">
        Ver campanhas →
      </Link>
    </div>
  );
}
