import type { CockpitInsight } from "@/lib/cockpit-diagnostics";

const SEVERITY_DOT_CLASS: Record<CockpitInsight["severity"], string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-overview-text-muted",
};

/**
 * MITZA ONE — Fase 1 (Cockpit Único do Cliente), Seção "Diagnóstico"
 * (pedido, seções 11-13) — "Onde preciso prestar atenção?". Puramente
 * apresentacional: a lista já vem priorizada e limitada
 * (`buildCockpitInsights`, `lib/cockpit-diagnostics.ts`) — este componente
 * só renderiza, nunca decide o que é relevante.
 */
export function CockpitDiagnosticsCard({ insights }: { insights: CockpitInsight[] }) {
  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Diagnóstico</h2>
      {insights.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {insights.map((insight) => (
            <li key={insight.id} className="flex items-start gap-2 text-sm">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT_CLASS[insight.severity]}`} aria-hidden="true" />
              <span className="text-overview-text-primary">{insight.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-overview-text-secondary">Nenhum ponto de atenção — dentro do esperado no mês.</p>
      )}
    </div>
  );
}
