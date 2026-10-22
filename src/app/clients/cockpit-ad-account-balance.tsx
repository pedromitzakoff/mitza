import { formatCurrencyInCurrency } from "@/lib/format";
import type { MetaAdAccountBalanceSnapshot } from "@/lib/meta-ads-dashboard/dashboard-data";

/**
 * MITZA ONE — Cockpit Único do Cliente, indicador no CABEÇALHO (pedido
 * explícito do usuário: "quero que tenha um indicador no topo da tela
 * mostrando saldo da conta"). Mesmo peso visual de `DataFreshnessTimer`,
 * ao lado dele.
 *
 * Só conta PRÉ-PAGA mostra número de saldo — pedido explícito: "pode
 * trazer somente para as contas de pré-pago; as que não forem, coloca
 * tipo PÓS-PAGO no lugar do saldo". Qualquer estado indisponível
 * (integração não configurada, token ausente, timeout, erro da API) some
 * por completo — mesmo critério silencioso do antigo link externo
 * "Saldo" (`client.balance_url`): a maioria dos clientes não tem conta
 * Meta direta configurada, e um indicador de erro no cabeçalho pra todo
 * mundo seria ruído, não informação.
 */
export function CockpitAdAccountBalance({ snapshot }: { snapshot: MetaAdAccountBalanceSnapshot }) {
  if (snapshot.status !== "ok") return null;

  if (!snapshot.isPrepay) {
    return (
      <p className="text-xs text-overview-text-muted">
        Meta Ads <span className="font-medium text-overview-text-secondary">Pós-pago</span>
      </p>
    );
  }

  return (
    <p className="text-xs text-overview-text-muted">
      Saldo Meta Ads <span className="font-medium tabular-nums text-overview-text-primary">{formatCurrencyInCurrency(snapshot.balance, snapshot.currency)}</span>
    </p>
  );
}
