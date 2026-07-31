import { EmptyState } from "@/components/ui/empty-state";
import { FUTURE_OPPORTUNITY_CATEGORIES, OPPORTUNITIES_EMPTY_MESSAGE, OPPORTUNITIES_IN_DEVELOPMENT_LABEL } from "@/lib/analytics-messages";

/**
 * Bloco "Oportunidades" do Resumo Executivo — pedido explícito do usuário:
 * "não precisamos implementar inteligência complexa, quero apenas reservar
 * esse espaço na experiência". Nenhum cálculo, nenhum dado real aqui — só
 * nomeia honestamente o que vai existir, mesmo padrão de
 * `analytics-insights-section.tsx` (que continua existindo como aba própria
 * — sobreposição de propósito conhecida, sinalizada pra revisão do usuário).
 *
 * Textos em `lib/analytics-messages.ts` — reaproveitados também pelo
 * AnalyticsReport (`report-document.ts`), nunca duplicados.
 */
export function AnalyticsOpportunities() {
  return (
    <div className="flex flex-col gap-4">
      <EmptyState>{OPPORTUNITIES_EMPTY_MESSAGE}</EmptyState>
      <div>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{OPPORTUNITIES_IN_DEVELOPMENT_LABEL}</p>
        <ul className="flex flex-col gap-1.5">
          {FUTURE_OPPORTUNITY_CATEGORIES.map((category) => (
            <li key={category} className="text-sm text-muted-foreground">
              {category}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
