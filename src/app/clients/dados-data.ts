import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { listClientGoals } from "@/lib/client-goals";
import { getRecentSyncRunsForClient, type SyncRunSummary } from "@/lib/performance-queries";
import { getLatestSyncRunStatusBySourceId } from "@/lib/stract-sync";
import { SYNC_RUN_STATUS_LABEL, SYNC_RUN_STATUS_BADGE_CLASSES, formatSyncRunCounts } from "@/lib/sync-run-status";
import { formatShortDate, formatRelativeDateTime } from "@/lib/format";
import { TRAFFIC_CHANNELS, type TrafficChannel } from "@/lib/traffic-channels";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import {
  PROVIDER_LABEL,
  resolveImportSourceDisplayStatus,
  buildSourceAttentions,
  buildGoalAttentions,
  resolveLatestImportedDate,
  type DataAttention,
} from "@/lib/data-trust";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Carrega os dados da tela "Dados" (Etapa "MEGA FACELIFT — Fase 5") — a
 * pergunta que a tela responde é "posso confiar nos dados deste cliente?",
 * nunca "esse resultado é bom?" (isso continua em Performance). Reaproveita
 * integralmente o que já existia: `listClientGoals` (mesmo núcleo de
 * Metas), `getRecentSyncRunsForClient`/`getLatestSyncRunStatusBySourceId`
 * (mesmas consultas do drawer "Informações da conta", `lib/stract-sync.ts`/
 * `lib/performance-queries.ts`) — a única leitura genuinamente NOVA aqui é
 * `metric_mappings` (nunca lida por nenhuma tela antes desta). Classificação
 * de status/atenção é sempre `lib/data-trust.ts` (núcleo puro, testável sem
 * banco) — este arquivo só busca e traduz pro formato de exibição.
 */

export interface DadosMappingView {
  goalLabel: string;
  resultColumn: string;
  valueColumn: string | null;
}

export interface DadosSyncRunView {
  id: string;
  statusLabel: string;
  statusBadgeClassName: string;
  startedAtLabel: string;
  countsLabel: string;
  errorMessage: string | null;
}

export interface DadosSourceTechnicalDetail {
  tableName: string | null;
  dateColumn: string | null;
  accountIdColumn: string | null;
  recentRuns: DadosSyncRunView[];
}

export interface DadosSourceView {
  id: string;
  providerLabel: string;
  channelLabel: string;
  externalAccountId: string;
  enabled: boolean;
  statusLabel: string;
  statusBadgeClassName: string;
  /** "Dados até DD/MM" — data EFETIVA do dado mais recente, nunca a hora da
   * sincronização (ver `lib/data-trust.ts`). `null` = nenhum dado real
   * recebido ainda. */
  lastImportedDateLabel: string | null;
  /** Quando essa sincronização rodou (instante), sempre separado do campo
   * acima — podem divergir bastante (fonte sincroniza todo dia, mas o
   * cliente pausou campanhas há semanas). */
  lastSuccessAtLabel: string | null;
  latestSyncStatusLabel: string | null;
  latestSyncBadgeClassName: string | null;
  latestSyncStartedAtLabel: string | null;
  mappings: DadosMappingView[];
  /** Só preenchido pra admin — detalhe técnico nunca visível a gestor
   * (mesma régua de `getRecentSyncRunsForClient`, RLS admin-only). */
  technical: DadosSourceTechnicalDetail | null;
  /** Destino real de configuração, só quando existe um hoje — nenhum link
   * fabricado pra uma página que não existe (seção 13 do pedido). */
  configureHref: string | null;
}

export interface DadosGoalView {
  resultType: PerformanceGoal;
  label: string;
  isPrimary: boolean;
  resultSourceLabel: "Automático" | "Manual";
  /** Canais com fonte habilitada E já ativa (dado real recebido) cobrindo
   * este objetivo — `null` quando o objetivo é manual, quando não há
   * restrição de canal configurada (`channels: []`, atribuição ambígua por
   * desenho) ou quando nenhuma fonte cobre o escopo (vira Atenção, não aqui). */
  automaticChannelLabels: string[] | null;
}

export interface DadosHealthSummary {
  enabledSourceCount: number;
  activeSourceCount: number;
  latestImportedDateLabel: string | null;
  attentionCount: number;
}

export interface DadosPageData {
  clientName: string;
  sources: DadosSourceView[];
  goals: DadosGoalView[];
  attentions: DataAttention[];
  health: DadosHealthSummary;
  /** Cliente sem NENHUMA linha em `import_sources` — 100% manual, estado
   * legítimo, nunca tratado como erro/lacuna. */
  isFullyManual: boolean;
}

export async function loadDadosPageData(supabase: Supabase, clientId: string, isAdmin: boolean): Promise<DadosPageData | null> {
  const { data: client } = await supabase.from("clients").select("id, name").eq("id", clientId).is("deleted_at", null).maybeSingle();
  if (!client) return null;

  const [importSourceRows, goals] = await Promise.all([
    requireQuery(
      supabase
        .from("import_sources")
        .select(
          "id, provider, channel, external_account_id, table_name, date_column, account_id_column, status, enabled, last_imported_date, last_success_at",
        )
        .eq("client_id", clientId)
        .order("created_at", { ascending: true }),
      "import_sources:dados",
    ),
    listClientGoals(supabase, clientId),
  ]);

  const sourceIds = importSourceRows.map((row) => row.id);

  const [mappingRows, latestStatusBySourceId, recentRunsFlat] = await Promise.all([
    sourceIds.length > 0
      ? requireQuery(
          supabase.from("metric_mappings").select("import_source_id, goal, result_column, value_column, active").in("import_source_id", sourceIds),
          "metric_mappings:dados",
        )
      : Promise.resolve([]),
    getLatestSyncRunStatusBySourceId(sourceIds),
    isAdmin && sourceIds.length > 0 ? getRecentSyncRunsForClient(supabase, sourceIds, sourceIds.length * 8) : Promise.resolve([]),
  ]);

  const activeMappingGoalsBySourceId = new Map<string, PerformanceGoal[]>();
  const mappingViewsBySourceId = new Map<string, DadosMappingView[]>();
  for (const mapping of mappingRows) {
    if (!mapping.active) continue;
    const goal = mapping.goal as PerformanceGoal;

    const goalList = activeMappingGoalsBySourceId.get(mapping.import_source_id) ?? [];
    goalList.push(goal);
    activeMappingGoalsBySourceId.set(mapping.import_source_id, goalList);

    const viewList = mappingViewsBySourceId.get(mapping.import_source_id) ?? [];
    viewList.push({ goalLabel: PERFORMANCE_GOALS[goal].label, resultColumn: mapping.result_column, valueColumn: mapping.value_column });
    mappingViewsBySourceId.set(mapping.import_source_id, viewList);
  }

  const recentRunsBySourceId = new Map<string, SyncRunSummary[]>();
  for (const run of recentRunsFlat as SyncRunSummary[]) {
    const list = recentRunsBySourceId.get(run.importSourceId) ?? [];
    list.push(run);
    recentRunsBySourceId.set(run.importSourceId, list);
  }

  const now = new Date();
  const sources: DadosSourceView[] = importSourceRows.map((row) => {
    const displayStatus = resolveImportSourceDisplayStatus(row);
    const latestStatus = latestStatusBySourceId.get(row.id) ?? null;
    const recentRunsForSource = (recentRunsBySourceId.get(row.id) ?? []).slice(0, 8);

    return {
      id: row.id,
      providerLabel: PROVIDER_LABEL[row.provider],
      channelLabel: TRAFFIC_CHANNELS[row.channel as TrafficChannel].label,
      externalAccountId: row.external_account_id,
      enabled: row.enabled,
      statusLabel: displayStatus.label,
      statusBadgeClassName: displayStatus.badgeClassName,
      lastImportedDateLabel: row.last_imported_date ? `Dados até ${formatShortDate(row.last_imported_date)}` : null,
      lastSuccessAtLabel: row.last_success_at ? formatRelativeDateTime(row.last_success_at, now) : null,
      latestSyncStatusLabel: latestStatus ? SYNC_RUN_STATUS_LABEL[latestStatus.status] : null,
      latestSyncBadgeClassName: latestStatus ? SYNC_RUN_STATUS_BADGE_CLASSES[latestStatus.status] : null,
      latestSyncStartedAtLabel: latestStatus ? formatRelativeDateTime(latestStatus.startedAt, now) : null,
      mappings: mappingViewsBySourceId.get(row.id) ?? [],
      technical: isAdmin
        ? {
            tableName: row.table_name,
            dateColumn: row.date_column,
            accountIdColumn: row.account_id_column,
            recentRuns: recentRunsForSource.map((run) => ({
              id: run.id,
              statusLabel: SYNC_RUN_STATUS_LABEL[run.status],
              statusBadgeClassName: SYNC_RUN_STATUS_BADGE_CLASSES[run.status],
              startedAtLabel: formatRelativeDateTime(run.startedAt, now),
              countsLabel: formatSyncRunCounts(run),
              errorMessage: run.errorMessage,
            })),
          }
        : null,
      configureHref: isAdmin && row.channel === "meta" ? "/settings/meta-connections" : null,
    };
  });

  const enabledSourcesForCoverage = importSourceRows
    .filter((row) => row.enabled)
    .map((row) => ({ id: row.id, channel: row.channel as TrafficChannel, status: row.status }));

  const goalViews: DadosGoalView[] = goals.map((goal) => {
    let automaticChannelLabels: string[] | null = null;
    if (goal.resultSource === "automatic" && goal.channels.length > 0) {
      const matchingActiveChannels = enabledSourcesForCoverage.filter((s) => goal.channels.includes(s.channel) && s.status === "active");
      if (matchingActiveChannels.length > 0) {
        automaticChannelLabels = Array.from(new Set(matchingActiveChannels.map((s) => TRAFFIC_CHANNELS[s.channel].label)));
      }
    }
    return {
      resultType: goal.resultType,
      label: PERFORMANCE_GOALS[goal.resultType].label,
      isPrimary: goal.isPrimary,
      resultSourceLabel: goal.resultSource === "automatic" ? "Automático" : "Manual",
      automaticChannelLabels,
    };
  });

  const attentions: DataAttention[] = [
    ...buildSourceAttentions(
      importSourceRows.map((row) => ({
        id: row.id,
        provider: row.provider,
        channel: row.channel as TrafficChannel,
        enabled: row.enabled,
        status: row.status,
      })),
    ),
    ...buildGoalAttentions(
      goals.map((g) => ({ resultType: g.resultType, resultSource: g.resultSource, channels: g.channels })),
      enabledSourcesForCoverage,
      activeMappingGoalsBySourceId,
    ),
  ];

  const latestImportedRaw = resolveLatestImportedDate(
    importSourceRows.map((row) => ({ enabled: row.enabled, lastImportedDate: row.last_imported_date })),
  );

  const health: DadosHealthSummary = {
    enabledSourceCount: importSourceRows.filter((row) => row.enabled).length,
    activeSourceCount: importSourceRows.filter((row) => row.enabled && row.status === "active").length,
    latestImportedDateLabel: latestImportedRaw ? formatShortDate(latestImportedRaw) : null,
    attentionCount: attentions.length,
  };

  return {
    clientName: client.name,
    sources,
    goals: goalViews,
    attentions,
    health,
    isFullyManual: importSourceRows.length === 0,
  };
}
