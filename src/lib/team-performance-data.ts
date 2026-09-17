import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { loadClientOperationalStates } from "@/lib/client-operational-state-data";
import type { ClientOperationalState } from "@/lib/client-operational-state";
import { monthRangeFromOperationParam } from "@/lib/operation-triage";
import { resolveClientMediaChannels, TRAFFIC_CHANNELS } from "@/lib/traffic-channels";
import { fetchAchievements, type AchievementRow } from "@/lib/achievements-data";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { fetchAssignmentPeriodsForManager } from "@/lib/client-manager-assignments";
import {
  evaluatePortfolioClient,
  summarizePortfolioPerformance,
  type PortfolioPerformanceSummary,
} from "@/lib/team-portfolio-performance";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Camada de dados do "Perfil Profissional" (Equipe, Fase 1) — resolve
 * `team_members` → carteira atual → métricas do período → performance
 * relativa à meta do próprio cliente → atuação registrada → conquistas já
 * atribuíveis com segurança. Nenhum cálculo financeiro/de performance é
 * refeito aqui: tudo vem de `loadClientOperationalStates`
 * (`lib/client-operational-state-data.ts`, a MESMA pipeline que já alimenta
 * a Home/Operação/página do cliente) e de leituras diretas de
 * `operational_events` seguindo exatamente a mesma convenção de atribuição
 * por ator já usada por `lib/achievement-metrics.ts` (`account_review_recorded`/
 * `account_optimization_recorded`/`client_report_sent`/`meeting_completed`,
 * sempre por `actor_team_member_id`).
 *
 * Auditoria de atribuição histórica (Fase 1, ver relatório da etapa):
 * - CARTEIRA (`clients.primary_manager_id`) é CONFIÁVEL SÓ NO ESTADO ATUAL —
 *   não existe tabela de histórico/auditoria de troca de gestor no schema, e
 *   os eventos `client_manager_assigned`/`client_manager_changed`
 *   (`operational_events`, existentes desde a Etapa 56) só cobrem trocas
 *   ocorridas DEPOIS que esse rastreamento passou a existir — não uma
 *   reconstrução completa. Por isso esta camada NUNCA soma investimento
 *   histórico da carteira atual; só o investimento do PERÍODO selecionado,
 *   com um aviso pontual por cliente quando o próprio evento de troca
 *   aconteceu DENTRO desse período (ver `assignedWithinPeriodAt` abaixo).
 * - ATUAÇÃO (otimizações/reports/reuniões) é CONFIÁVEL HISTORICAMENTE — cada
 *   evento tem `actor_team_member_id` + `occurred_at` reais, gravados no
 *   momento em que a ação aconteceu, numa tabela append-only (sem policy de
 *   update/delete) — nunca depende de quem gerencia o cliente HOJE.
 * - CONQUISTAS: só `scope = "person"` são atribuíveis com segurança (têm
 *   `actor_team_member_id` real). `scope = "client"` NUNCA é mostrado aqui —
 *   não tem ator gravado, e inferir via `primary_manager_id` atual
 *   contaminaria o perfil com "current state" disfarçado de conquista
 *   histórica (exatamente o erro que esta fase quer evitar).
 */

const ACTIVITY_EVENT_TYPES = ["account_optimization_recorded", "client_report_sent", "meeting_completed"] as const;
type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export interface TeamMemberActivityCounts {
  /** `account_optimization_recorded` — mudanças concretas registradas numa
   * Análise da Conta (`account_optimizations`), nunca a contagem de
   * Análises em si (`account_review_recorded`, um conceito relacionado mas
   * diferente — uma Análise pode ter 0, 1 ou várias otimizações). */
  optimizations: number;
  /** `client_report_sent` — report marcado como enviado ao cliente
   * (`client_reports`). `monthly_reports` (fluxo de status em `/reports`)
   * é um sistema PARALELO e deliberadamente não usado aqui nesta fase (ver
   * relatório da etapa). */
  reportsSent: number;
  /** `meeting_completed` — tarefa do tipo "reunião" concluída. Nunca somado
   * com `task_completed` do mesmo evento (mesma ação, dois event_types
   * correlacionados na mesma transação — contar os dois duplicaria). */
  meetings: number;
}

export interface TeamMemberPortfolioClient {
  clientId: string;
  clientName: string;
  performanceGoal: PerformanceGoal | null;
  /** "Meta Ads"/"Meta + Google" — `clients.media_channels`, mesma fonte
   * única de sempre (`resolveClientMediaChannels`). */
  channelsLabel: string;
  investmentActual: number;
  costActual: number | null;
  costTarget: number | null;
  costMetricShortLabel: string | null;
  /** `true` só quando o desvio de custo é uma leitura válida (amostra
   * confiável + escopo de canal comparável + meta configurada) — mesmos 2
   * flags que o Motor de Saúde já calcula (`evaluation.dimensions.cost`),
   * nenhum novo. `false` = "sem dado comparável ainda", nunca tratado como
   * "fora da meta". */
  costComparable: boolean;
  /** Só significativo quando `costComparable`. `true` = custo na meta ou
   * melhor (`status === "nenhum"` no Motor de Saúde — desvio ruim é só
   * ACIMA da meta). */
  costWithinOrAboveTarget: boolean | null;
  /** Data (YYYY-MM-DD) em que este gestor assumiu o cliente, só quando esse
   * evento de troca aconteceu DENTRO do período selecionado — sinaliza que
   * o investimento do período não corresponde ao mês inteiro sob esta
   * gestão. `null` = sem evento de troca neste período (assume-se que já
   * era o gestor desde antes; não é uma prova de posse desde sempre, só a
   * ausência de um evento de troca RECENTE). */
  assignedWithinPeriodAt: string | null;
}

export interface TeamMemberPortfolioSummary {
  clientCount: number;
  /** Soma do investimento realizado no período pelos clientes da carteira
   * ATUAL — nunca um total histórico (ver auditoria no topo do arquivo). */
  investmentActual: number;
  clients: TeamMemberPortfolioClient[];
  /** Denominador de "performance da carteira" — só os clientes com custo
   * COMPARÁVEL (`costComparable`); nunca a carteira inteira disfarçada de
   * "avaliada". */
  comparableCount: number;
  /** Numerador: dentro desse subconjunto comparável, quantos estão na meta
   * de custo ou melhor. */
  withinOrAboveTargetCount: number;
}

export interface TeamMemberProfile {
  teamMemberId: string;
  name: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  status: "ativo" | "inativo";
  portfolio: TeamMemberPortfolioSummary;
  /** Etapa "Equipe — Fase 3": cada cliente da carteira ATUAL (mesmo
   * agrupamento de `portfolio`, `clients.primary_manager_id` — nunca uma
   * segunda fonte pro presente, ver `lib/team-portfolio-performance.ts`)
   * avaliado CONTRA A PRÓPRIA META, nunca por volume/investimento. Objeto
   * irmão de `portfolio` (não substitui — `portfolio.comparableCount`/
   * `withinOrAboveTargetCount`, Fase 1, continuam existindo e alimentando a
   * seção "Carteira atual"; este campo alimenta "Performance da carteira
   * atual", com motivo textual por cliente quando não avaliável). */
  portfolioPerformance: PortfolioPerformanceSummary;
  activityInPeriod: TeamMemberActivityCounts;
  /** All-time (sem filtro de data) — seguro pra "atuação" (ver auditoria),
   * nunca pra investimento. */
  activityAllTime: TeamMemberActivityCounts;
  /** Só `scope: "person"` — ver auditoria no topo do arquivo sobre por que
   * conquistas de cliente nunca entram aqui. */
  achievements: AchievementRow[];
}

export function emptyActivityCounts(): TeamMemberActivityCounts {
  return { optimizations: 0, reportsSent: 0, meetings: 0 };
}

/**
 * Agrupa eventos de atuação por ator — exportada (Etapa "Equipe — Perfil
 * Profissional") pra ser testável sem Supabase (`scripts/test-team-performance-data.ts`).
 * Só reconhece os 3 `event_type` de `ACTIVITY_EVENT_TYPES`; qualquer outro
 * (`account_review_recorded`, `task_completed`, etc.) é ignorado — é assim
 * que `account_optimization_recorded` nunca é somado duas vezes com o
 * `account_review_recorded` da MESMA análise (dois eventos distintos, só um
 * deles conta como "otimização").
 */
export function countByActor(rows: { actor_team_member_id: string | null; event_type: string }[]): Map<string, TeamMemberActivityCounts> {
  const byActor = new Map<string, TeamMemberActivityCounts>();
  for (const row of rows) {
    if (!row.actor_team_member_id) continue;
    const eventType = row.event_type as ActivityEventType;
    if (!ACTIVITY_EVENT_TYPES.includes(eventType)) continue;
    const counts = byActor.get(row.actor_team_member_id) ?? emptyActivityCounts();
    if (eventType === "account_optimization_recorded") counts.optimizations++;
    else if (eventType === "client_report_sent") counts.reportsSent++;
    else if (eventType === "meeting_completed") counts.meetings++;
    byActor.set(row.actor_team_member_id, counts);
  }
  return byActor;
}

/**
 * Constrói a leitura de UM cliente na carteira de um gestor a partir do
 * `ClientOperationalState` já calculado (`evaluation.dimensions.cost`/
 * `.investment`, Motor de Saúde — nenhum cálculo novo aqui). Exportada pra
 * ser testável isoladamente: prova que uma conta sem meta/amostra/escopo
 * comparável nunca é tratada como "fora da meta" (`costComparable: false`,
 * `costWithinOrAboveTarget: null` — nunca `false`).
 */
export function buildPortfolioClient(
  state: ClientOperationalState,
  mediaChannels: string[] | null | undefined,
  managerId: string,
  managerChange: { at: string; newManagerId: string | null } | undefined,
): TeamMemberPortfolioClient {
  const cost = state.evaluation.dimensions.cost;
  const costComparable = cost.hasReliableSample && cost.hasComparableScope && cost.planned !== null;
  const channels = resolveClientMediaChannels(mediaChannels);

  return {
    clientId: state.clientId,
    clientName: state.clientName,
    performanceGoal: state.performanceGoal,
    channelsLabel: channels.map((channel) => TRAFFIC_CHANNELS[channel].label).join(" + "),
    investmentActual: state.evaluation.dimensions.investment.actual,
    costActual: cost.actual,
    costTarget: cost.planned,
    costMetricShortLabel: state.performanceGoal ? costShortLabel(state.performanceGoal) : null,
    costComparable,
    costWithinOrAboveTarget: costComparable ? cost.status === "nenhum" : null,
    assignedWithinPeriodAt: managerChange && managerChange.newManagerId === managerId ? managerChange.at : null,
  };
}

/** Agrega a lista de clientes de uma carteira em `TeamMemberPortfolioSummary`
 * — `comparableCount`/`withinOrAboveTargetCount` nunca incluem clientes com
 * `costComparable: false` (ver `buildPortfolioClient`), nem no numerador
 * nem no denominador. Exportada pra ser testável isoladamente. */
export function summarizePortfolio(clients: TeamMemberPortfolioClient[]): TeamMemberPortfolioSummary {
  const comparableClients = clients.filter((c) => c.costComparable);
  return {
    clientCount: clients.length,
    investmentActual: clients.reduce((sum, c) => sum + c.investmentActual, 0),
    clients,
    comparableCount: comparableClients.length,
    withinOrAboveTargetCount: comparableClients.filter((c) => c.costWithinOrAboveTarget).length,
  };
}

/**
 * Perfis profissionais de TODOS os membros ativos, pro período informado —
 * `monthParam` no mesmo formato "YYYY-MM-01" já usado pela Operação
 * (`monthRangeFromOperationParam`). Uma única passada por
 * `loadClientOperationalStates` (nunca uma chamada por membro) — o
 * agrupamento por gestor é feito em memória a partir do resultado.
 */
export async function loadTeamMemberProfiles(
  supabase: Supabase,
  organizationId: string,
  monthParam: string,
): Promise<TeamMemberProfile[]> {
  const monthRange = monthRangeFromOperationParam(monthParam);
  const periodStart = `${monthRange.firstDay}T00:00:00Z`;
  const periodEnd = `${monthRange.lastDay}T23:59:59.999Z`;

  const [members, clientOperationalStates, mediaChannelRows, activityInPeriodRows, activityAllTimeRows, managerChangeRows, personAchievements] =
    await Promise.all([
      requireQuery(
        supabase
          .from("team_members")
          .select("id, name, job_title, avatar_url, status")
          .eq("organization_id", organizationId)
          .eq("status", "ativo")
          .order("name"),
        "team_members",
      ),
      loadClientOperationalStates(supabase, monthRange.firstDay),
      requireQuery(
        supabase
          .from("clients")
          .select("id, media_channels")
          .is("deleted_at", null)
          .eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS),
        "clients:media_channels",
      ),
      requireQuery(
        supabase
          .from("operational_events")
          .select("actor_team_member_id, event_type")
          .eq("organization_id", organizationId)
          .in("event_type", ACTIVITY_EVENT_TYPES)
          .gte("occurred_at", periodStart)
          .lte("occurred_at", periodEnd),
        "operational_events:activity-period",
      ),
      requireQuery(
        supabase
          .from("operational_events")
          .select("actor_team_member_id, event_type")
          .eq("organization_id", organizationId)
          .in("event_type", ACTIVITY_EVENT_TYPES),
        "operational_events:activity-all-time",
      ),
      // Etapa "Equipe — Perfil Profissional": só pra sinalizar, por cliente,
      // quando a troca pro gestor ATUAL aconteceu dentro do período
      // selecionado (ver `assignedWithinPeriodAt`) — nunca uma
      // reconstrução completa de histórico.
      requireQuery(
        supabase
          .from("operational_events")
          .select("client_id, occurred_at, metadata")
          .eq("organization_id", organizationId)
          .in("event_type", ["client_manager_assigned", "client_manager_changed"])
          .gte("occurred_at", periodStart)
          .lte("occurred_at", periodEnd)
          .order("occurred_at", { ascending: false }),
        "operational_events:manager-change",
      ),
      fetchAchievements(supabase, organizationId, { scope: "person" }, 0, 200),
    ]);

  const mediaChannelsByClient = new Map<string, string[] | null>(mediaChannelRows.map((row) => [row.id, row.media_channels]));
  const activityInPeriodByActor = countByActor(activityInPeriodRows);
  const activityAllTimeByActor = countByActor(activityAllTimeRows);

  // Primeira ocorrência por cliente (já ordenado occurred_at desc) é a MAIS
  // RECENTE troca de gestor dentro do período — a única que importa pra
  // saber quem é o gestor "novo" a partir daquele instante.
  const latestManagerChangeByClient = new Map<string, { at: string; newManagerId: string | null }>();
  for (const row of managerChangeRows) {
    if (!row.client_id) continue;
    if (latestManagerChangeByClient.has(row.client_id)) continue;
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const newManagerId =
      typeof metadata.new_manager_team_member_id === "string"
        ? metadata.new_manager_team_member_id
        : typeof metadata.manager_team_member_id === "string"
          ? metadata.manager_team_member_id
          : null;
    latestManagerChangeByClient.set(row.client_id, { at: row.occurred_at, newManagerId });
  }

  const achievementsByActor = new Map<string, AchievementRow[]>();
  for (const achievement of personAchievements.rows) {
    if (!achievement.actorTeamMemberId) continue;
    const list = achievementsByActor.get(achievement.actorTeamMemberId) ?? [];
    list.push(achievement);
    achievementsByActor.set(achievement.actorTeamMemberId, list);
  }

  const statesByManager = new Map<string, typeof clientOperationalStates>();
  for (const state of clientOperationalStates) {
    if (!state.managerId) continue;
    const list = statesByManager.get(state.managerId) ?? [];
    list.push(state);
    statesByManager.set(state.managerId, list);
  }

  return members.map((member) => {
    const managerStates = statesByManager.get(member.id) ?? [];

    const portfolioClients = managerStates.map((state) =>
      buildPortfolioClient(state, mediaChannelsByClient.get(state.clientId), member.id, latestManagerChangeByClient.get(state.clientId)),
    );
    const portfolio = summarizePortfolio(portfolioClients);
    const portfolioPerformance = summarizePortfolioPerformance(managerStates.map(evaluatePortfolioClient));

    return {
      teamMemberId: member.id,
      name: member.name,
      jobTitle: member.job_title,
      avatarUrl: member.avatar_url,
      status: member.status as "ativo" | "inativo",
      portfolio,
      portfolioPerformance,
      activityInPeriod: activityInPeriodByActor.get(member.id) ?? emptyActivityCounts(),
      activityAllTime: activityAllTimeByActor.get(member.id) ?? emptyActivityCounts(),
      achievements: achievementsByActor.get(member.id) ?? [],
    };
  });
}

/** Rótulo curto da métrica de custo pro objetivo do cliente — mesma fonte
 * única de sempre (`PERFORMANCE_GOALS`), nunca uma segunda tabela. */
function costShortLabel(goal: PerformanceGoal): string {
  const labels: Record<PerformanceGoal, string> = { leads: "CPL", sales: "CPA", followers: "Custo por novo seguidor" };
  return labels[goal];
}

export interface ManagerAssignmentHistoryEntry {
  clientId: string;
  clientName: string;
  startedAt: string;
  endedAt: string | null;
}

/**
 * Etapa "Equipe — Fase 2": "Histórico de carteira" do Perfil do Gestor —
 * reaproveita `fetchAssignmentPeriodsForManager` (`lib/client-manager-assignments.ts`,
 * a fonte canônica) e só junta o nome do cliente pra exibição (nenhuma
 * lógica temporal nova aqui, nenhum recálculo de período). Mais recente
 * primeiro. Nunca inclui nada anterior ao deploy da Fase 2 — a própria
 * fonte não tem esse dado (ver `client-manager-assignments.sql`, backfill).
 */
export async function loadManagerAssignmentHistory(supabase: Supabase, managerId: string): Promise<ManagerAssignmentHistoryEntry[]> {
  const periods = await fetchAssignmentPeriodsForManager(supabase, managerId);
  if (periods.length === 0) return [];

  const clientIds = Array.from(new Set(periods.map((period) => period.clientId)));
  const clientRows = await requireQuery(supabase.from("clients").select("id, name").in("id", clientIds), "clients:assignment-history-names");
  const nameByClientId = new Map(clientRows.map((row) => [row.id, row.name]));

  return periods
    .map((period) => ({
      clientId: period.clientId,
      clientName: nameByClientId.get(period.clientId) ?? period.clientId,
      startedAt: period.startedAt,
      endedAt: period.endedAt,
    }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
