import { EmptyState } from "@/components/ui/empty-state";
import { FUTURE_INSIGHT_CATEGORIES, INSIGHTS_EMPTY_MESSAGE, INSIGHTS_IN_DEVELOPMENT_LABEL } from "@/lib/analytics-messages";

/**
 * Seção "Insights" do hub de Analytics — reserva de espaço pra inteligência
 * automática futura (pedido explícito do usuário: "não implementar
 * regras... criar apenas a seção"). Nenhum cálculo, nenhum dado real aqui —
 * só nomeia honestamente o que vai existir, pra ninguém confundir "ainda
 * não implementado" com "não tem insight neste período".
 *
 * Textos em `lib/analytics-messages.ts` — reaproveitados também pelo
 * AnalyticsReport (`report-document.ts`), nunca duplicados.
 */
export function AnalyticsInsightsSection() {
  return (
    <div className="flex flex-col gap-4">
      <EmptyState>{INSIGHTS_EMPTY_MESSAGE}</EmptyState>
      <div>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{INSIGHTS_IN_DEVELOPMENT_LABEL}</p>
        <ul className="flex flex-col gap-1.5">
          {FUTURE_INSIGHT_CATEGORIES.map((category) => (
            <li key={category} className="text-sm text-muted-foreground">
              {category}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
