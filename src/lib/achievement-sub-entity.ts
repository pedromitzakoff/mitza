import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";
import { safeDivide } from "@/lib/performance";
import { aggregateWindow, windowSampleIsValid, type ClientDailyPoint, type WindowAggregate } from "@/lib/achievement-sample";
import {
  SUB_ENTITY_DESTAQUE_MIN_ADVANTAGE_PCT,
  SUB_ENTITY_MIN_COMPARABLE_ENTITIES,
  SUB_ENTITY_WINDOW_SAMPLE_POLICY,
} from "@/lib/achievement-thresholds";

/**
 * Núcleo puro de "Conquistas por Granularidade" (Campanha/Público/Criativo)
 * — nada de I/O aqui, mesmo espírito de `achievement-sample.ts` (nível
 * conta). Deliberadamente reaproveita `aggregateWindow`/`windowSampleIsValid`
 * em vez de reimplementar: cada linha diária de uma entidade (campanha/ad
 * set/criativo) vira um `ClientDailyPoint` com `dataPresent: true` — a
 * ausência de linha num dia é sempre um ZERO legítimo aqui (a entidade
 * simplesmente não rodou aquele dia), nunca uma lacuna de sincronização,
 * porque o motor só chega a este arquivo depois do CLIENTE inteiro já ter
 * passado no gate de confiança de sync (`achievement-engine.ts`) — essa
 * garantia é resolvida uma vez, no nível conta, nunca duplicada aqui.
 *
 * `channel` é `null` só pra Criativo (Meta-only, `ad_creative_daily_metrics`
 * não tem coluna de canal — ver `supabase/creative-analytics.sql`).
 */

export interface SubEntityDailyRow {
  date: string;
  channel: TrafficChannel | null;
  name: string;
  resultType: PerformanceGoal | null;
  spend: number;
  resultCount: number | null;
  revenue: number | null;
}

export interface SubEntitySummary {
  /** `channel::name`, ou só `name` pra Criativo — mesma identidade analítica
   * já usada por `campaign-analytics.ts`/`ad-set-analytics.ts` (canal +
   * nome: Meta e Google podem ter campanhas/públicos homônimos). */
  key: string;
  channel: TrafficChannel | null;
  name: string;
  agg: WindowAggregate;
}

function entityKey(channel: TrafficChannel | null, name: string): string {
  return channel ? `${channel}::${name}` : name;
}

/** Agrupa linhas diárias (já recortadas pro período pelo chamador) por
 * entidade, somando linhas do MESMO dia (defesa contra o caso raro de mais
 * de uma fonte escrevendo a mesma entidade+dia) antes de virar
 * `ClientDailyPoint[]` — só então `aggregateWindow` (reaproveitado, nunca
 * reimplementado) calcula CPA/spend/resultCount/daysWithData. Só soma
 * `resultCount` de linhas cujo `resultType` bate com o objetivo PRINCIPAL do
 * cliente — mesma regra de "só objetivo principal" já usada por todo o
 * resto do motor (`achievement-metrics.ts`). */
export function summarizeSubEntities(rows: SubEntityDailyRow[], primaryGoal: PerformanceGoal | null): SubEntitySummary[] {
  const byKey = new Map<string, { channel: TrafficChannel | null; name: string; byDate: Map<string, { spend: number; resultCount: number; revenue: number | null }> }>();

  for (const row of rows) {
    const key = entityKey(row.channel, row.name);
    const bucket = byKey.get(key) ?? { channel: row.channel, name: row.name, byDate: new Map() };
    const existing = bucket.byDate.get(row.date) ?? { spend: 0, resultCount: 0, revenue: null as number | null };
    existing.spend += row.spend;
    if (row.resultType && primaryGoal && row.resultType === primaryGoal) existing.resultCount += row.resultCount ?? 0;
    if (row.revenue !== null) existing.revenue = (existing.revenue ?? 0) + row.revenue;
    bucket.byDate.set(row.date, existing);
    byKey.set(key, bucket);
  }

  return Array.from(byKey.entries()).map(([key, bucket]) => {
    const points: ClientDailyPoint[] = Array.from(bucket.byDate.entries()).map(([date, v]) => ({ date, dataPresent: true, ...v }));
    return { key, channel: bucket.channel, name: bucket.name, agg: aggregateWindow(points) };
  });
}

export interface SubEntityRestAggregate {
  spend: number;
  resultCount: number;
  revenue: number | null;
  cpa: number;
}

export interface SubEntityDestaqueResult {
  winner: SubEntitySummary;
  /** Agregado de TODAS as demais entidades válidas (nunca só a segunda
   * colocada) — a vantagem da destaque é medida contra o grupo inteiro, não
   * contra um único concorrente isolado (revisão pós-aprovação: mudar de
   * líder por uma diferença irrelevante contra a 2ª colocada não deveria
   * bastar). */
  rest: SubEntityRestAggregate;
  /** `(rest.cpa − winner.cpa) / rest.cpa` — quanto a destaque é mais barata
   * que o conjunto das demais. Sempre `>= SUB_ENTITY_DESTAQUE_MIN_ADVANTAGE_PCT`
   * quando este resultado existe (o piso já foi aplicado dentro de
   * `findSubEntityDestaque`). */
  advantagePct: number;
}

/** "Destaque" — a entidade de MENOR CPA/CPL entre as que passam na amostra
 * mínima (`SUB_ENTITY_WINDOW_SAMPLE_POLICY`), exigindo pelo menos
 * `SUB_ENTITY_MIN_COMPARABLE_ENTITIES` concorrentes válidas no MESMO
 * período — nunca "melhor" sem concorrência real (seção 5 do pedido: nunca
 * chamar de "melhor" uma entidade que teve amostra irrelevante OU que não
 * tinha ninguém comparável pra perder).
 *
 * Revisão pós-aprovação: mudar de líder (menor CPA hoje vs. ontem) nunca é
 * suficiente sozinho — diferenças de ranking podem ser irrelevantes.
 * "Destaque" agora exige uma vantagem MATERIAL: o CPA da entidade precisa
 * ser pelo menos `SUB_ENTITY_DESTAQUE_MIN_ADVANTAGE_PCT` menor que o CPA
 * AGREGADO de todas as demais entidades válidas (nunca só a 2ª colocada
 * isolada — um grupo inteiro de concorrentes é uma base de comparação mais
 * confiável que um único rival). */
export function findSubEntityDestaque(summaries: SubEntitySummary[]): SubEntityDestaqueResult | null {
  const valid = summaries.filter((s) => windowSampleIsValid(s.agg, SUB_ENTITY_WINDOW_SAMPLE_POLICY) && s.agg.cpa !== null);
  if (valid.length < SUB_ENTITY_MIN_COMPARABLE_ENTITIES) return null;

  const sorted = [...valid].sort((a, b) => (a.agg.cpa as number) - (b.agg.cpa as number));
  const winner = sorted[0];
  const others = sorted.slice(1);

  const restSpend = others.reduce((sum, s) => sum + s.agg.spend, 0);
  const restResultCount = others.reduce((sum, s) => sum + s.agg.resultCount, 0);
  const restRevenueEntries = others.filter((s) => s.agg.revenue !== null);
  const restRevenue = restRevenueEntries.length > 0 ? restRevenueEntries.reduce((sum, s) => sum + (s.agg.revenue ?? 0), 0) : null;
  const restCpa = safeDivide(restSpend, restResultCount);
  if (restCpa === null || restCpa === 0) return null;

  const winnerCpa = winner.agg.cpa as number;
  const advantagePct = (restCpa - winnerCpa) / restCpa;
  if (advantagePct < SUB_ENTITY_DESTAQUE_MIN_ADVANTAGE_PCT) return null;

  return { winner, rest: { spend: restSpend, resultCount: restResultCount, revenue: restRevenue, cpa: restCpa }, advantagePct };
}

export interface SubEntityEvolutionResult {
  current: SubEntitySummary;
  previous: SubEntitySummary;
  improvementPct: number;
}

/** Melhora de CPA/CPL de UMA entidade vs. o período imediatamente anterior
 * de mesma duração — mesma regra 7d/7d-anterior do nível conta
 * (`ruleEvolutionCpaImproved`), aplicada por entidade. Ambas as pernas
 * validam amostra independentemente (mesmo princípio já aprovado pro nível
 * conta). Devolve só as entidades que cruzaram o limiar — o chamador decide
 * qual (ou quais) virar candidato. */
export function evaluateSubEntityEvolution(
  currentSummaries: SubEntitySummary[],
  previousSummaries: SubEntitySummary[],
  minImprovementPct: number,
): SubEntityEvolutionResult[] {
  const previousByKey = new Map(previousSummaries.map((s) => [s.key, s]));
  const results: SubEntityEvolutionResult[] = [];

  for (const current of currentSummaries) {
    if (!windowSampleIsValid(current.agg, SUB_ENTITY_WINDOW_SAMPLE_POLICY) || current.agg.cpa === null) continue;
    const previous = previousByKey.get(current.key);
    if (!previous) continue;
    if (!windowSampleIsValid(previous.agg, SUB_ENTITY_WINDOW_SAMPLE_POLICY) || previous.agg.cpa === null || previous.agg.cpa === 0) continue;

    const improvementPct = (previous.agg.cpa - current.agg.cpa) / previous.agg.cpa;
    if (improvementPct >= minImprovementPct) results.push({ current, previous, improvementPct });
  }

  return results;
}
