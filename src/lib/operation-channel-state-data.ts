import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { todayUTC, todayDateString } from "@/lib/today";
import { effectiveTaskStatus } from "@/lib/task-status";
import { aggregatePerformanceResults, computeCostPerResult, type PerformanceRecordRow } from "@/lib/performance";
import { channelToPerformanceSource } from "@/lib/performance-queries";
import { sumChannelEffectiveSpend, groupChannelSpendBySprintId, type SprintChannelSpendOverrideRow } from "@/lib/channel-spend";
import { computeMonthlyExpectedPct, resolvePlanningHorizon } from "@/lib/monthly-budget";
import { resolveClientMonthlyPlan, resolveTargetCostPerResult, filterRowsToPrimaryGoal, type ClientPlanChangeRow } from "@/lib/client-plan";
import { AVAILABLE_TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { evaluateAccountHealth, resolveReviewCadenceInputs, type AccountHealthInput } from "@/lib/account-health-engine";
import { monthRangeFromOperationParam } from "@/lib/operation-triage";
import { sortClientOperationalStates, type ClientOperationalState } from "@/lib/client-operational-state";
import { evaluateClientDiagnostics } from "@/lib/metric-diagnostics";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Pipeline de dados CHANNEL-SCOPED da Operação (Etapa "Operação por Canal").
 * Devolve `ClientOperationalState[]` — **o MESMO shape estrutural** que
 * `lib/client-operational-state-data.ts` (`loadClientOperationalStates`,
 * consolidado) já devolve pra Dashboard/Visão Geral do cliente/Relatórios/
 * Sprints — nenhum tipo paralelo criado só por semântica (decisão explícita
 * do usuário). A diferença nunca está no FORMATO da saída, só em como cada
 * campo é CALCULADO: aqui, toda métrica (investimento, resultado, custo,
 * meta, frescor) é avaliada exclusivamente dentro do canal pedido (`"meta"`
 * ou `"google"`) — nunca somando/misturando o outro canal.
 *
 * Por isso é importante nunca confundir os dois:
 * - `loadClientOperationalStates` → estado CONSOLIDADO (todos os canais do
 *   cliente somados) — consumido por Dashboard, Visão Geral do cliente,
 *   Relatórios, Sprints. Nem uma linha alterada por esta etapa.
 * - `loadOperationChannelStates` (este arquivo) → estado de UM canal só —
 *   consumido EXCLUSIVAMENTE pela Operação (`app/operation/*`), que deixou
 *   de ter uma visão "Consolidado" (Etapa "Operação por Canal" — só Meta
 *   Ads/Google Ads existem como contexto nesta tela).
 *
 * Implementação deliberadamente uma pipeline PRÓPRIA (não um parâmetro a
 * mais em `loadClientOperationalStates`) — as mesmas 11 consultas de lá são
 * repetidas aqui, cada uma com o mesmo filtro de sempre, MAIS um filtro de
 * população por canal (`clients.media_channels`, ver `resolveChannelPopulation`
 * abaixo). Isso mantém o pipeline consolidado inteiramente livre de
 * qualquer ramificação condicional por canal — o raio de mudança desta
 * etapa fica 100% contido neste arquivo novo.
 *
 * Reaproveita, sem alterar uma linha, os mesmos resolvedores puros que já
 * sabem operar por canal: `sumChannelEffectiveSpend` (lib/channel-spend.ts),
 * `aggregatePerformanceResults(..., channel)` (lib/performance.ts),
 * `resolveClientMonthlyPlan(...).byChannel[channel]` e, principalmente,
 * `resolveTargetCostPerResult({channel, ...})` (lib/client-plan.ts) — que
 * JÁ implementa exatamente a regra de meta aprovada: meta própria do canal
 * → meta consolidada → campo legado do cliente, nunca "Sem dados" só por
 * faltar uma meta específica do canal quando uma dessas duas existe.
 * `evaluateAccountHealth` (`lib/account-health-engine.ts`) é chamado sem
 * nenhuma alteração — nunca usa `evaluationScope: "channel"` (esse modo,
 * auditado nesta etapa, tem uma suposição desatualizada de que "plano só
 * existe no Consolidado", que não é mais verdade desde que meta por canal
 * passou a existir); em vez disso, os números já vêm pré-recortados pro
 * canal e alimentam o motor exatamente como se fossem "a conta inteira" —
 * cada checagem de qualidade de dado (plano ausente, sem sincronização,
 * meta ausente) passa a responder corretamente pra aquele canal específico.
 *
 * `costScopeComparable` sempre `true` aqui: a proteção existe pra nunca
 * comparar um CPA cujo plano cobre canais diferentes do realizado — dentro
 * de uma avaliação já recortada a UM canal só, essa mistura não pode mais
 * acontecer, então a checagem fica automaticamente satisfeita (não é uma
 * regra nova, é a mesma regra sem nada pra vetar).
 */
export async function loadOperationChannelStates(supabase: Supabase, monthParam: string, channel: TrafficChannel): Promise<ClientOperationalState[]> {
  const today = todayUTC();
  const todayStr = todayDateString();
  const now = new Date();

  const monthRange = monthRangeFromOperationParam(monthParam);
  const { firstDay: monthStart, lastDay: monthEnd } = monthRange;

  // Etapa "Operação por Canal": população da tela = só clientes que de fato
  // operam este canal (`clients.media_channels`, a mesma fonte única de
  // verdade já usada pelo seletor de canal da Visão Geral do cliente —
  // `resolveClientMediaChannels`, lib/traffic-channels.ts). Filtro aplicado
  // NA QUERY (não depois, em memória): um cliente sem Google configurado
  // nunca chega a ser avaliado quando o canal selecionado é Google — nunca
  // aparece como "Sem dados" por não ter o canal, porque nem entra na
  // fila pra começar.
  const clients = await requireQuery(
    supabase
      .from("clients")
      .select(
        "id, name, avatar_url, performance_goal, target_cost_per_result, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)",
      )
      .is("deleted_at", null)
      .eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS)
      .contains("media_channels", [channel])
      .order("name"),
    "clients:operation-channel",
  );

  const clientIds = clients.map((c) => c.id);
  if (clientIds.length === 0) return [];

  const [sprints, dailySpendRows, latestReviews, lastActivityRows, openTasks, planChanges, reviewCadences, activeImportSources, channelSpendRows, monthHorizons] =
    await Promise.all([
      requireQuery(
        supabase
          .from("sprints")
          .select("id, client_id, start_date, end_date, spend_source, manual_actual_spend, manual_spend_updated_at")
          .in("client_id", clientIds)
          .lte("start_date", monthEnd)
          .gte("end_date", monthStart),
        "sprints:operation-channel",
      ),
      requireQuery(
        supabase
          .from("daily_spend")
          .select("client_id, date, spend, synced_at, channel")
          .in("client_id", clientIds)
          .gte("date", monthStart)
          .lte("date", monthEnd),
        "daily_spend:operation-channel",
      ),
      requireQuery(
        supabase.from("account_reviews").select("client_id, reviewed_at").in("client_id", clientIds).order("reviewed_at", { ascending: false }),
        "account_reviews:operation-channel",
      ),
      requireQuery(
        supabase.from("client_last_operational_activity").select("client_id, last_activity_at").in("client_id", clientIds),
        "client_last_operational_activity:operation-channel",
      ),
      requireQuery(
        supabase.from("tasks").select("client_id, status, due_date").in("client_id", clientIds).in("status", ["pendente", "atrasado"]),
        "tasks:operation-channel",
      ),
      requireQuery(
        supabase
          .from("monthly_budget_changes")
          .select("client_id, channel, month, changed_at, new_amount, target_result_count, result_type")
          .in("client_id", clientIds)
          .lte("month", monthRange.firstDay),
        "monthly_budget_changes:operation-channel",
      ),
      requireQuery(
        supabase.from("account_review_cadences").select("client_id, max_business_days_without_review, is_active").in("client_id", clientIds),
        "account_review_cadences:operation-channel",
      ),
      requireQuery(supabase.from("import_sources").select("client_id").eq("enabled", true).in("client_id", clientIds), "import_sources:operation-channel"),
      requireQuery(
        supabase.from("sprint_channel_spend").select("sprint_id, channel, spend_source, manual_actual_spend").in("client_id", clientIds),
        "sprint_channel_spend:operation-channel",
      ),
      requireQuery(
        supabase.from("client_month_horizons").select("client_id, planning_end_date").eq("month", monthRange.firstDay).in("client_id", clientIds),
        "client_month_horizons:operation-channel",
      ),
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
  // Etapa "Operação por Canal": mesma linha de `daily_spend` já buscada
  // acima, reagrupada com canal + `synced_at` preservado (o pipeline
  // consolidado descarta `synced_at` ao montar o mapa por canal, porque só
  // precisa dele pro lado consolidado — aqui é exatamente o dado de
  // frescor por canal que falta).
  const dailySpendChannelByClient = new Map<string, { date: string; channel: TrafficChannel; spend: number; syncedAt: string }[]>();
  for (const row of dailySpendRows) {
    const list = dailySpendByClient.get(row.client_id) ?? [];
    list.push(row);
    dailySpendByClient.set(row.client_id, list);

    const channelList = dailySpendChannelByClient.get(row.client_id) ?? [];
    channelList.push({ date: row.date, channel: row.channel, spend: row.spend, syncedAt: row.synced_at });
    dailySpendChannelByClient.set(row.client_id, channelList);
  }

  const performanceRows =
    allSprintIds.length > 0
      ? await requireQuery(
          supabase
            .from("performance_records")
            .select("sprint_id, channel, result_type, result_count, source, source_updated_at")
            .in("sprint_id", allSprintIds),
          "performance_records:operation-channel",
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

  // Integração Stract — mesmo critério de sempre (`import_sources.enabled`):
  // cliente com sync ativo lê de `daily_performance`, nunca de
  // `performance_records` (nunca os dois somados).
  const activeImportClientIds = new Set((activeImportSources ?? []).map((row) => row.client_id));
  if (activeImportClientIds.size > 0) {
    const dailyPerformanceRows = await requireQuery(
      supabase
        .from("daily_performance")
        .select("client_id, channel, result_type, result_count, revenue, source_updated_at")
        .in("client_id", Array.from(activeImportClientIds))
        .gte("date", monthStart)
        .lte("date", monthEnd),
      "daily_performance:operation-channel",
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
  const openCountByClient = new Map<string, number>();
  for (const task of openTasks ?? []) {
    openCountByClient.set(task.client_id, (openCountByClient.get(task.client_id) ?? 0) + 1);
    if (effectiveTaskStatus(task, today) !== "atrasado") continue;
    overdueCountByClient.set(task.client_id, (overdueCountByClient.get(task.client_id) ?? 0) + 1);
  }

  const primaryGoalByClientId = new Map(clients.map((c) => [c.id, c.performance_goal]));

  const planChangesByClient = new Map<string, ClientPlanChangeRow[]>();
  for (const row of filterRowsToPrimaryGoal(planChanges ?? [], primaryGoalByClientId)) {
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

  const channelSpendBySprintId = groupChannelSpendBySprintId(
    (channelSpendRows ?? []).map((r) => ({
      sprintId: r.sprint_id,
      channel: r.channel,
      spend_source: r.spend_source,
      manual_actual_spend: r.manual_actual_spend,
    })),
  );

  const cards: ClientOperationalState[] = clients.map((client) => {
    const managerId = client.primary_manager?.id ?? null;
    const managerName = client.primary_manager?.name ?? null;

    const clientHorizon = resolvePlanningHorizon(monthRange, monthHorizonByClient.get(client.id) ?? null);
    const monthExpectedPct = computeMonthlyExpectedPct(clientHorizon, todayStr);

    const clientSprintsRaw = sprintsByClient.get(client.id) ?? [];
    const clientDailySpendChannel = dailySpendChannelByClient.get(client.id) ?? [];
    const clientSprintIds = new Set(clientSprintsRaw.map((s) => s.id));
    const clientChannelSpendOverrides: SprintChannelSpendOverrideRow[] = Array.from(clientSprintIds).flatMap(
      (sprintId) => channelSpendBySprintId.get(sprintId) ?? [],
    );

    // Investimento REALIZADO — só deste canal. Mesmo resolvedor puro que
    // `resolveClientMonthlyActuals` já chama internamente por canal (nunca
    // uma segunda fórmula de "gasto efetivo" reinventada aqui).
    const channelDailySpendPlain = clientDailySpendChannel.map((row) => ({ date: row.date, channel: row.channel, spend: row.spend }));
    const investmentActual = sumChannelEffectiveSpend(
      clientSprintsRaw.map((s) => ({ sprintId: s.id, start_date: s.start_date, end_date: s.end_date })),
      channel,
      channelDailySpendPlain,
      clientChannelSpendOverrides,
    );
    // `investmentHasSyncedData`: existe ALGUMA linha de `daily_spend` pra
    // este canal/mês — distinto de "sincronizou e o gasto é zero" (mesma
    // distinção que `sumEffectiveSpendForMonth.hasData` já faz pro
    // consolidado, aqui replicada só pro canal).
    const investmentHasSyncedData = clientDailySpendChannel.some((row) => row.channel === channel);

    // Resultado REALIZADO — só deste canal (`aggregatePerformanceResults`
    // já aceita canal como terceiro argumento; é a MESMA função de sempre,
    // só chamada com o canal em vez de consolidado).
    const performanceResult = client.performance_goal
      ? aggregatePerformanceResults(performanceRowsByClient.get(client.id) ?? [], client.performance_goal, channel)
      : { resultCount: 0, revenue: null, hasAnyRecord: false, latestSource: null, latestUpdatedAt: null };

    const costActual = computeCostPerResult(investmentHasSyncedData ? investmentActual : null, performanceResult.resultCount, performanceResult.hasAnyRecord);

    // Planejado — meta de custo usa `resolveTargetCostPerResult` com o
    // CANAL selecionado: meta própria do canal → meta consolidada → campo
    // legado (regra existente, aprovada, reaproveitada sem nenhuma
    // alteração — nunca "Sem dados" só por faltar meta específica do canal
    // quando uma dessas duas fontes existe). Investimento/resultado
    // planejados ficam ESTRITOS ao canal (`byChannel[channel]`, sem
    // fallback pro consolidado) — deliberado: aqui a pergunta é "este canal
    // específico tem plano próprio configurado?", que é justamente o tipo
    // de lacuna operacional que esta etapa existe pra revelar (ex.: canal
    // ativo, sem nenhum orçamento lançado pra ele ainda).
    const clientMonthlyPlan = resolveClientMonthlyPlan({
      channels: AVAILABLE_TRAFFIC_CHANNELS,
      changes: planChangesByClient.get(client.id) ?? [],
      selectedMonth: monthRange.firstDay,
    });
    const channelPlan = clientMonthlyPlan.byChannel[channel];
    const plan = {
      investmentPlanned: channelPlan?.investment ?? null,
      targetResultCount: channelPlan?.resultCount ?? null,
      targetCostPerResult: resolveTargetCostPerResult({ channel, plan: clientMonthlyPlan, legacyFallback: client.target_cost_per_result }),
    };

    const lastReviewAt = latestReviewByClient.get(client.id) ?? null;
    const cadence = reviewCadenceByClient.get(client.id) ?? null;
    const { reviewBusinessDaysAgo, reviewMaxBusinessDays } = resolveReviewCadenceInputs(lastReviewAt, cadence, today);

    // Frescor por canal — mesma fórmula de sempre (max entre investimento e
    // performance), só que os dois lados já vêm recortados pro canal:
    // `synced_at` de `daily_spend` FILTRADO por canal, e
    // `performanceResult.latestUpdatedAt` (já veio do `aggregatePerformanceResults`
    // chamado com o canal acima — nunca um segundo cálculo).
    const channelSyncedAtValues = clientDailySpendChannel.filter((row) => row.channel === channel).map((row) => row.syncedAt);
    const investmentLastSyncedAt = channelSyncedAtValues.length > 0 ? channelSyncedAtValues.reduce((a, b) => (a > b ? a : b)) : null;
    const lastDataSyncAt =
      investmentLastSyncedAt && performanceResult.latestUpdatedAt
        ? investmentLastSyncedAt > performanceResult.latestUpdatedAt
          ? investmentLastSyncedAt
          : performanceResult.latestUpdatedAt
        : (investmentLastSyncedAt ?? performanceResult.latestUpdatedAt ?? null);

    const input: AccountHealthInput = {
      investmentActual,
      investmentPlanned: plan.investmentPlanned,
      investmentHasSyncedData,
      resultActual: performanceResult.resultCount,
      resultPlanned: plan.targetResultCount,
      hasPerformanceData: performanceResult.hasAnyRecord,
      performanceGoalConfigured: client.performance_goal !== null,
      costActual,
      costPlanned: plan.targetCostPerResult,
      // Sempre comparável: já estamos dentro de UM canal só, então a
      // proteção "plano e realizado cobrem os mesmos canais" não tem mais o
      // que vetar (ver doc do arquivo).
      costScopeComparable: true,
      monthExpectedPct,
      reviewBusinessDaysAgo,
      reviewMaxBusinessDays,
      lastDataSyncAt,
    };

    const lastTaskActivityAt = lastTaskActivityByClient.get(client.id) ?? null;
    const lastActivityAt =
      !lastReviewAt || !lastTaskActivityAt
        ? (lastReviewAt ?? lastTaskActivityAt)
        : new Date(lastReviewAt).getTime() >= new Date(lastTaskActivityAt).getTime()
          ? lastReviewAt
          : lastTaskActivityAt;
    const hoursSinceLastActivity = lastActivityAt ? (now.getTime() - new Date(lastActivityAt).getTime()) / 3_600_000 : null;

    // Motor de Diagnóstico Único (`diagnostics.cpa`) — hoje o único campo
    // deste objeto que o card da Operação de fato lê (`operation-client-card.tsx`,
    // desde a Etapa "Operação — Redução de Ruído Visual"); os demais
    // (planejamento/investment/pendencias/atividade) continuam calculados
    // pra manter o TIPO completo e coerente com o resto da plataforma, com
    // os mesmos valores client-level de sempre (tarefas/atividade não são
    // conceito de canal) — nenhum consumidor atual da Operação os lê.
    const diagnostics = evaluateClientDiagnostics({
      planejamento: {
        hasPerformanceGoal: client.performance_goal !== null,
        targetCostPerResult: plan.targetCostPerResult,
        investmentPlanned: plan.investmentPlanned,
      },
      cpa: { costPerResult: costActual, targetCostPerResult: plan.targetCostPerResult, resultCount: performanceResult.resultCount },
      investment: { actualSpend: investmentActual, expectedToDate: null },
      pendencias: { openTasksCount: openCountByClient.get(client.id) ?? 0 },
      atividade: { lastActivityAt, hoursSinceLastActivity },
    });

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
