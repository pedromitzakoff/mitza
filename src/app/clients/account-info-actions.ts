"use server";

import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getEnabledImportSourceIdsForClient, getLatestDailySpendDate, getRecentSyncRunsForClient } from "@/lib/performance-queries";
import { getLatestSyncRunStatusForSources } from "@/lib/stract-sync";
import { getReportShareLinkStatus } from "@/lib/report-share-links";
import { loadClientOperationalStates } from "@/lib/client-operational-state-data";
import { currentMonthRange } from "@/lib/sprint-financials";
import { todayUTC } from "@/lib/today";
import { formatRelativeDateTime, formatShortDate } from "@/lib/format";
import { ACCOUNT_REVIEW_OUTCOME_LABEL, OPTIMIZATION_TYPE_LABEL } from "@/lib/account-reviews";
import { requireQuery } from "@/lib/require-query";
import { SYNC_RUN_STATUS_LABEL, SYNC_RUN_STATUS_BADGE_CLASSES, formatSyncRunCounts } from "@/lib/sync-run-status";
import type { OptimizationType } from "@/lib/supabase/database.types";
import type { AccountInfoSyncRun } from "./account-info-drawer";

export interface AccountInfoDrawerData {
  lastPerformanceUpdateValue: string;
  latestDataDateLabel: string | null;
  hasStractSource: boolean;
  syncStatusLabel: string;
  syncStatusBadgeClassName: string;
  syncStartedAtLabel: string | null;
  metaOnlyLastSyncLabel: string | null;
  lastOptimizationValue: string;
  lastOptimizationTooltip: string | null;
  canOperate: boolean;
  recentSyncRuns: AccountInfoSyncRun[];
  reviewsHistoryHref: string;
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

  const stractImportSourceIds = await getEnabledImportSourceIdsForClient(supabase, clientId);
  const [latestSyncStatus, latestSpendDate, recentSyncRuns, reportShareLinkStatus, [clientOperationalState], reviewRows] = await Promise.all([
    stractImportSourceIds.length > 0 ? getLatestSyncRunStatusForSources(stractImportSourceIds) : Promise.resolve(null),
    stractImportSourceIds.length > 0 ? getLatestDailySpendDate(supabase, clientId) : Promise.resolve(null),
    isAdmin && stractImportSourceIds.length > 0 ? getRecentSyncRunsForClient(supabase, stractImportSourceIds) : Promise.resolve([]),
    isAdmin ? getReportShareLinkStatus(clientId) : Promise.resolve({ active: false, createdAt: null, url: null }),
    loadClientOperationalStates(supabase, currentMonthRange(today).firstDay, clientId),
    // "Última otimização" — sempre a mais recente de VERDADE (nunca mais
    // escopada a um mês em exibição, ver doc-comment acima): mesma leitura
    // que `[id]/page.tsx` já fazia pro mês corrente (`accountReviews[0]`).
    requireQuery(
      supabase
        .from("account_reviews")
        .select("reviewed_at, outcome, issue_description, optimizations:account_optimizations(optimization_type)")
        .eq("client_id", clientId)
        .order("reviewed_at", { ascending: false })
        .limit(1),
      "account_reviews:account-info-drawer",
    ),
  ]);

  const lastReview = reviewRows[0] ?? null;
  const lastOptimizationValue = lastReview ? formatRelativeDateTime(lastReview.reviewed_at, nowInstant) : "Nenhuma otimização registrada";
  const optimizationTypes = (lastReview?.optimizations ?? []).map((o) => o.optimization_type as OptimizationType);
  const lastOptimizationDetail = lastReview
    ? lastReview.outcome === "OPTIMIZATION_PERFORMED"
      ? optimizationTypes.length === 1
        ? OPTIMIZATION_TYPE_LABEL[optimizationTypes[0]]
        : optimizationTypes.length > 1
          ? `${optimizationTypes.length} alterações`
          : null
      : lastReview.outcome === "ISSUE_IDENTIFIED"
        ? lastReview.issue_description
        : null
    : null;
  const lastOptimizationTooltip = lastReview
    ? `${ACCOUNT_REVIEW_OUTCOME_LABEL[lastReview.outcome]}${lastOptimizationDetail ? ` · ${lastOptimizationDetail}` : ""}`
    : null;

  return {
    lastPerformanceUpdateValue: clientOperationalState?.lastDataSyncAt
      ? formatRelativeDateTime(clientOperationalState.lastDataSyncAt, nowInstant)
      : "Sem sincronização registrada",
    latestDataDateLabel: latestSpendDate ? formatShortDate(latestSpendDate) : null,
    hasStractSource: stractImportSourceIds.length > 0,
    syncStatusLabel: latestSyncStatus ? SYNC_RUN_STATUS_LABEL[latestSyncStatus.status] : "Nunca sincronizado",
    syncStatusBadgeClassName: latestSyncStatus
      ? SYNC_RUN_STATUS_BADGE_CLASSES[latestSyncStatus.status]
      : "bg-overview-surface-subtle text-overview-text-secondary",
    syncStartedAtLabel: latestSyncStatus ? formatRelativeDateTime(latestSyncStatus.startedAt, nowInstant) : null,
    metaOnlyLastSyncLabel: clientOperationalState?.lastDataSyncAt ? formatRelativeDateTime(clientOperationalState.lastDataSyncAt, nowInstant) : null,
    lastOptimizationValue,
    lastOptimizationTooltip,
    canOperate,
    recentSyncRuns: recentSyncRuns.map((run) => ({
      id: run.id,
      statusLabel: SYNC_RUN_STATUS_LABEL[run.status],
      statusBadgeClassName: SYNC_RUN_STATUS_BADGE_CLASSES[run.status],
      startedAtLabel: formatRelativeDateTime(run.startedAt, nowInstant),
      countsLabel: formatSyncRunCounts(run),
      errorMessage: run.errorMessage,
    })),
    reviewsHistoryHref: `/clients/${clientId}/operation`,
    isAdmin,
    hasActiveReportShareLink: reportShareLinkStatus.active,
    reportShareLinkCreatedAtLabel: reportShareLinkStatus.createdAt ? formatRelativeDateTime(reportShareLinkStatus.createdAt, nowInstant) : null,
    reportShareLinkUrl: reportShareLinkStatus.url,
  };
}
