import Link from "next/link";
import { ClientAvatar } from "@/components/workspace/client-avatar";
import { formatCurrency } from "@/lib/format";
import { MIN_RELIABLE_RESULT_COUNT } from "@/lib/operation-health-thresholds";
import { PERFORMANCE_GOALS } from "@/lib/performance-goals";
import { formatDataFreshnessLabel } from "@/lib/operation-triage";
import type { ClientOperationalState } from "@/lib/client-operational-state";

const countFormatter = new Intl.NumberFormat("pt-BR");

/** Moeda inteira ("R$ 2.413") — investimento é sempre exibido arredondado
 * pro real mais próximo (a precisão de centavos não ajuda a leitura rápida
 * do painel). Custo por resultado usa `formatCurrency` (2 casas), porque
 * ali a diferença de centavos costuma ser o próprio ponto de atenção. */
function formatWholeCurrency(value: number): string {
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0 flex-1" title={title}>
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate text-xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/**
 * Card da Operação (Etapa "Fila de Prioridades 1.0") — a tela deixou de
 * comparar planejado vs. realizado, mostrar tendência ou qualquer selo de
 * severidade: só os três números do estado atual da conta (investimento,
 * resultado principal, custo por resultado), grandes o bastante pra ler em
 * poucos segundos, e a metadata mínima (última atualização + pendências).
 * `evaluation.primaryReason` volta a aparecer (uma linha, sem quebrar) logo
 * abaixo do nome — é o contexto mínimo pra responder "por que este cliente
 * está na fila?" sem reintroduzir nenhuma comparação longa. O motivo
 * SECUNDÁRIO continua fora do card (`collectAccountHealthReasons` nunca é
 * chamado aqui). `evaluation` (Motor de Saúde) continua sendo a única
 * fonte dos valores — a ordenação da fila (fora deste componente) também
 * continua vindo dele — só que a UI não narra mais desvio/severidade dos
 * três números, apenas o valor bruto atual.
 */
export function OperationClientCard({ card, todayStr }: { card: ClientOperationalState; todayStr: string }) {
  const { evaluation } = card;
  const freshnessLabel = formatDataFreshnessLabel(card.lastDataSyncAt, todayStr);
  const goalConfig = card.performanceGoal ? PERFORMANCE_GOALS[card.performanceGoal] : null;

  const investment = evaluation.dimensions.investment;
  const results = evaluation.dimensions.results;
  const cost = evaluation.dimensions.cost;

  const investmentValue = investment.hasSyncedData ? formatWholeCurrency(investment.actual) : "—";
  const investmentTitle = investment.hasSyncedData ? undefined : "Sem dados de investimento";

  const resultValue = !goalConfig || !results.hasPerformanceData ? "—" : countFormatter.format(results.actual);
  const resultTitle = !goalConfig
    ? "Objetivo não configurado"
    : !results.hasPerformanceData
      ? "Sem resultados registrados"
      : undefined;

  const costValue = !cost.hasReliableSample || cost.actual === null ? "—" : formatCurrency(cost.actual);
  const costTitle = !cost.hasReliableSample
    ? `Aguardando amostra suficiente — ${cost.sampleSize} de ${MIN_RELIABLE_RESULT_COUNT}`
    : cost.actual === null
      ? "Sem dados de custo"
      : undefined;

  return (
    <Link
      href={`/clients/${card.clientId}`}
      className="mitza-pressable group flex items-center gap-4 rounded-lg border border-border px-4 py-3 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-enter)] hover:border-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:hover:border-zinc-700"
    >
      <ClientAvatar name={card.clientName} imageUrl={card.avatarUrl} size="sm" />

      <div className="flex w-64 min-w-0 shrink-0 flex-col">
        <p className="truncate text-sm font-semibold text-foreground">{card.clientName}</p>
        <p className="text-xs text-muted-foreground">{evaluation.primaryReason}</p>
        <p className="text-[11px] text-muted-foreground/80">
          {freshnessLabel}
          {card.overdueTasksCount > 0
            ? ` · ${card.overdueTasksCount} tarefa${card.overdueTasksCount > 1 ? "s" : ""} pendente${card.overdueTasksCount > 1 ? "s" : ""}`
            : ""}
        </p>
      </div>

      <div className="flex flex-1 items-center gap-6">
        <Stat label="Investimento" value={investmentValue} title={investmentTitle} />
        <Stat label={goalConfig?.resultMetricLabel ?? "Resultado"} value={resultValue} title={resultTitle} />
        <Stat label={goalConfig?.costMetricShortLabel ?? "Custo"} value={costValue} title={costTitle} />
      </div>
    </Link>
  );
}
