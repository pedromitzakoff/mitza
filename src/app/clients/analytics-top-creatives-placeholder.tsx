import { EmptyState } from "@/components/ui/empty-state";

/**
 * "Top Criativos" — Etapa "Analytics Instagramável" (facelift): a MITZA não
 * persiste nome/thumbnail/resultado por criativo em nenhuma tabela hoje (o
 * Import Service descarta identidade de campanha/criativo ao gravar em
 * `daily_spend`/`daily_performance`) — nunca um card com número fabricado.
 * Trocado o skeleton de 3 cards grandes (chamava atenção demais pra um
 * recurso inexistente) por um empty state elegante de uma linha — mesmo
 * princípio do MITZA Score removido: "não anunciar o que não existe".
 */
export function AnalyticsTopCreativesPlaceholder() {
  return (
    <EmptyState>
      A integração de criativos estará disponível em breve. Assim que conectada, os melhores anúncios aparecerão aqui automaticamente.
    </EmptyState>
  );
}
