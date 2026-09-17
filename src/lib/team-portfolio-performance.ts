import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { loadClientOperationalStates } from "@/lib/client-operational-state-data";
import type { ClientOperationalState } from "@/lib/client-operational-state";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { shiftOperationMonth, monthRangeFromOperationParam } from "@/lib/operation-triage";
import { fetchAssignmentPeriodsForManager, type ClientManagerAssignmentPeriod } from "@/lib/client-manager-assignments";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Etapa "Equipe — Fase 3: Evolução Profissional e Performance da Carteira
 * Sob Responsabilidade" — camada de leitura pura + orquestração mínima.
 *
 * Princípio central (aprovado): performance NÃO é volume/investimento — é
 * CADA cliente comparado contra a PRÓPRIA meta, nunca uma média de CPAs
 * absolutos entre clientes diferentes, nunca um score/ranking. Este arquivo
 * nunca inventa uma severidade nova: `evaluatePortfolioClient` só LÊ
 * `state.evaluation.dimensions.cost` (Motor de Saúde, `account-health-engine.ts`,
 * já calculado por `loadClientOperationalStates`) e classifica o MOTIVO de
 * indisponibilidade quando aplicável — nunca recalcula desvio/severidade.
 *
 * Decisão de produto (Fase 3, aprovada): `performance_goal = "followers"`
 * fica FORA da avaliação nesta fase — não só com ressalva, INTEIRAMENTE fora
 * do numerador/denominador. Motivo: o pipeline hoje usado pelo Motor de
 * Saúde (`client-operational-state-data.ts`) divide o INVESTIMENTO
 * CONSOLIDADO (todos os canais) pelos novos seguidores, mesmo quando o
 * cliente também investe em Google — só `resolvePerformanceSummaryForGoal`
 * (Reports/Analytics, `instagram-metrics.ts`) escopa isso corretamente pra
 * só Meta Ads. Propagar essa imprecisão pra Equipe, mesmo com ressalva
 * textual, seria emprestar confiança a um número que já sabemos impreciso.
 * Não alteramos o motor de saúde pra resolver isso agora (fora do escopo
 * desta fase, decisão explícita) — só excluímos "followers" da avaliação
 * até existir uma leitura canônica confiável.
 *
 * Responsabilidade temporal (Fase 2): a leitura de CARTEIRA ATUAL continua
 * vindo de `clients.primary_manager_id` via `team-performance-data.ts` (a
 * Fase 2 garante que o período aberto de `client_manager_assignments` está
 * sempre sincronizado com ele — nenhuma segunda fonte pro estado atual,
 * nenhuma complexidade extra pra reconfirmar o presente). Este arquivo só
 * usa `client_manager_assignments` pra EVOLUÇÃO (leitura de meses
 * anteriores), onde `primary_manager_id` (só o gestor de HOJE) não serve.
 *
 * Evolução: mês a mês, só entra um cliente num mês M se o período de
 * responsabilidade cobrir O MÊS INTEIRO (`periodCoversFullMonth`) — mês com
 * troca de gestor no meio, ou responsabilidade parcial no início/fim, não
 * atribui a NENHUM dos dois gestores nesse mês (perde um ponto de dado,
 * nunca inventa uma fração). Mês sem nenhum cliente elegível simplesmente
 * não aparece na lista de pontos — nunca um "0/0" fabricado.
 */

export type PortfolioUnavailableReason =
  | "objetivo_nao_configurado"
  | "objetivo_nao_suportado"
  | "sem_meta"
  | "sem_dados"
  | "amostra_insuficiente"
  | "escopo_nao_comparavel";

export interface PortfolioClientEvaluation {
  clientId: string;
  clientName: string;
  performanceGoal: PerformanceGoal | null;
  costActual: number | null;
  costTarget: number | null;
  costMetricShortLabel: string | null;
  /** `(custoReal - meta) / meta` — negativo é melhor (custo abaixo da meta).
   * Sempre `null` quando `!evaluable` (nunca mostra uma distância pra um
   * cliente marcado como não avaliável, mesmo que o Motor de Saúde tenha
   * calculado algum valor internamente por outro motivo). */
  relativeDeviation: number | null;
  evaluable: boolean;
  /** Só significativo quando `evaluable`. */
  withinTarget: boolean | null;
  unavailableReason: PortfolioUnavailableReason | null;
}

export interface PortfolioPerformanceSummary {
  evaluableCount: number;
  withinTargetCount: number;
  outsideTargetCount: number;
  unavailableCount: number;
  clients: PortfolioClientEvaluation[];
}

const COST_SHORT_LABELS: Record<PerformanceGoal, string> = { leads: "CPL", sales: "CPA", followers: "Custo por novo seguidor" };

/** Objetivos avaliáveis contra meta nesta fase — única lista, nunca
 * reimplementada em mais de um lugar (ver decisão sobre "followers" no
 * comentário do topo do arquivo). */
const EVALUABLE_PERFORMANCE_GOALS: readonly PerformanceGoal[] = ["leads", "sales"];

/** Motivo textual de indisponibilidade — pra Interface nunca ter que
 * reimplementar esta cadeia de ifs. */
export function describePortfolioUnavailableReason(reason: PortfolioUnavailableReason): string {
  switch (reason) {
    case "objetivo_nao_configurado":
      return "Objetivo de performance não configurado";
    case "objetivo_nao_suportado":
      return "Objetivo ainda não avaliável nesta leitura";
    case "sem_meta":
      return "Meta de custo não definida";
    case "sem_dados":
      return "Sem dados de investimento ou performance no período";
    case "amostra_insuficiente":
      return "Amostra insuficiente para avaliar com confiança";
    case "escopo_nao_comparavel":
      return "Escopo de canal não comparável entre planejado e realizado";
  }
}

/**
 * Classifica UM cliente já resolvido pelo Motor de Saúde — pura, testável
 * sem Supabase. A ordem dos `if`s replica exatamente os branches de
 * `evaluateCost` (`account-health-engine.ts`): "sem meta"/"sem dados" são o
 * mesmo branch de curto-circuito lá (ambos com `hasReliableSample`/
 * `hasComparableScope` travados em `true`, sem significado nesse caso) — por
 * isso `cost.planned`/`cost.actual` são checados ANTES dos dois flags, nunca
 * depois (checar na ordem errada classificaria "sem meta" como "amostra
 * insuficiente").
 */
export function evaluatePortfolioClient(state: ClientOperationalState): PortfolioClientEvaluation {
  const cost = state.evaluation.dimensions.cost;
  const goal = state.performanceGoal;

  const base = {
    clientId: state.clientId,
    clientName: state.clientName,
    performanceGoal: goal,
    costActual: cost.actual,
    costTarget: cost.planned,
    costMetricShortLabel: goal ? COST_SHORT_LABELS[goal] : null,
  };

  const unavailable = (reason: PortfolioUnavailableReason): PortfolioClientEvaluation => ({
    ...base,
    relativeDeviation: null,
    evaluable: false,
    withinTarget: null,
    unavailableReason: reason,
  });

  if (!goal) return unavailable("objetivo_nao_configurado");
  if (!EVALUABLE_PERFORMANCE_GOALS.includes(goal)) return unavailable("objetivo_nao_suportado");
  if (cost.planned === null) return unavailable("sem_meta");
  if (cost.actual === null) return unavailable("sem_dados");
  if (!cost.hasReliableSample) return unavailable("amostra_insuficiente");
  if (!cost.hasComparableScope) return unavailable("escopo_nao_comparavel");

  return {
    ...base,
    relativeDeviation: cost.deviation,
    evaluable: true,
    withinTarget: cost.status === "nenhum",
    unavailableReason: null,
  };
}

/** Agrega uma lista já classificada — pura, testável isoladamente.
 * `unavailableCount` é sempre `clients.length - evaluableCount` (nunca um
 * segundo filtro que possa divergir). */
export function summarizePortfolioPerformance(clients: PortfolioClientEvaluation[]): PortfolioPerformanceSummary {
  const evaluable = clients.filter((c) => c.evaluable);
  return {
    evaluableCount: evaluable.length,
    withinTargetCount: evaluable.filter((c) => c.withinTarget).length,
    outsideTargetCount: evaluable.filter((c) => !c.withinTarget).length,
    unavailableCount: clients.length - evaluable.length,
    clients,
  };
}

function monthStartInstant(firstDay: string): string {
  return `${firstDay}T00:00:00.000Z`;
}

/** Instante EXCLUSIVO do fim do mês (00:00 do dia seguinte ao último dia) —
 * mesma convenção meio-aberta de `client-manager-assignments.ts`
 * (`isPeriodActiveAt`/`periodOverlapsRange`), nunca `23:59:59` aproximado. */
function monthEndExclusiveInstant(lastDay: string): string {
  const d = new Date(`${lastDay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/**
 * `true` só quando o período cobre o MÊS INTEIRO (do primeiro ao último
 * instante) — responsabilidade parcial no início, no fim, ou uma troca no
 * meio do mês (2 períodos, nenhum dos dois cobrindo o mês inteiro) sempre
 * devolve `false` pros dois gestores envolvidos. Pura, testável sem
 * Supabase.
 */
export function periodCoversFullMonth(period: ClientManagerAssignmentPeriod, monthRange: { firstDay: string; lastDay: string }): boolean {
  const monthStart = monthStartInstant(monthRange.firstDay);
  const monthEndExclusive = monthEndExclusiveInstant(monthRange.lastDay);
  const startsAtOrBeforeMonth = period.startedAt <= monthStart;
  const endsAtOrAfterMonth = period.endedAt === null || period.endedAt >= monthEndExclusive;
  return startsAtOrBeforeMonth && endsAtOrAfterMonth;
}

/** `clientId`s cobertos o mês inteiro por ESTE gestor (períodos já
 * filtrados por `fetchAssignmentPeriodsForManager`) — sem duplicados. */
export function resolveFullMonthCoverageClientIds(
  periods: ClientManagerAssignmentPeriod[],
  monthRange: { firstDay: string; lastDay: string },
): string[] {
  const ids = new Set<string>();
  for (const period of periods) {
    if (periodCoversFullMonth(period, monthRange)) ids.add(period.clientId);
  }
  return Array.from(ids);
}

/** Quantos meses pra trás a Evolução olha, a partir do mês de referência
 * (normalmente o mês corrente exibido na tela) — meses sem nenhum cliente
 * elegível são descartados depois, nunca contam como "tentativa vazia"
 * visível. */
const EVOLUTION_MONTHS_BACK = 6;

/** Lista de `monthParam` ("YYYY-MM-01") do mais antigo ao mais recente —
 * pura, nunca sabe se algum desses meses tem dado elegível (isso é decidido
 * depois, cliente a cliente, por `resolveFullMonthCoverageClientIds`). */
export function resolveEvolutionMonthParams(referenceMonthParam: string, monthsBack: number = EVOLUTION_MONTHS_BACK): string[] {
  const params: string[] = [];
  for (let delta = -monthsBack; delta <= 0; delta++) {
    params.push(shiftOperationMonth(referenceMonthParam, delta));
  }
  return params;
}

export interface ManagerPortfolioEvolutionPoint {
  monthParam: string;
  summary: PortfolioPerformanceSummary;
}

/**
 * Evolução mês a mês de UM gestor — só meses com ≥1 cliente sob
 * responsabilidade INTEIRA daquele mês entram no resultado (nunca um ponto
 * "0/0"). Como `client_manager_assignments` só existe a partir do deploy da
 * Fase 2, meses anteriores a isso nunca têm período nenhum cobrindo o mês
 * inteiro — o resultado nasce vazio até o primeiro mês inteiro sob o mesmo
 * gestor se completar (não é um bug, é a garantia de "nunca fabricar
 * setembro/2026", ver comentário do topo do arquivo).
 *
 * Reaproveita `loadClientOperationalStates(mês)` — a MESMA pipeline mensal
 * já usada por Operação/Home/`/team` — uma vez por mês elegível, nunca uma
 * segunda implementação do cálculo de custo/meta.
 */
export async function loadManagerPortfolioEvolution(
  supabase: Supabase,
  managerId: string,
  referenceMonthParam: string,
): Promise<ManagerPortfolioEvolutionPoint[]> {
  const periods = await fetchAssignmentPeriodsForManager(supabase, managerId);
  if (periods.length === 0) return [];

  const points: ManagerPortfolioEvolutionPoint[] = [];
  for (const monthParam of resolveEvolutionMonthParams(referenceMonthParam)) {
    const monthRange = monthRangeFromOperationParam(monthParam);
    const coverageClientIds = resolveFullMonthCoverageClientIds(periods, monthRange);
    if (coverageClientIds.length === 0) continue;

    const coverageSet = new Set(coverageClientIds);
    const states = await loadClientOperationalStates(supabase, monthParam);
    const evaluations = states.filter((state) => coverageSet.has(state.clientId)).map(evaluatePortfolioClient);
    points.push({ monthParam, summary: summarizePortfolioPerformance(evaluations) });
  }
  return points;
}
