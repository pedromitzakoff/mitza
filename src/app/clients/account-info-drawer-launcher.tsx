"use client";

import { useState } from "react";
import { AccountInfoDrawer, type AccountInfoSyncRun } from "./account-info-drawer";
import { getAccountInfoDrawerDataAction } from "./account-info-actions";
import { syncClientStractSourcesAction } from "./stract-sync-actions";

interface DrawerData {
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
 * Dono do estado `open` + busca sob demanda (Etapa "MITZA — Reformulação
 * Estrutural", decisão 4) — `AccountInfoDrawer` virou controlado (sem
 * trigger/estado próprio) justamente pra este componente ser o único a
 * decidir quando ele existe. Renderizado uma vez no header persistente do
 * workspace (`client-workspace-header.tsx`), nunca em cada aba.
 */
export function AccountInfoDrawerLauncher({ clientId, triggerClassName }: { clientId: string; triggerClassName: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DrawerData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen() {
    setOpen(true);
    setError(null);
    const result = await getAccountInfoDrawerDataAction(clientId);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setData(result);
  }

  return (
    <>
      <button type="button" onClick={handleOpen} className={triggerClassName}>
        Informações da conta
      </button>

      {open &&
        (data ? (
          <AccountInfoDrawer
            onClose={() => setOpen(false)}
            lastPerformanceUpdateValue={data.lastPerformanceUpdateValue}
            latestDataDateLabel={data.latestDataDateLabel}
            hasStractSource={data.hasStractSource}
            syncStatusLabel={data.syncStatusLabel}
            syncStatusBadgeClassName={data.syncStatusBadgeClassName}
            syncStartedAtLabel={data.syncStartedAtLabel}
            metaOnlyLastSyncLabel={data.metaOnlyLastSyncLabel}
            lastOptimizationValue={data.lastOptimizationValue}
            lastOptimizationTooltip={data.lastOptimizationTooltip}
            canOperate={data.canOperate}
            syncAction={syncClientStractSourcesAction.bind(null, clientId)}
            recentSyncRuns={data.recentSyncRuns}
            reviewsHistoryHref={data.reviewsHistoryHref}
            clientId={clientId}
            isAdmin={data.isAdmin}
            hasActiveReportShareLink={data.hasActiveReportShareLink}
            reportShareLinkCreatedAtLabel={data.reportShareLinkCreatedAtLabel}
            reportShareLinkUrl={data.reportShareLinkUrl}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar informações da conta"
              className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30"
            />
            <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col overflow-y-auto border-l border-overview-border bg-overview-surface p-5 shadow-lg">
              <p className="text-sm text-overview-text-secondary">{error ?? "Carregando..."}</p>
            </div>
          </>
        ))}
    </>
  );
}
