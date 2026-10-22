"use server";

import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  getEnabledImportSourceIdsForClient,
  getLatestDailySpendDate,
  getRecentSyncRunsForClient,
  getLatestSyncRunStatusForSources,
} from "@/lib/performance-queries";
import { getReportShareLinkStatus } from "@/lib/report-share-links";
import { loadClientOperationalStates } from "@/lib/client-operational-state-data";
import { currentMonthRange } from "@/lib/sprint-financials";
import { todayUTC } from "@/lib/today";
import { formatRelativeDateTime, formatShortDate } from "@/lib/format";
import { SYNC_RUN_STATUS_LABEL, SYNC_RUN_STATUS_BADGE_CLASSES, formatSyncRunCounts } from "@/lib/sync-run-status";
import type { AccountInfoSyncRun } from "./account-info-drawer";

export interface AccountInfoDrawerData {
  lastPerformanceUpdateValue: string;
  latestDataDateLabel: string | null;
  /** `true` quando existe PELO MENOS UMA fonte `meta_api` (busca direta na
   * Meta) habilitada — decide se o bloco "Sincronização" (com botão
   * "Sincronizar agora") aparece. Stract foi descontinuado (ver
   * `docs/STRACT_INTEGRATION_ARCHITECTURE.md`) — uma linha `import_sources`
   * antiga com `provider='stract'` ainda habilitada no banco (nunca
   * removida destrutivamente) deliberadamente NÃO entra aqui: o botão só
   * aparece quando realmente vai funcionar (`syncClientMetaApiSourcesAction`
   * só entende `meta_api`), cliente nessa situação cai no fallback
   * `metaOnlyLastSyncLabel` abaixo, mesmo estado de quem nunca teve fonte
   * automática nenhuma. */
  hasAutomaticSyncSource: boolean;
  /** Rótulo da fonte automática ativa — sempre "Meta (busca direta)" quando
   * `hasAutomaticSyncSource` é `true` (único provider automático ativo
   * hoje). */
  syncProviderLabel: string | null;
  syncStatusLabel: string;
  syncStatusBadgeClassName: string;
  syncStartedAtLabel: string | null;
  metaOnlyLastSyncLabel: string | null;
  canOperate: boolean;
  recentSyncRuns: AccountInfoSyncRun[];
  isAdmin: boolean;
  hasActiveReportShareLink: boolean;
  reportShareLinkCreatedAtLabel: string | null;
  reportShareLinkUrl: string | null;
}

/**
 * "Informações da conta" virou um drawer GLOBAL do workspace do cliente
 * (Etapa "MITZA — Reformulação Estrutural", decisão 4: acessível de
 * qualquer área — Visão geral/Performance/Operação/Demandas/Configurações
 * — sem trocar de aba). Antes vivia só dentro de `[id]/page.tsx`,
 * recebendo tudo já calculado ali (inclusive rótulos que variavam com o
 * MÊS selecionado, ex.: "Última otimização em {mês}"). Pra funcionar fora
 * de qualquer aba específica, esta Server Action busca os mesmos dados
 * direto — sempre o estado ATUAL (não mais "no mês que eu estava
 * navegando"), o que é, na prática, a leitura mais correta pra um painel
 * de "estado da conta agora". Chamada sob demanda (ao abrir o drawer, não
 * a cada navegação de aba) — nunca prop-drilled por 5 rotas diferentes.
 */
export async function getAccountInfoDrawerDataAction(clientId: string): Promise<AccountInfoDrawerData | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sessão expirada." };
  const isAdmin = profile.role === "admin";
  const supabase = await createSupabaseClient();
  const nowInstant = new Date();
  const today = todayUTC();

  const { data: client } = await supabase.from("clients").select("status").eq("id", clientId).is("deleted_at", null).maybeSingle();
  if (!client) return { error: "Cliente não encontrado." };
  const canOperate = client.status === "ativo";

  // Stract descontinuado — só fonte `meta_api` habilitada conta como
  // "automática" aqui (ver doc-comment de `hasAutomaticSyncSource` acima).
  // `getEnabledImportSourceIdsForClient` continua genérico de propósito
  // (resolve o HISTÓRICO de execuções independente de provider — uma
  // fonte `stract` antiga ainda tem seu `data_sync_runs` real), só esta
  // checagem específica de "existe fonte automática ACIONÁVEL" ficou
  // restrita a `meta_api`.
  const [enabledSourceIds, { data: enabledMetaApiSourceRows }] = await Promise.all([
    getEnabledImportSourceIdsForClient(supabase, clientId),
    supabase.from("import_sources").select("id").eq("client_id", clientId).eq("provider", "meta_api").eq("enabled", true),
  ]);
  const hasAutomaticSyncSource = (enabledMetaApiSourceRows ?? []).length > 0;
  const syncProviderLabel = hasAutomaticSyncSource ? "Meta (busca direta)" : null;

  const [latestSyncStatus, latestSpendDate, recentSyncRuns, reportShareLinkStatus, [clientOperationalState]] = await Promise.all([
    enabledSourceIds.length > 0 ? getLatestSyncRunStatusForSources(enabledSourceIds) : Promise.resolve(null),
    enabledSourceIds.length > 0 ? getLatestDailySpendDate(supabase, clientId) : Promise.resolve(null),
    isAdmin && enabledSourceIds.length > 0 ? getRecentSyncRunsForClient(supabase, enabledSourceIds) : Promise.resolve([]),
    isAdmin ? getReportShareLinkStatus(clientId) : Promise.resolve({ active: false, createdAt: null, url: null }),
    loadClientOperationalStates(supabase, currentMonthRange(today).firstDay, clientId),
  ]);

  return {
    lastPerformanceUpdateValue: clientOperationalState?.lastDataSyncAt
      ? formatRelativeDateTime(clientOperationalState.lastDataSyncAt, nowInstant)
      : "Sem sincronização registrada",
    latestDataDateLabel: latestSpendDate ? formatShortDate(latestSpendDate) : null,
    hasAutomaticSyncSource,
    syncProviderLabel,
    syncStatusLabel: latestSyncStatus ? SYNC_RUN_STATUS_LABEL[latestSyncStatus.status] : "Nunca sincronizado",
    syncStatusBadgeClassName: latestSyncStatus
      ? SYNC_RUN_STATUS_BADGE_CLASSES[latestSyncStatus.status]
      : "bg-overview-surface-subtle text-overview-text-secondary",
    syncStartedAtLabel: latestSyncStatus ? formatRelativeDateTime(latestSyncStatus.startedAt, nowInstant) : null,
    metaOnlyLastSyncLabel: clientOperationalState?.lastDataSyncAt ? formatRelativeDateTime(clientOperationalState.lastDataSyncAt, nowInstant) : null,
    canOperate,
    recentSyncRuns: recentSyncRuns.map((run) => ({
      id: run.id,
      statusLabel: SYNC_RUN_STATUS_LABEL[run.status],
      statusBadgeClassName: SYNC_RUN_STATUS_BADGE_CLASSES[run.status],
      startedAtLabel: formatRelativeDateTime(run.startedAt, nowInstant),
      countsLabel: formatSyncRunCounts(run),
      errorMessage: run.errorMessage,
    })),
    isAdmin,
    hasActiveReportShareLink: reportShareLinkStatus.active,
    reportShareLinkCreatedAtLabel: reportShareLinkStatus.createdAt ? formatRelativeDateTime(reportShareLinkStatus.createdAt, nowInstant) : null,
    reportShareLinkUrl: reportShareLinkStatus.url,
  };
}
