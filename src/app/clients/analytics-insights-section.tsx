import { EmptyState } from "@/components/ui/empty-state";

/**
 * Seção "Insights" do hub de Analytics — reserva de espaço pra inteligência
 * automática futura (pedido explícito do usuário: "não implementar
 * regras... criar apenas a seção"). Nenhum cálculo, nenhum dado real aqui —
 * só nomeia honestamente o que vai existir, pra ninguém confundir "ainda
 * não implementado" com "não tem insight neste período".
 */
const FUTURE_INSIGHT_CATEGORIES = [
  "Melhor criativo do mês",
  "Campanha com maior crescimento",
  "Criativo com menor custo por resultado",
  "Criativo recebendo muito investimento com baixo resultado",
  "Oportunidades de escala",
  "Alertas de desempenho",
];

export function AnalyticsInsightsSection() {
  return (
    <div className="flex flex-col gap-4">
      <EmptyState>Os insights automáticos desta conta ainda não foram implementados.</EmptyState>
      <div>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Em desenvolvimento</p>
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
