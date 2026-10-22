import type { CockpitInsight } from "@/lib/cockpit-diagnostics";

const SEVERITY_DOT_CLASS: Record<CockpitInsight["severity"], string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-overview-text-muted",
};

/**
 * KOFF Analytics — Redesign definitivo do Cockpit: "incorporar alertas e
 * diagnóstico de forma discreta e contextual, sem ocupar uma seção inteira
 * quando não houver nada relevante" (pedido explícito do usuário). Antes
 * era sempre uma seção própria com moldura e título "Diagnóstico", mesmo
 * sem nenhum ponto de atenção (mostrando "Nenhum ponto de atenção...",
 * ocupando espaço à toa). Agora: SEM insight nenhum, o componente não
 * renderiza NADA (`null`) — sem caixa, sem texto tranquilizador, zero
 * espaço ocupado; COM insight, vira uma lista compacta sem título/moldura
 * própria, pra conviver dentro da Visão executiva (quem usa decide onde
 * encaixar, este componente só lista). Puramente apresentacional: a lista
 * já vem priorizada e limitada (`buildCockpitInsights`,
 * `lib/cockpit-diagnostics.ts`) — este componente só renderiza, nunca
 * decide o que é relevante.
 */
export function CockpitDiagnosticsCard({ insights }: { insights: CockpitInsight[] }) {
  if (insights.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1.5 rounded-lg border border-overview-border bg-overview-surface px-3 py-2.5">
      {insights.map((insight) => (
        <li key={insight.id} className="flex items-start gap-2 text-sm">
          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT_CLASS[insight.severity]}`} aria-hidden="true" />
          <span className="text-overview-text-primary">{insight.message}</span>
        </li>
      ))}
    </ul>
  );
}
