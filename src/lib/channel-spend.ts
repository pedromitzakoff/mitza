import type { SpendSource } from "@/lib/sprint-financials";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * MVP Etapa 2 — fonte de verdade de INVESTIMENTO por plataforma. Espelha
 * exatamente as regras de `sprint-financials.ts` (`resolveSprintActualSpend`
 * / `computeSprintEffectiveSpend` / `sumEffectiveSpend`), só que resolvendo
 * o gasto real de UM canal por vez em vez do valor consolidado da sprint.
 *
 * Nada aqui é consumido por nenhuma tela ainda — isso é trabalho da etapa
 * do filtro de plataforma na Visão Geral. Este arquivo só estabelece as
 * funções centrais pra nunca duplicar a lógica de filtro/soma por canal em
 * cada consumidor (mesma razão de existir de `sprint-financials.ts`).
 *
 * Regra que nunca pode ser violada por quem consumir isto: o consolidado é
 * sempre a SOMA coerente dos canais (nunca um valor independente), e o
 * investimento de um canal nunca é usado pra calcular CPL/CPA de outro
 * canal — ver `resolveActualSpendForScope` em `lib/performance.ts`.
 */

export interface SprintChannelSpendOverride {
  channel: TrafficChannel;
  spend_source: SpendSource;
  manual_actual_spend: number | null;
}

/** Mesma decisão de `resolveSprintActualSpend`, mas pro override de UM
 * canal — `override` é `undefined` quando o canal nunca teve um override
 * salvo em `sprint_channel_spend` (equivale a "sempre meta_api" pra esse
 * canal). */
export function resolveSprintChannelActualSpend(override: SprintChannelSpendOverride | undefined, metaSpendSum: number): number {
  if (override && override.spend_source === "manual" && override.manual_actual_spend !== null) {
    return override.manual_actual_spend;
  }
  return metaSpendSum;
}

/** Soma o `daily_spend` de UM canal dentro do período de uma sprint e
 * resolve manual x meta_api pra esse canal — a versão "por canal" de
 * `computeSprintEffectiveSpend`. */
export function computeSprintChannelEffectiveSpend(
  sprint: { start_date: string; end_date: string },
  channel: TrafficChannel,
  dailySpend: { date: string; channel: TrafficChannel; spend: number }[],
  overrides: SprintChannelSpendOverride[],
): number {
  const metaSpendSum = dailySpend
    .filter((d) => d.channel === channel && d.date >= sprint.start_date && d.date <= sprint.end_date)
    .reduce((sum, d) => sum + d.spend, 0);
  const override = overrides.find((o) => o.channel === channel);
  return resolveSprintChannelActualSpend(override, metaSpendSum);
}

/** Soma o gasto real efetivo de UM canal em várias sprints — a versão "por
 * canal" de `sumEffectiveSpend`, usada pra consolidar o realizado do mês de
 * uma única plataforma. */
export function sumChannelEffectiveSpend(
  sprints: { start_date: string; end_date: string }[],
  channel: TrafficChannel,
  dailySpend: { date: string; channel: TrafficChannel; spend: number }[],
  overrides: SprintChannelSpendOverride[],
): number {
  return sprints.reduce((sum, sprint) => sum + computeSprintChannelEffectiveSpend(sprint, channel, dailySpend, overrides), 0);
}

/**
 * Consolidado = soma coerente dos canais com dado (nunca inventa canal sem
 * `daily_spend`/override nenhum). Recebe a lista de canais que o cliente
 * de fato usa (inferida por quem tem `daily_spend` ou override registrado —
 * Etapa 2 não introduz nenhum campo de configuração "plataformas do
 * cliente"), nunca uma lista fixa de todos os canais possíveis.
 */
export function sumConsolidatedChannelEffectiveSpend(
  sprints: { start_date: string; end_date: string }[],
  channels: TrafficChannel[],
  dailySpend: { date: string; channel: TrafficChannel; spend: number }[],
  overrides: SprintChannelSpendOverride[],
): number {
  return channels.reduce((sum, channel) => sum + sumChannelEffectiveSpend(sprints, channel, dailySpend, overrides), 0);
}

/** Quais canais um cliente efetivamente usa, inferido pelos dados que já
 * existem (nunca por um campo de configuração) — `daily_spend` sincronizado
 * ou override manual em `sprint_channel_spend` contam como "usa este
 * canal". Usado pra nunca somar/exibir um canal vazio como se fosse "R$ 0
 * de investimento" (estado diferente de "canal não usado"). */
export function inferClientChannels(
  dailySpend: { channel: TrafficChannel }[],
  overrides: { channel: TrafficChannel }[],
): TrafficChannel[] {
  const set = new Set<TrafficChannel>();
  for (const d of dailySpend) set.add(d.channel);
  for (const o of overrides) set.add(o.channel);
  return Array.from(set);
}
