import { safeDivide } from "@/lib/performance";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { consolidateChannelMetrics, type ChannelMetrics, type ClientChannelMetrics } from "@/lib/channel-metrics";

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
 * `resolveClientMonthlyActuals`, lib/client-actuals.ts) — Planejado e
 * Realizado são só duas implementações diferentes da mesma estrutura
 * (`ClientChannelMetrics`, lib/channel-metrics.ts). Etapa "Planejamento
 * Mensal por Canal": cada canal tem
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
export function resolveClientMonthlyPlan(input: {
  channels: TrafficChannel[];
  changes: ClientPlanChangeRow[];
  selectedMonth: string;
}): ClientChannelMetrics {
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

/**
 * Wrapper de `resolveClientMonthlyPlan` pros consumidores que só precisam
 * do INVESTIMENTO consolidado do mês (Sprints, Dashboard, lista de
 * Clientes, Painel Mensal, Relatórios — Etapa "Migração Multicanal dos
 * Consumidores") — nunca uma soma local reimplementada por tela. Esses
 * consumidores historicamente buscam `monthly_budget_changes` já filtrado
 * `month = selectedMonth` (nunca `month <= selectedMonth`) — passar essas
 * linhas direto aqui preserva esse comportamento de sempre, porque toda
 * linha do input já satisfaz `month <= selectedMonth` trivialmente (são
 * todas do mesmo mês); a regra de "versão vigente carregada de um mês
 * anterior" de `resolveClientMonthlyPlan` só ativa se o chamador decidir
 * ampliar a própria query — nenhuma mudança de comportamento pra quem
 * continuar buscando só o mês exato.
 *
 * `fallbackPlannedSum` é o mesmo fallback de sempre (`resolveMonthlyBudget`,
 * lib/monthly-budget.ts): só usado quando NENHUM canal tem nenhuma versão
 * pra este mês — cliente que nunca passou pelo editor de planejamento.
 * `targetResultCount` nunca importa pra este consumidor (só investimento),
 * por isso não faz parte da assinatura — sempre `null` internamente.
 */
export function resolveConsolidatedMonthlyPlanned(
  channels: TrafficChannel[],
  changes: { channel: TrafficChannel; month: string; changedAt: string; investment: number }[],
  selectedMonth: string,
  fallbackPlannedSum: number,
): number {
  const plan = resolveClientMonthlyPlan({
    channels,
    changes: changes.map((c) => ({ ...c, targetResultCount: null })),
    selectedMonth,
  });
  return plan.consolidated.investment ?? fallbackPlannedSum;
}
