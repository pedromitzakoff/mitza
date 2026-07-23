import Link from "next/link";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { MetricDeviation } from "@/components/workspace/metric-deviation";
import { formatCurrency } from "@/lib/format";
import { MIN_RELIABLE_RESULT_COUNT } from "@/lib/operation-health-thresholds";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { formatAtividadeLabel } from "@/lib/metric-diagnostics";
import type { ClientOperationalState } from "@/lib/client-operational-state";

const countFormatter = new Intl.NumberFormat("pt-BR");

/** Moeda inteira ("R$ 2.413") — investimento é sempre exibido arredondado
 * pro real mais próximo (a precisão de centavos não ajuda a leitura rápida
 * do painel). Custo por resultado e Meta usam `formatCurrency` (2 casas),
 * porque ali a diferença de centavos costuma ser o próprio ponto de
 * atenção — e é o mesmo número que o gestor compara lado a lado. */
function formatWholeCurrency(value: number): string {
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

/**
 * Card da Operação (Etapa "Novo Conceito de Monitoramento Operacional") —
 * o diagnóstico deixou de ser uma frase abaixo do nome
 * (`evaluation.primaryReason`) e passa a acontecer diretamente em cada
 * métrica, através do componente único de desvio (`MetricDeviation`):
 * valor + desvio % + seta + cor, sempre pela MESMA régua de magnitude
 * (até 10% normal, 10–20% atenção/amarelo, acima de 20% crítico/vermelho —
 * Motor de Diagnóstico Único, `lib/metric-diagnostics.ts`). Resultado e
 * Meta são valores de referência, não desvios — aparecem como valor
 * simples, sem seta/cor. Pendências saiu do corpo do card (continua
 * existindo como eixo/filtro da Operação — ver
 * `metric-diagnostics.ts`/`operation-filter-bar.tsx` — só deixou de ser
 * uma métrica principal aqui). O rodapé (antes "Última atualização",
 * baseado em sincronização de dados; depois "Acompanhamento") agora mostra
 * Atividade — só aparece quando a conta está sem qualquer atividade há
 * 48h ou mais, em vermelho; abaixo disso o card fica limpo de propósito,
 * porque só a exceção deve chamar atenção.
 *
 * ⚠️ PARCIALMENTE PROVISÓRIO: `diagnostics.atividade` combina duas
 * fontes — `client_last_operational_activity` (tarefa criada/editada/
 * concluída/comentada, comentário de sprint: infraestrutura real, Etapa
 * 15) e `account_reviews` (a fonte de "revisão de conta"/otimização que já
 * existia). Só a segunda é placeholder: quando a estrutura real de
 * Otimizações existir (congelada pra uma etapa futura), ela substitui
 * `account_reviews` como o insumo de "otimização" — a parte de tarefas não
 * muda. Essa troca acontece inteira em `client-operational-state-data.ts`;
 * este componente e o motor (`metric-diagnostics.ts`) não mudam.
 */
export function OperationClientCard({ card }: { card: ClientOperationalState }) {
  const { diagnostics, evaluation } = card;
  const goalConfig = card.performanceGoal ? PERFORMANCE_GOALS[card.performanceGoal] : null;
  const investment = evaluation.dimensions.investment;
  const results = evaluation.dimensions.results;
  const targetCostPerResult = evaluation.dimensions.cost.planned;

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

  const metaLabel = goalConfig ? `Meta ${goalConfig.costMetricShortLabel}` : "Meta";
  const metaValue = targetCostPerResult === null ? "—" : formatCurrency(targetCostPerResult);
  const metaTitle = !goalConfig
    ? "Objetivo não configurado"
    : targetCostPerResult === null
      ? "Meta de custo não configurada"
      : undefined;

  const atividadeLabel = formatAtividadeLabel(diagnostics.atividade);

  return (
    <Link
      href={`/clients/${card.clientId}`}
      className="mitza-pressable group flex items-center gap-4 rounded-lg border border-border px-4 py-3 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:border-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:border-zinc-700"
    >
      <ClientAvatar name={card.clientName} imageUrl={card.avatarUrl} size="sm" />

      <div className="flex w-64 min-w-0 shrink-0 flex-col">
        <p className="truncate text-sm font-semibold text-foreground">{card.clientName}</p>
        <p className="text-[11px] text-overview-danger">{atividadeLabel ?? ""}</p>
      </div>

      <div className="grid flex-1 grid-cols-4 gap-10">
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
        <MetricDeviation label={metaLabel} value={metaValue} diagnostic={null} title={metaTitle} />
      </div>
    </Link>
  );
}
