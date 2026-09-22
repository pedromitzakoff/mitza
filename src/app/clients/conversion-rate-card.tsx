import { formatPercent } from "@/lib/format";

/**
 * Taxa de conversão (vendas ÷ carrinhos) — pedido explícito do usuário
 * ("carrinho é uma métrica secundária, só pra calcular a conversão").
 * Deliberadamente FORA de `SecondaryGoalsPerformance` ("Outros objetivos"):
 * aquele bloco é só pra `client_goals` reais, com meta/target configurável
 * — carrinho nunca vira um objetivo (nunca aparece em `client_goals`), só
 * alimenta esta única conta derivada. `null` sem nenhum carrinho registrado
 * no mês (caso comum: só cliente com a coluna de carrinho mapeada no
 * Stract tem isso, hoje só Leonardo Darcadia) — some por inteiro, nenhum
 * espaço vazio reservado, mesmo comportamento de `SecondaryGoalsPerformance`.
 */
export function ConversionRateCard({ conversionRate }: { conversionRate: number | null }) {
  if (conversionRate === null) return null;

  return (
    <div className="mt-6 rounded-lg bg-overview-surface-subtle p-3">
      <h3 className="text-sm font-semibold text-overview-text-primary">Taxa de conversão</h3>
      <div className="mt-3 rounded-md border border-overview-border bg-overview-surface p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-overview-text-muted">Carrinho → venda</p>
        <p className="mt-1 text-lg font-semibold tabular-nums text-overview-text-primary">{formatPercent(conversionRate * 100)}</p>
      </div>
    </div>
  );
}
