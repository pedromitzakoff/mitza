import { safeDivide } from "@/lib/performance";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { consolidateChannelMetrics, type ChannelMetrics, type ClientMetrics } from "@/lib/channel-metrics";

/** Uma versão de `monthly_budget_changes` já achatada pro resolvedor — `investment`
 * é `new_amount` (o campo já chamado assim em `MonthlyPlanChange`, lib/monthly-budget.ts). */
export interface ClientPlanChangeRow {
  channel: TrafficChannel;
  /** Primeiro dia do mês (`YYYY-MM-01`) a que esta versão se refere — nunca `changedAt`. */
  month: string;
  changedAt: string;
  investment: number;
  targetResultCount: number | null;
}

/**
 * Segundo dos dois resolvedores canônicos da plataforma (o primeiro é
 * `resolveClientActuals`, lib/client-actuals.ts) — Planejado e Realizado são
 * só duas implementações diferentes da mesma estrutura (`ClientMetrics`,
 * lib/channel-metrics.ts). Etapa "Planejamento por Canal": cada canal tem
 * sua própria versão vigente do plano (`monthly_budget_changes.channel`) — a
 * vigente pro mês selecionado é a mais recente dentre as com
 * `month <= selectedMonth` (mesma regra de elegibilidade que já existia em
 * `resolveMonthlyPlanSnapshot`, agora aplicada por canal em vez de uma vez
 * só pro cliente inteiro).
 *
 * CPA planejado NUNCA é lido de uma coluna — sempre `investimento ÷
 * resultado` da mesma versão vigente, calculado aqui (nunca armazenado em
 * `monthly_budget_changes`, ver `apply_monthly_channel_plan_change`).
 *
 * Canal sem nenhuma versão elegível ainda entra em `byChannel` com tudo
 * `null` (nunca omitido) — "sem plano definido" é um estado real, distinto
 * de "não mostrar o canal" (quem decide se um canal aparece na tela é o
 * chamador, via a lista `channels` — normalmente `AVAILABLE_TRAFFIC_CHANNELS`
 * pra sempre mostrar Meta e Google, mesmo sem plano ainda).
 */
export function resolveClientPlan(input: {
  channels: TrafficChannel[];
  changes: ClientPlanChangeRow[];
  selectedMonth: string;
}): ClientMetrics {
  const { channels, changes, selectedMonth } = input;

  const byChannel: Partial<Record<TrafficChannel, ChannelMetrics>> = {};
  for (const channel of channels) {
    const eligible = changes.filter((change) => change.channel === channel && change.month <= selectedMonth);
    if (eligible.length === 0) {
      byChannel[channel] = { investment: null, resultCount: null, cpa: null };
      continue;
    }

    const latest = eligible.reduce((best, change) => {
      if (change.month !== best.month) return change.month > best.month ? change : best;
      return change.changedAt > best.changedAt ? change : best;
    });

    byChannel[channel] = {
      investment: latest.investment,
      resultCount: latest.targetResultCount,
      cpa: safeDivide(latest.investment, latest.targetResultCount),
    };
  }

  return {
    byChannel,
    consolidated: consolidateChannelMetrics(channels, byChannel),
  };
}
