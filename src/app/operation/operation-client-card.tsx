import Link from "next/link";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { MetricDeviation } from "@/components/workspace/metric-deviation";
import { formatCurrency } from "@/lib/format";
import { MIN_RELIABLE_RESULT_COUNT } from "@/lib/operation-health-thresholds";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { formatAcompanhamentoLabel } from "@/lib/metric-diagnostics";
import type { ClientOperationalState } from "@/lib/client-operational-state";

const countFormatter = new Intl.NumberFormat("pt-BR");

/** Moeda inteira ("R$ 2.413") — investimento é sempre exibido arredondado
 * pro real mais próximo (a precisão de centavos não ajuda a leitura rápida
 * do painel). Custo por resultado usa `formatCurrency` (2 casas), porque
 * ali a diferença de centavos costuma ser o próprio ponto de atenção. */
function formatWholeCurrency(value: number): string {
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

/**
 * Card da Operação (Etapa "Novo Conceito de Monitoramento Operacional") —
 * o diagnóstico deixou de ser uma frase abaixo do nome
 * (`evaluation.primaryReason`) e passa a acontecer diretamente em cada
 * métrica, através do componente único de desvio (`MetricDeviation`):
 * valor + desvio % + seta + cor, sempre pela regra do próprio indicador
 * (Motor de Diagnóstico Único, `lib/metric-diagnostics.ts`). Resultado e
 * Pendências ainda não têm uma regra de desvio própria no motor — aparecem
 * como valor simples, sem seta/cor, até essa etapa acontecer. O rodapé
 * (antes "Última atualização", baseado em sincronização de dados) agora
 * mostra Acompanhamento — há quanto tempo o gestor registrou a última
 * otimização, o eixo que faz o card responder não só "como está a conta"
 * mas "alguém está cuidando dela".
 *
 * ⚠️ PROVISÓRIO: `diagnostics.acompanhamento` hoje é alimentado por
 * `account_reviews`/`account_review_cadences` (a fonte de "revisão de
 * conta" que já existia), NUNCA pela estrutura real de Otimizações — essa
 * ainda não foi implementada (congelada pra uma etapa futura). Quando ela
 * existir, só `client-operational-state-data.ts` precisa trocar de fonte;
 * este componente e o motor (`metric-diagnostics.ts`) não mudam.
 */
export function OperationClientCard({ card }: { card: ClientOperationalState }) {
  const { diagnostics, evaluation } = card;
  const goalConfig = card.performanceGoal ? PERFORMANCE_GOALS[card.performanceGoal] : null;

  const investment = evaluation.dimensions.investment;
  const results = evaluation.dimensions.results;

  const investmentValue = investment.hasSyncedData ? formatWholeCurrency(investment.actual) : "—";
  const investmentTitle = investment.hasSyncedData ? undefined : "Sem dados de investimento";

  const resultValue = !goalConfig || !results.hasPerformanceData ? "—" : countFormatter.format(results.actual);
  const resultTitle = !goalConfig
    ? "Objetivo não configurado"
    : !results.hasPerformanceData
      ? "Sem resultados registrados"
      : undefined;

  const costValue = diagnostics.cpa === null ? "—" : formatCurrency(diagnostics.cpa.value);
  const costTitle =
    diagnostics.cpa === null
      ? results.hasPerformanceData
        ? `Aguardando amostra suficiente — mínimo de ${MIN_RELIABLE_RESULT_COUNT} resultados`
        : "Sem dados de custo"
      : undefined;

  const pendenciasTitle = diagnostics.pendencias.items.map((item) => item.label).join(", ") || undefined;

  const acompanhamentoLabel = formatAcompanhamentoLabel(diagnostics.acompanhamento);
  const acompanhamentoClass = diagnostics.acompanhamento.isOverdue ? "text-overview-danger" : "text-muted-foreground";

  return (
    <Link
      href={`/clients/${card.clientId}`}
      className="mitza-pressable group flex items-center gap-4 rounded-lg border border-border px-4 py-3 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:border-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:border-zinc-700"
    >
      <ClientAvatar name={card.clientName} imageUrl={card.avatarUrl} size="sm" />

      <div className="flex w-64 min-w-0 shrink-0 flex-col">
        <p className="truncate text-sm font-semibold text-foreground">{card.clientName}</p>
        <p className={`text-[11px] ${acompanhamentoClass}`}>{acompanhamentoLabel}</p>
      </div>

      <div className="flex flex-1 items-center gap-6">
        <MetricDeviation
          label="Investimento"
          value={investmentValue}
          diagnostic={investment.hasSyncedData ? diagnostics.investment : null}
          title={investmentTitle}
        />
        <MetricDeviation
          label={goalConfig?.resultMetricLabel ?? "Resultado"}
          value={resultValue}
          diagnostic={null}
          title={resultTitle}
        />
        <MetricDeviation
          label={goalConfig?.costMetricShortLabel ?? "Custo"}
          value={costValue}
          diagnostic={diagnostics.cpa}
          title={costTitle}
        />
        <MetricDeviation
          label="Pendências"
          value={String(diagnostics.pendencias.count)}
          diagnostic={null}
          title={pendenciasTitle}
        />
      </div>
    </Link>
  );
}
