import { safeDivide, computeRoas } from "@/lib/performance";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * Objeto canônico de métricas por canal da plataforma (Etapa "Arquitetura
 * Multicanal Unificada") — Planejado e Realizado (e qualquer domínio futuro
 * que precise de "investimento/resultado por canal, com consolidado sempre
 * derivado") usam exatamente este tipo. Nenhuma tela monta seu próprio
 * formato de "resumo por canal" a partir daqui em diante.
 *
 * Regra central, nunca violada por nenhum consumidor: só existem métricas
 * ADITIVAS de verdade — `investment`, `resultCount`, `revenue`. Tudo o mais
 * (`cpa`, `roas`) é DERIVADO — nunca somado entre canais, nunca armazenado
 * em coluna nenhuma (planejada, realizada, por canal ou consolidada),
 * sempre recalculado a partir dos totais já resolvidos.
 */
export interface ChannelMetrics {
  /** `null` = este canal não tem investimento resolvido pro escopo (nunca
   * `0` fabricado). */
  investment: number | null;
  /** `null` = sem nenhum registro pro escopo (distinto de "existe registro,
   * resultado é 0"). */
  resultCount: number | null;
  /** Ausente (`undefined`, nunca a chave presente) em domínios que não têm
   * noção de receita (ex.: Planejado, nesta etapa) — presente como `number |
   * null` em domínios que têm (Realizado). */
  revenue?: number | null;
  /** `investment ÷ resultCount` — sempre recalculado aqui, nunca lido de
   * lugar nenhum. `null` quando faltar qualquer um dos dois lados ou
   * `resultCount` for `0` (nunca `NaN`/`Infinity`, via `safeDivide`). */
  cpa: number | null;
  /** `revenue ÷ investment` — mesma regra de ausência de `revenue` acima:
   * só presente quando o domínio rastreia receita. */
  roas?: number | null;
}

export interface ClientChannelMetrics {
  /** Só os canais que de fato têm dado pro escopo — nunca uma lista fixa de
   * todos os canais possíveis (mesma regra de `inferClientChannels`,
   * lib/channel-spend.ts). */
  byChannel: Partial<Record<TrafficChannel, ChannelMetrics>>;
  /** SEMPRE calculado a partir de `byChannel` (`consolidateChannelMetrics`,
   * abaixo) — nunca uma segunda fonte, nunca persistido em lugar nenhum. */
  consolidated: ChannelMetrics;
}

/**
 * Único combinador aditivo da plataforma — soma um valor (investimento,
 * resultado, receita) entre canais. `null` só quando NENHUM canal tiver
 * dado pro escopo; um canal sem dado nunca conta como `0` na soma (mesma
 * regra já usada por `resolveManualActualSpend`/`aggregatePerformanceResults`
 * antes desta etapa — este combinador existe pra nenhum domínio futuro
 * reimplementar essa regra por conta própria).
 */
export function consolidateAdditive(
  channels: TrafficChannel[],
  resolveForChannel: (channel: TrafficChannel) => number | null,
): number | null {
  const values = channels.map(resolveForChannel).filter((v): v is number => v !== null);
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) : null;
}

/**
 * Monta o `consolidated` de um `ClientChannelMetrics` a partir do `byChannel` já
 * resolvido — único lugar da plataforma que decide como consolidar:
 * `investment`/`resultCount`/`revenue` somados via `consolidateAdditive`;
 * `cpa`/`roas` SEMPRE derivados dos totais já somados (nunca média/soma dos
 * `cpa`/`roas` de cada canal — matematicamente a única forma correta de
 * combinar uma métrica derivada). Reaproveita `safeDivide`/`computeRoas`
 * (lib/performance.ts) — a mesma fórmula de CPA/ROAS realizado, nunca uma
 * segunda implementação da divisão pro lado planejado/consolidado.
 *
 * `revenue`/`roas` só entram no consolidado quando pelo menos um canal do
 * `byChannel` tiver a CHAVE `revenue` presente (mesmo que `null`) — domínios
 * sem noção de receita (Planejado, nesta etapa) nunca ganham um `revenue`/
 * `roas` fabricado no consolidado.
 */
export function consolidateChannelMetrics(
  channels: TrafficChannel[],
  byChannel: Partial<Record<TrafficChannel, ChannelMetrics>>,
): ChannelMetrics {
  const investment = consolidateAdditive(channels, (c) => byChannel[c]?.investment ?? null);
  const resultCount = consolidateAdditive(channels, (c) => byChannel[c]?.resultCount ?? null);
  const tracksRevenue = channels.some((c) => byChannel[c]?.revenue !== undefined);
  const revenue = tracksRevenue ? consolidateAdditive(channels, (c) => byChannel[c]?.revenue ?? null) : undefined;

  return {
    investment,
    resultCount,
    revenue,
    cpa: safeDivide(investment, resultCount),
    roas: tracksRevenue ? computeRoas(revenue ?? null, investment) : undefined,
  };
}

/** Canais com investimento planejado/realizado de verdade dentro de um
 * `byChannel` — nunca os canais "considerados mas sem plano" que
 * `resolveClientMonthlyPlan` preenche com `{investment: null, ...}` (essa
 * entrada existe pra nunca omitir o canal da estrutura, não significa que
 * ele tem plano — ver `resolveClientMonthlyPlan`, client-plan.ts). Mesma
 * regra serve pro lado realizado (`resolveClientMonthlyActuals`): lá todo
 * canal presente já tem `investment` resolvido como número (nunca `null`),
 * então o filtro é um no-op nesse lado — um único critério funciona pros
 * dois formatos. */
function channelsWithData(byChannel: Partial<Record<TrafficChannel, ChannelMetrics>>): TrafficChannel[] {
  return (Object.keys(byChannel) as TrafficChannel[])
    .filter((channel) => byChannel[channel]?.investment !== null && byChannel[channel]?.investment !== undefined)
    .sort();
}

export interface ChannelScopeComparison {
  /** Canais com plano de verdade (nunca os "considerados mas sem plano"). */
  plannedChannels: TrafficChannel[];
  /** Canais com investimento ou resultado real neste mês. */
  actualChannels: TrafficChannel[];
  /** `true` só quando os dois conjuntos acima são EXATAMENTE iguais — nunca
   * um subconjunto do outro. Responde à pergunta central da Auditoria de
   * Comparabilidade de Escopo de Custo: o CPA planejado e o CPA realizado
   * somam exatamente os mesmos canais? Quando `false`, comparar os dois
   * consolidados como "desvio da meta" mistura universos diferentes — ver
   * `account-health-engine.ts`, `evaluateCost`, campo `costScopeComparable`
   * de `AccountHealthInput`. */
  scopesMatch: boolean;
}

/**
 * Núcleo puro e compartilhável (Etapa "Comparabilidade de Escopo de
 * Custo") — responde só à pergunta "estes dois `byChannel` (planejado e
 * realizado) representam o mesmo conjunto de canais?", sem saber nada de
 * CPA/meta/severidade. Reaproveitada por `client-operational-state-data.ts`
 * (Motor de Saúde) e pelo recorte por canal do Dashboard — nunca uma
 * segunda implementação manual de "quais canais existem": os dois lados
 * já vêm de `resolveClientMonthlyPlan(...).byChannel`/
 * `resolveClientMonthlyActuals(...).byChannel`, os mesmos resolvedores que
 * a Auditoria de Comparabilidade de Escopo de Custo confirmou já existirem.
 */
export function resolveChannelScopeComparison(
  plannedByChannel: Partial<Record<TrafficChannel, ChannelMetrics>>,
  actualByChannel: Partial<Record<TrafficChannel, ChannelMetrics>>,
): ChannelScopeComparison {
  const plannedChannels = channelsWithData(plannedByChannel);
  const actualChannels = channelsWithData(actualByChannel);
  const scopesMatch =
    plannedChannels.length === actualChannels.length && plannedChannels.every((channel, index) => channel === actualChannels[index]);
  return { plannedChannels, actualChannels, scopesMatch };
}

/**
 * Regra completa de comparabilidade — o que `client-operational-state-data.ts`
 * de fato usa pra decidir `costScopeComparable`, nunca o ternário
 * embutido/duplicado ali. Isola o caso auditado com cuidado (Etapa
 * "Comparabilidade de Escopo de Custo", Parte 3, "fallback legítimo"):
 * quando NENHUM canal tem plano, a meta de custo usada é sempre o campo
 * permanente do cliente (`clients.target_cost_per_result`) — uma meta
 * GLOBAL, que nunca teve escopo de canal pra começar. Comparar essa meta
 * contra o realizado consolidado é exatamente o que ela sempre foi feita
 * pra fazer; não é um "escopo divergente" só porque nenhum canal específico
 * a originou. `consolidatedTargetCameFromChannelPlan` (`= consolidatedPlan.cpa
 * !== null` em quem chama) é o único jeito de saber isso sem adivinhar —
 * `resolveChannelScopeComparison` sozinho não distingue "meta é global de
 * propósito" de "meta é de canal e só não bate hoje", porque ele só vê os
 * dois `byChannel`, nunca de onde `costPlanned` veio.
 */
export function resolveCostScopeComparability(
  consolidatedTargetCameFromChannelPlan: boolean,
  plannedByChannel: Partial<Record<TrafficChannel, ChannelMetrics>>,
  actualByChannel: Partial<Record<TrafficChannel, ChannelMetrics>>,
): boolean {
  if (!consolidatedTargetCameFromChannelPlan) return true;
  return resolveChannelScopeComparison(plannedByChannel, actualByChannel).scopesMatch;
}
