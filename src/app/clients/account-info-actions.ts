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
  /** `true` quando existe PELO MENOS UMA fonte automática ativa (Stract ou
   * busca direta na Meta, `provider in ('stract','meta_api')`) — decide se
   * o bloco "Sincronização" aparece. Nome genérico de propósito (MITZA
   * ONE — Busca direta na Meta): antes só existia o caminho Stract, então
   * esta chave chamava `hasStractSource`; corrigido porque um cliente com
   * SÓ `meta_api` ativo (nunca Stract) estava caindo nesse `true` do mesmo
   * jeito (bug real: `getEnabledImportSourceIdsForClient` sempre foi
   * genérico, nunca filtrou por provider) e o rótulo "Stract" aparecia
   * mesmo sem nenhuma fonte Stract — ver `syncProviderLabel` abaixo. */
  hasAutomaticSyncSource: boolean;
  /** Rótulo da fonte automática ativa ("Stract" / "Meta (busca direta)") —
   * só usado quando `hasAutomaticSyncSource` é `true`. Se as duas
   * coexistirem (estado transitório, nunca o estado-alvo — ver
   * `lib/meta-sync.ts`), `meta_api` tem prioridade no rótulo por ser o
   * caminho mais novo, mas o status/histórico abaixo sempre reflete a
   * execução mais recente entre as duas de qualquer forma. */
  syncProviderLabel: string | null;
  /** `true` quando a fonte automática ativa é `meta_api` — decide se o
   * botão "Sincronizar agora" aciona `syncClientMetaApiSourcesAction` em
   * vez de `syncClientStractSourcesAction` (`runImportForSource` é
   * Stract-only, chamá-la contra uma fonte `meta_api` falha). */
  isMetaApiSyncProvider: boolean;
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

  // MITZA ONE — Busca direta na Meta: `getEnabledImportSourceIdsForClient`
  // sempre foi genérico (`enabled = true`, qualquer provider) — correto
  // pra resolver o HISTÓRICO de execuções (`data_sync_runs` não distingue
  // provider pra fins de exibição aqui), mas o antigo `hasStractSource`
  // tratava "existe alguma fonte automática habilitada" como sinônimo de
  // "é Stract", o que ficou errado assim que um cliente passou a ter só
  // `meta_api` habilitado (bug real: rótulo "Stract" aparecendo pra uma
  // fonte que não é Stract). Busca o provider de cada fonte habilitada pra
  // nunca mais confundir os dois.
  const [enabledSourceIds, { data: enabledSourceProviderRows }] = await Promise.all([
    getEnabledImportSourceIdsForClient(supabase, clientId),
    supabase.from("import_sources").select("provider").eq("client_id", clientId).eq("enabled", true),
  ]);
  const enabledProviders = new Set((enabledSourceProviderRows ?? []).map((r) => r.provider));
  const hasStractSource = enabledProviders.has("stract");
  const hasMetaApiSource = enabledProviders.has("meta_api");
  const hasAutomaticSyncSource = hasStractSource || hasMetaApiSource;
  // Prioridade de rótulo quando as duas coexistem (estado transitório, ver
  // `lib/meta-sync.ts`): `meta_api` é o caminho mais novo, nunca ambíguo
  // pro gestor qual fonte está realmente alimentando o dado.
  const isMetaApiSyncProvider = hasMetaApiSource;
  const syncProviderLabel = hasAutomaticSyncSource ? (isMetaApiSyncProvider ? "Meta (busca direta)" : "Stract") : null;

  const [latestSyncStatus, latestSpendDate, recentSyncRuns, reportShareLinkStatus, [clientOperationalState], reviewRows] = await Promise.all([
    enabledSourceIds.length > 0 ? getLatestSyncRunStatusForSources(enabledSourceIds) : Promise.resolve(null),
    enabledSourceIds.length > 0 ? getLatestDailySpendDate(supabase, clientId) : Promise.resolve(null),
    isAdmin && enabledSourceIds.length > 0 ? getRecentSyncRunsForClient(supabase, enabledSourceIds) : Promise.resolve([]),
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
    hasAutomaticSyncSource,
    syncProviderLabel,
    isMetaApiSyncProvider,
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
