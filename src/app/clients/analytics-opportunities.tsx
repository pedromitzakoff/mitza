import { EmptyState } from "@/components/ui/empty-state";

/**
 * Bloco "Oportunidades" do Resumo Executivo — pedido explícito do usuário:
 * "não precisamos implementar inteligência complexa, quero apenas reservar
 * esse espaço na experiência". Nenhum cálculo, nenhum dado real aqui — só
 * nomeia honestamente o que vai existir, mesmo padrão de
 * `analytics-insights-section.tsx` (que continua existindo como aba própria
 * — sobreposição de propósito conhecida, sinalizada pra revisão do usuário).
 */
const FUTURE_OPPORTUNITY_CATEGORIES = [
  "Aumentar investimento em um criativo com bom desempenho",
  "Revisar uma campanha com queda de desempenho",
  "Testar novamente um criativo que já performou bem",
  "Escalar uma campanha com espaço pra crescer",
  "Substituir um criativo que perdeu eficiência",
];

export function AnalyticsOpportunities() {
  return (
    <div className="flex flex-col gap-4">
      <EmptyState>As oportunidades automáticas desta conta ainda não foram implementadas.</EmptyState>
      <div>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Em desenvolvimento</p>
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
