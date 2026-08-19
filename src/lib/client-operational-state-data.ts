import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { todayUTC, todayDateString } from "@/lib/today";
import { businessDaysSince } from "@/lib/business-days";
import { effectiveTaskStatus } from "@/lib/task-status";
import { aggregatePerformanceResults, computeCostPerResult, type PerformanceRecordRow } from "@/lib/performance";
import { channelToPerformanceSource } from "@/lib/performance-queries";
import { resolveManualActualSpend, sumEffectiveSpendForMonth, type SprintSpendSource, type DailySpendRow } from "@/lib/effective-spend";
import { groupChannelSpendBySprintId, type SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import {
  computeMonthlyExpectedPct,
  computeMonthlyExpectedToDateByCalendar,
  resolvePlanningHorizon,
} from "@/lib/monthly-budget";
import { resolveClientMonthlyPlan, type ClientPlanChangeRow } from "@/lib/client-plan";
import { resolveClientMonthlyActuals } from "@/lib/client-actuals";
import { resolveCostScopeComparability } from "@/lib/channel-metrics";
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { evaluateAccountHealth, type AccountHealthInput } from "@/lib/account-health-engine";
import { DEFAULT_REVIEW_MAX_BUSINESS_DAYS } from "@/lib/operation-health-thresholds";
import { monthRangeFromOperationParam } from "@/lib/operation-triage";
import { sortClientOperationalStates, type ClientOperationalState } from "@/lib/client-operational-state";
import { evaluateClientDiagnostics } from "@/lib/metric-diagnostics";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Pipeline de dados do domínio `ClientOperationalState` (Etapa "Consolidação
 * da Arquitetura — Fase B") — extraído de `app/operation/operation-triage-data.ts`
 * pra virar neutro (não pertence só à Operação): a Visão Geral (Fase B)
 * também chama esta função agora, reaproveitando exatamente a mesma
 * implementação — nenhuma fórmula duplicada entre as duas telas.
 * `operation-triage-data.ts` mantém seu `loadOperationTriageClients` como um
 * wrapper fino sobre esta função (mesmo comportamento externo de sempre).
 *
 * Resolve tudo (planejamento mensal, realizado, cadência de revisão) e
 * delega a classificação inteira pra `evaluateAccountHealth`
 * (`lib/account-health-engine.ts`); este arquivo nunca decide severidade
 * sozinho. Investimento resolve pela mesma fonte oficial que a página do
 * Cliente usa (`sumEffectiveSpendForMonth`, `lib/effective-spend.ts`).
 *
 * Princípio "Workspace = só cliente ativo": a query de `clients` já
 * filtra por `WORKSPACE_ACTIVE_CONTRACT_STATUS` (`lib/client-fields.ts`)
 * — cliente pausado/encerrado nunca chega a este pipeline, então nenhum
 * consumidor (Operação, Relatórios, Dashboard) precisa filtrar de novo.
 */
export async function loadClientOperationalStates(
  supabase: Supabase,
  monthParam: string,
  /** Etapa "Motivo da Operação no Cliente": escopa TODA esta pipeline a um
   * único cliente — nenhuma query nova, nenhuma regra nova, só um `.eq`
   * condicional em cada busca (a montagem final continua sendo o mesmo
   * `.map` sobre `clients`, o Motor de Saúde continua sendo chamado
   * exatamente como sempre). Usado pela página individual do cliente pra
   * reaproveitar `evaluateAccountHealth()` sem rodar a busca da agência
   * inteira só pra ler o `primaryReason` de UMA conta. Omitir preserva o
   * comportamento de sempre (Operação/Relatórios/Dashboard, que continuam
   * olhando todos os clientes ativos do mês). */
  clientId?: string,
): Promise<ClientOperationalState[]> {
  const today = todayUTC();
  const todayStr = todayDateString();
  const now = new Date();

  const monthRange = monthRangeFromOperationParam(monthParam);
  const { firstDay: monthStart, lastDay: monthEnd } = monthRange;

  let clientsQuery = supabase
    .from("clients")
    .select(
      "id, name, avatar_url, performance_goal, target_cost_per_result, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)",
    )
    .is("deleted_at", null)
    .eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS);
  if (clientId) clientsQuery = clientsQuery.eq("id", clientId);

  let sprintsQuery = supabase
    .from("sprints")
    .select("id, client_id, start_date, end_date, spend_source, manual_actual_spend, manual_spend_updated_at")
    .lte("start_date", monthEnd)
    .gte("end_date", monthStart);
  if (clientId) sprintsQuery = sprintsQuery.eq("client_id", clientId);

  // `channel` incluído na mesma consulta de sempre (Etapa "Comparabilidade
  // de Escopo de Custo") — nenhuma query nova, só uma coluna a mais: usado
  // só pra montar `dailySpendChannelByClient` abaixo, que alimenta
  // `resolveClientMonthlyActuals` (o mesmo resolvedor já usado pelo
  // Dashboard/página do Cliente pro realizado por canal, nunca uma segunda
  // implementação).
  let dailySpendQuery = supabase
    .from("daily_spend")
    .select("client_id, date, spend, synced_at, channel")
    .gte("date", monthStart)
    .lte("date", monthEnd);
  if (clientId) dailySpendQuery = dailySpendQuery.eq("client_id", clientId);

  let latestReviewsQuery = supabase.from("account_reviews").select("client_id, reviewed_at").order("reviewed_at", { ascending: false });
  if (clientId) latestReviewsQuery = latestReviewsQuery.eq("client_id", clientId);

  // Fonte real de Atividade (task criada/editada/concluída/comentada,
  // comentário de sprint) — `operational_activities`/view agregada já
  // existiam (Etapa 15) pra outro propósito; aqui viram, junto com
  // `account_reviews` acima, os dois insumos legítimos de "alguém agiu
  // nesta conta", nunca um valor fabricado.
  let lastActivityQuery = supabase.from("client_last_operational_activity").select("client_id, last_activity_at");
  if (clientId) lastActivityQuery = lastActivityQuery.eq("client_id", clientId);

  let openTasksQuery = supabase.from("tasks").select("client_id, status, due_date").in("status", ["pendente", "atrasado"]);
  if (clientId) openTasksQuery = openTasksQuery.eq("client_id", clientId);

  // Etapa "Migração Multicanal dos Consumidores": todos os canais (nunca
  // mais só `channel = 'meta'`) — `resolveClientMonthlyPlan` resolve o
  // investimento/meta de resultado vigente POR CANAL, consolidado é a soma
  // aditiva (nunca o plano de um canal só).
  let planChangesQuery = supabase
    .from("monthly_budget_changes")
    .select("client_id, channel, month, changed_at, new_amount, target_result_count")
    .lte("month", monthRange.firstDay);
  if (clientId) planChangesQuery = planChangesQuery.eq("client_id", clientId);

  let reviewCadencesQuery = supabase.from("account_review_cadences").select("client_id, max_business_days_without_review, is_active");
  if (clientId) reviewCadencesQuery = reviewCadencesQuery.eq("client_id", clientId);

  // Integração Stract (arquitetura aprovada — ver DECISIONS.md): cliente
  // com uma import_source ativa lê performance de `daily_performance` —
  // nunca de `performance_records`, nunca os dois somados. `enabled` é o
  // único campo que decide isso (status é só observabilidade).
  let activeImportSourcesQuery = supabase.from("import_sources").select("client_id").eq("enabled", true);
  if (clientId) activeImportSourcesQuery = activeImportSourcesQuery.eq("client_id", clientId);

  // Investimento manual multicanal (`sprint_channel_spend`, adotada como
  // fonte de verdade — ver `resolveManualActualSpend`, lib/effective-spend.ts).
  let channelSpendQuery = supabase.from("sprint_channel_spend").select("sprint_id, channel, spend_source, manual_actual_spend");
  if (clientId) channelSpendQuery = channelSpendQuery.eq("client_id", clientId);

  // Etapa "Horizonte de Planejamento": clientes de evento (campanha que
  // termina antes do fim do mês), resolvido por cliente abaixo.
  let monthHorizonsQuery = supabase.from("client_month_horizons").select("client_id, planning_end_date").eq("month", monthRange.firstDay);
  if (clientId) monthHorizonsQuery = monthHorizonsQuery.eq("client_id", clientId);

  const [
    clients,
    sprints,
    dailySpendRows,
    latestReviews,
    lastActivityRows,
    openTasks,
    planChanges,
    reviewCadences,
    activeImportSources,
    channelSpendRows,
    monthHorizons,
  ] = await Promise.all([
      requireQuery(clientsQuery.order("name"), "clients"),
      requireQuery(sprintsQuery, "sprints"),
      requireQuery(dailySpendQuery, "daily_spend"),
      requireQuery(latestReviewsQuery, "account_reviews"),
      requireQuery(lastActivityQuery, "client_last_operational_activity"),
      requireQuery(openTasksQuery, "tasks"),
      requireQuery(planChangesQuery, "monthly_budget_changes:plan-history"),
      requireQuery(reviewCadencesQuery, "account_review_cadences"),
      requireQuery(activeImportSourcesQuery, "import_sources:active"),
      requireQuery(channelSpendQuery, "sprint_channel_spend"),
      requireQuery(monthHorizonsQuery, "client_month_horizons"),
    ]);

  const monthHorizonByClient = new Map(monthHorizons.map((row) => [row.client_id, row.planning_end_date]));

  const sprintsByClient = new Map<string, typeof sprints>();
  const sprintIdToClientId = new Map<string, string>();
  for (const sprint of sprints) {
    const list = sprintsByClient.get(sprint.client_id) ?? [];
    list.push(sprint);
    sprintsByClient.set(sprint.client_id, list);
    sprintIdToClientId.set(sprint.id, sprint.client_id);
  }
  const allSprintIds = sprints.map((s) => s.id);

  const dailySpendByClient = new Map<string, { date: string; spend: number; synced_at: string }[]>();
  // Etapa "Comparabilidade de Escopo de Custo": mesma linha de `daily_spend`
  // já buscada acima, só reagrupada com a dimensão de canal — alimenta
  // `resolveClientMonthlyActuals` abaixo (realizado por canal), nunca uma
  // segunda consulta.
  const dailySpendChannelByClient = new Map<string, { date: string; channel: TrafficChannel; spend: number }[]>();
  for (const row of dailySpendRows) {
    const list = dailySpendByClient.get(row.client_id) ?? [];
    list.push(row);
    dailySpendByClient.set(row.client_id, list);

    const channelList = dailySpendChannelByClient.get(row.client_id) ?? [];
    channelList.push({ date: row.date, channel: row.channel, spend: row.spend });
    dailySpendChannelByClient.set(row.client_id, channelList);
  }

  const performanceRows =
    allSprintIds.length > 0
      ? await requireQuery(
          supabase
            .from("performance_records")
            .select("sprint_id, channel, result_type, result_count, source, source_updated_at")
            .in("sprint_id", allSprintIds),
          "performance_records",
        )
      : [];

  const performanceRowsByClient = new Map<string, PerformanceRecordRow[]>();
  for (const row of performanceRows) {
    if (!row.sprint_id) continue;
    const clientId = sprintIdToClientId.get(row.sprint_id);
    if (!clientId) continue;
    const list = performanceRowsByClient.get(clientId) ?? [];
    list.push({
      channel: row.channel,
      resultType: row.result_type,
      resultCount: row.result_count,
      source: row.source,
      sourceUpdatedAt: row.source_updated_at,
    });
    performanceRowsByClient.set(clientId, list);
  }

  // Integração Stract (arquitetura aprovada — ver DECISIONS.md): cliente com
  // import_source ativa lê performance de `daily_performance`, NUNCA de
  // `performance_records` — por isso a entrada de `performanceRowsByClient`
  // desse cliente é inteiramente substituída abaixo (nunca somada às linhas
  // de `performance_records` já montadas acima).
  const activeImportClientIds = new Set((activeImportSources ?? []).map((row) => row.client_id));
  if (activeImportClientIds.size > 0) {
    const dailyPerformanceRows = await requireQuery(
      supabase
        .from("daily_performance")
        .select("client_id, channel, result_type, result_count, revenue, source_updated_at")
        .in("client_id", Array.from(activeImportClientIds))
        .gte("date", monthStart)
        .lte("date", monthEnd),
      "daily_performance",
    );

    const dailyPerformanceByClient = new Map<string, PerformanceRecordRow[]>();
    for (const row of dailyPerformanceRows) {
      const list = dailyPerformanceByClient.get(row.client_id) ?? [];
      list.push({
        channel: row.channel,
        resultType: row.result_type,
        resultCount: row.result_count,
        revenue: row.revenue,
        source: channelToPerformanceSource(row.channel),
        sourceUpdatedAt: row.source_updated_at,
      });
      dailyPerformanceByClient.set(row.client_id, list);
    }

    for (const clientId of activeImportClientIds) {
      performanceRowsByClient.set(clientId, dailyPerformanceByClient.get(clientId) ?? []);
    }
  }

  const latestReviewByClient = new Map<string, string>();
  for (const row of latestReviews ?? []) {
    if (!latestReviewByClient.has(row.client_id)) latestReviewByClient.set(row.client_id, row.reviewed_at);
  }

  const lastTaskActivityByClient = new Map<string, string>();
  for (const row of lastActivityRows ?? []) {
    if (row.client_id && row.last_activity_at) lastTaskActivityByClient.set(row.client_id, row.last_activity_at);
  }

  const overdueCountByClient = new Map<string, number>();
  // Etapa "Novo Conceito de Monitoramento Operacional": Pendências conta
  // qualquer tarefa ABERTA (pendente OU atrasada), não só a atrasada — a
  // query já filtra pra `status in ('pendente', 'atrasado')`, então basta
  // contar cada linha, sem o filtro extra de `effectiveTaskStatus` (esse
  // continua existindo só pra `overdueCountByClient`, usado por telas que
  // ainda não migraram pro novo motor de diagnóstico).
  const openCountByClient = new Map<string, number>();
  for (const task of openTasks ?? []) {
    openCountByClient.set(task.client_id, (openCountByClient.get(task.client_id) ?? 0) + 1);
    if (effectiveTaskStatus(task, today) !== "atrasado") continue;
    overdueCountByClient.set(task.client_id, (overdueCountByClient.get(task.client_id) ?? 0) + 1);
  }

  const planChangesByClient = new Map<string, ClientPlanChangeRow[]>();
  for (const row of planChanges ?? []) {
    const list = planChangesByClient.get(row.client_id) ?? [];
    list.push({
      channel: row.channel as TrafficChannel,
      month: row.month,
      changedAt: row.changed_at,
      investment: row.new_amount,
      targetResultCount: row.target_result_count,
    });
    planChangesByClient.set(row.client_id, list);
  }

  const reviewCadenceByClient = new Map((reviewCadences ?? []).map((row) => [row.client_id, row]));

  // Investimento manual multicanal — resolve `manualActualSpend` de cada
  // sprint ANTES de montar `clientSprints` abaixo (ver
  // `resolveManualActualSpend`, lib/effective-spend.ts), pra
  // `sumEffectiveSpendForMonth` herdar o valor certo sem duplicar a regra.
  const channelSpendBySprintId = groupChannelSpendBySprintId(
    (channelSpendRows ?? []).map((r) => ({
      sprintId: r.sprint_id,
      channel: r.channel,
      spend_source: r.spend_source,
      manual_actual_spend: r.manual_actual_spend,
    })),
  );

  const cards: ClientOperationalState[] = (clients ?? []).map((client) => {
    const managerId = client.primary_manager?.id ?? null;
    const managerName = client.primary_manager?.name ?? null;

    // Etapa "Horizonte de Planejamento": cliente de evento (campanha que
    // termina antes do fim do mês) — o "esperado até hoje" da Saúde da
    // Conta passa a avançar proporcionalmente aos dias da campanha, nunca
    // do mês inteiro. Cliente sem horizonte configurado (o padrão) recebe
    // `monthRange` inalterado — `monthExpectedPct` idêntico a antes desta
    // etapa.
    const clientHorizon = resolvePlanningHorizon(monthRange, monthHorizonByClient.get(client.id) ?? null);
    const monthExpectedPct = computeMonthlyExpectedPct(clientHorizon, todayStr);

    const clientSprints: SprintSpendSource[] = (sprintsByClient.get(client.id) ?? []).map((sprint) => ({
      startDate: sprint.start_date,
      endDate: sprint.end_date,
      spendSource: sprint.spend_source,
      manualActualSpend: resolveManualActualSpend(sprint.manual_actual_spend, channelSpendBySprintId.get(sprint.id) ?? []),
      manualSpendUpdatedAt: sprint.manual_spend_updated_at,
    }));
    const clientDailySpend: DailySpendRow[] = (dailySpendByClient.get(client.id) ?? []).map((row) => ({
      date: row.date,
      spend: row.spend,
      syncedAt: row.synced_at,
    }));
    const spend = sumEffectiveSpendForMonth(clientSprints, monthRange, clientDailySpend);

    const performanceResult = client.performance_goal
      ? aggregatePerformanceResults(performanceRowsByClient.get(client.id) ?? [], client.performance_goal)
      : { resultCount: 0, revenue: null, hasAnyRecord: false, latestSource: null, latestUpdatedAt: null };

    const costActual = computeCostPerResult(
      spend.hasData ? spend.actual : null,
      performanceResult.resultCount,
      performanceResult.hasAnyRecord,
    );

    // Etapa "Migração Multicanal dos Consumidores": `investmentPlanned`/
    // `targetResultCount` são a soma aditiva dos canais com plano (nunca
    // fabricando um Google inexistente); `targetCostPerResult` é sempre
    // derivado do consolidado (`investment ÷ resultCount`), nunca
    // média/soma de CPA por canal — cai pro campo permanente do cliente só
    // quando NENHUM canal tem meta de resultado definida ainda (mesmo
    // fallback de sempre, ver `resolveMonthlyPlanSnapshot`, agora aplicado
    // ao consolidado em vez de só Meta).
    const clientMonthlyPlan = resolveClientMonthlyPlan({
      channels: AVAILABLE_TRAFFIC_CHANNELS,
      changes: planChangesByClient.get(client.id) ?? [],
      selectedMonth: monthRange.firstDay,
    });
    const consolidatedPlan = clientMonthlyPlan.consolidated;
    const plan = {
      investmentPlanned: consolidatedPlan.investment,
      targetResultCount: consolidatedPlan.resultCount,
      targetCostPerResult: consolidatedPlan.cpa ?? client.target_cost_per_result,
    };

    // Etapa "Comparabilidade de Escopo de Custo": `costPlanned` acima só
    // representa fielmente o CPA consolidado quando o conjunto de canais do
    // PLANO bate com o conjunto de canais do REALIZADO — a auditoria
    // confirmou que hoje eles podem divergir (ex.: só Meta tem plano, mas
    // Google também gerou investimento/resultado real este mês). Realizado
    // por canal vem do mesmo resolvedor já usado pelo Dashboard/página do
    // Cliente (`resolveClientMonthlyActuals`, lib/client-actuals.ts) sobre
    // os MESMOS dados brutos já buscados acima pra este cliente (sprints,
    // `daily_spend` com canal, overrides, registros de performance) —
    // nenhuma query nova, nenhum segundo cálculo de "quais canais existem".
    //
    // `consolidatedPlan.cpa === null` significa que `targetCostPerResult`
    // acima veio do FALLBACK global (`client.target_cost_per_result`), não
    // de nenhum canal específico — uma meta global nunca teve escopo de
    // canal pra começar, então ela continua comparável contra o consolidado
    // como sempre foi (nunca tratar fallback legítimo como escopo
    // divergente sem evidência).
    const clientSprintIds = new Set((sprintsByClient.get(client.id) ?? []).map((sprint) => sprint.id));
    const clientChannelSpendOverrides: SprintChannelSpendOverrideRow[] = Array.from(clientSprintIds).flatMap(
      (sprintId) => channelSpendBySprintId.get(sprintId) ?? [],
    );
    const actualByChannel = resolveClientMonthlyActuals({
      sprints: (sprintsByClient.get(client.id) ?? []).map((sprint) => ({
        sprintId: sprint.id,
        start_date: sprint.start_date,
        end_date: sprint.end_date,
      })),
      dailySpendChannel: dailySpendChannelByClient.get(client.id) ?? [],
      channelSpendOverrides: clientChannelSpendOverrides,
      performanceRecords: performanceRowsByClient.get(client.id) ?? [],
      performanceGoal: client.performance_goal,
    }).byChannel;
    const costScopeComparable = resolveCostScopeComparability(
      consolidatedPlan.cpa !== null,
      clientMonthlyPlan.byChannel,
      actualByChannel,
    );

    const lastReviewAt = latestReviewByClient.get(client.id) ?? null;
    const reviewBusinessDaysAgo = lastReviewAt ? businessDaysSince(new Date(lastReviewAt), today) : null;

    const cadence = reviewCadenceByClient.get(client.id);
    const reviewMaxBusinessDays = cadence
      ? cadence.is_active
        ? cadence.max_business_days_without_review
        : null
      : DEFAULT_REVIEW_MAX_BUSINESS_DAYS;

    const input: AccountHealthInput = {
      investmentActual: spend.actual,
      investmentPlanned: plan.investmentPlanned,
      investmentHasSyncedData: spend.hasData,
      resultActual: performanceResult.resultCount,
      resultPlanned: plan.targetResultCount,
      hasPerformanceData: performanceResult.hasAnyRecord,
      performanceGoalConfigured: client.performance_goal !== null,
      costActual,
      costPlanned: plan.targetCostPerResult,
      costScopeComparable,
      monthExpectedPct,
      reviewBusinessDaysAgo,
      reviewMaxBusinessDays,
    };

    // Etapa "Novo Conceito de Monitoramento Operacional": mesmos números
    // já resolvidos acima (spend/plan/costActual), só reempacotados pro
    // Motor de Diagnóstico Único em vez do Motor de Saúde de 5 dimensões.
    // `expectedToDate` só é calculável quando existe planejamento mensal
    // (`plan.investmentPlanned`) — sem plano, o eixo Investimento fica sem
    // base de comparação (`expected: null`), nunca um "0 esperado"
    // fabricado.
    const investmentExpectedToDate =
      plan.investmentPlanned !== null
        ? computeMonthlyExpectedToDateByCalendar(plan.investmentPlanned, clientHorizon, todayStr).expectedToDate
        : null;

    // Atividade: "alguém agiu nesta conta" — o mais recente entre uma
    // otimização (`account_reviews`, placeholder até a estrutura real de
    // Otimizações existir) e qualquer atividade operacional real já
    // logada (`client_last_operational_activity`: tarefa criada/editada/
    // concluída/comentada, comentário de sprint). Nunca um só dos dois:
    // uma conta pode estar sendo bem cuidada só com tarefas em dia, sem
    // nenhuma otimização registrada ainda, e vice-versa.
    const lastTaskActivityAt = lastTaskActivityByClient.get(client.id) ?? null;
    const lastActivityAt =
      !lastReviewAt || !lastTaskActivityAt
        ? (lastReviewAt ?? lastTaskActivityAt)
        : new Date(lastReviewAt).getTime() >= new Date(lastTaskActivityAt).getTime()
          ? lastReviewAt
          : lastTaskActivityAt;
    const hoursSinceLastActivity = lastActivityAt ? (now.getTime() - new Date(lastActivityAt).getTime()) / 3_600_000 : null;

    const diagnostics = evaluateClientDiagnostics({
      planejamento: {
        hasPerformanceGoal: client.performance_goal !== null,
        targetCostPerResult: plan.targetCostPerResult,
        investmentPlanned: plan.investmentPlanned,
      },
      cpa: { costPerResult: costActual, targetCostPerResult: plan.targetCostPerResult, resultCount: performanceResult.resultCount },
      investment: { actualSpend: spend.actual, expectedToDate: investmentExpectedToDate },
      pendencias: { openTasksCount: openCountByClient.get(client.id) ?? 0 },
      atividade: { lastActivityAt, hoursSinceLastActivity },
    });

    const lastDataSyncAt =
      spend.lastUpdatedAt && performanceResult.latestUpdatedAt
        ? spend.lastUpdatedAt > performanceResult.latestUpdatedAt
          ? spend.lastUpdatedAt
          : performanceResult.latestUpdatedAt
        : (spend.lastUpdatedAt ?? performanceResult.latestUpdatedAt ?? null);

    return {
      clientId: client.id,
      clientName: client.name,
      managerId,
      managerName,
      avatarUrl: client.avatar_url,
      performanceGoal: client.performance_goal,
      evaluation: evaluateAccountHealth(input),
      overdueTasksCount: overdueCountByClient.get(client.id) ?? 0,
      openTasksCount: openCountByClient.get(client.id) ?? 0,
      lastDataSyncAt,
      performanceLatestSource: performanceResult.latestSource,
      performanceLastUpdatedAt: performanceResult.latestUpdatedAt,
      diagnostics,
    };
  });

  return sortClientOperationalStates(cards);
}
