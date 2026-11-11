import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { DASHBOARD_METRIC_CATALOG, type DashboardMetricKey } from "./dashboard-metrics";
import type { ResolvedGoalPerformance } from "./dashboard-metrics-resolver";
import { resolveClientMetaMappingSource, listActiveMetricMappingsByGoal } from "./client-metric-mapping-source";
import { fetchSecondaryGoalsPerformance } from "./secondary-goal-performance";
import type { ClientGoal } from "./client-goals";
import type { PerformanceGoal } from "./performance-goals";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

export interface DashboardGoalPerformanceData {
  hasMetaAccount: boolean;
  goalsWithActiveMapping: Set<PerformanceGoal>;
  goals: Map<PerformanceGoal, ResolvedGoalPerformance>;
}

/**
 * Fase B — camada de leitura (Supabase-aware) pra ingrediente Resultado/
 * Eficiência do resolver puro (`dashboard-metrics-resolver.ts`). Único
 * ingrediente que esta Etapa precisa buscar de novo — Entrega/Alcance/erro
 * de sincronização já vêm prontos do que o Cockpit (`/clients/[id]`) já
 * calcula pra "Meta & Ritmo"/"Performance Meta Ads" (nenhuma segunda
 * consulta pra eles).
 *
 * Ponto 2 da Fase A ("marcar um Resultado aqui nunca exige uma linha de
 * objetivo"): QUALQUER chave marcada em "Métricas exibidas" é buscada da
 * MESMA forma — reaproveita `fetchSecondaryGoalsPerformance` (hoje escrita
 * só pra objetivos "secundários", mas genérica sobre qualquer `ClientGoal`,
 * nunca específica de cardinalidade) tratando TODO objetivo marcado como um
 * `ClientGoal`, real (quando o cliente já tem um configurado pra aquele
 * resultado, via Planejamento) ou sintético (quando não tem — isPrimary
 * sempre `false`, nunca lido/alterado aqui: Planejamento permanece intocado,
 * ponto 6/7 do pedido). `targetByGoal` vazio de propósito — meta mensal é
 * conceito exclusivo do Planejamento, nunca usado por "Métricas exibidas".
 */
export async function loadDashboardGoalPerformanceData(
  supabase: Supabase,
  clientId: string,
  keys: readonly DashboardMetricKey[],
  monthRange: { firstDay: string; lastDay: string },
  existingClientGoals: readonly ClientGoal[],
): Promise<DashboardGoalPerformanceData> {
  const neededGoals = new Set<PerformanceGoal>();
  for (const key of keys) {
    const goal = DASHBOARD_METRIC_CATALOG[key].dependsOnGoal;
    if (goal) neededGoals.add(goal);
  }

  if (neededGoals.size === 0) {
    return { hasMetaAccount: false, goalsWithActiveMapping: new Set(), goals: new Map() };
  }

  const mappingSource = await resolveClientMetaMappingSource(supabase, clientId);
  const hasMetaAccount = mappingSource !== null;
  const mappingsByGoal = mappingSource ? await listActiveMetricMappingsByGoal(supabase, mappingSource.importSourceId) : new Map();
  const goalsWithActiveMapping = new Set(mappingsByGoal.keys());

  // Só busca performance de quem TEM evento mapeado — sem mapeamento não há
  // linha nenhuma pra encontrar (o resolver já decide "sem_evento_configurado"
  // sem precisar de uma consulta vazia pra confirmar isso).
  const goalsToFetch: ClientGoal[] = Array.from(neededGoals)
    .filter((resultType) => goalsWithActiveMapping.has(resultType))
    .map((resultType) => {
      const existing = existingClientGoals.find((g) => g.resultType === resultType);
      return existing ?? { id: "", clientId, resultType, channels: [], isPrimary: false, resultSource: "automatic" };
    });

  const views = goalsToFetch.length > 0 ? await fetchSecondaryGoalsPerformance(supabase, clientId, goalsToFetch, monthRange, new Map()) : [];

  const goals = new Map<PerformanceGoal, ResolvedGoalPerformance>();
  for (const v of views) {
    goals.set(v.resultType, { resultCount: v.resultCount, costPerResult: v.costPerResult, costUnavailableReason: v.costUnavailableReason });
  }

  return { hasMetaAccount, goalsWithActiveMapping, goals };
}
