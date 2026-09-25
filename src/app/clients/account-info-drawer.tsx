"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { SubmitButton } from "@/app/submit-button";
import { ReportShareLinkPanel } from "./report-share-link-panel";

const SYNC_SUBMIT_BUTTON_CLASSES =
  "mitza-pressable inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2.5 text-xs font-medium text-overview-text-secondary transition-colors hover:bg-overview-surface-hover hover:text-overview-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export interface AccountInfoSyncRun {
  id: string;
  statusLabel: string;
  statusBadgeClassName: string;
  startedAtLabel: string;
  countsLabel: string;
  errorMessage: string | null;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-overview-text-muted">{label}</span>
      <span className="text-sm font-medium text-overview-text-primary">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-overview-border pt-3 first:border-t-0 first:pt-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-overview-text-muted">{title}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

/**
 * "Informações da conta" — drawer GLOBAL do workspace do cliente (Etapa
 * "MITZA — Reformulação Estrutural", decisão 4): acessível de qualquer área
 * (Visão geral/Performance/Operação/Demandas/Configurações), renderizado no
 * header persistente (`client-workspace-header.tsx`), nunca mais dentro de
 * uma aba específica. Componente CONTROLADO — quem chama (`AccountInfoDrawerLauncher`)
 * decide quando montar/desmontar via `onClose`; este componente não tem
 * mais trigger nem estado de `open` próprio, pra evitar um segundo botão
 * "Informações da conta" quando embrulhado pelo launcher (que já renderiza
 * o seu).
 *
 * Todo valor chega pronto de `getAccountInfoDrawerDataAction`
 * (`account-info-actions.ts`) — a Server Action que substituiu o antigo
 * "recebe já calculado por `[id]/page.tsx`" (mesmos 3 grupos conceituais:
 * Dados / Sincronização / Operação + Histórico). Sempre o estado ATUAL da
 * conta agora, nunca mais escopado ao mês que uma aba específica estava
 * exibindo — mais correto pra um painel que precisa fazer sentido em
 * qualquer lugar do workspace.
 */
export function AccountInfoDrawer({
  onClose,
  lastPerformanceUpdateValue,
  latestDataDateLabel,
  hasStractSource,
  syncStatusLabel,
  syncStatusBadgeClassName,
  syncStartedAtLabel,
  metaOnlyLastSyncLabel,
  lastOptimizationValue,
  lastOptimizationTooltip,
  canOperate,
  syncAction,
  recentSyncRuns,
  reviewsHistoryHref,
  clientId,
  isAdmin,
  hasActiveReportShareLink,
  reportShareLinkCreatedAtLabel,
  reportShareLinkUrl,
}: {
  onClose: () => void;
  lastPerformanceUpdateValue: string;
  /** `dados até DD/MM` — `null` quando o cliente não tem fonte Stract. */
  latestDataDateLabel: string | null;
  hasStractSource: boolean;
  syncStatusLabel: string;
  syncStatusBadgeClassName: string;
  syncStartedAtLabel: string | null;
  /** Fato cru pra cliente sem fonte Stract (Meta-only) — sem classificação
   * de status, mesma decisão de sempre (não existe "success/partial/failed"
   * pro Meta). */
  metaOnlyLastSyncLabel: string | null;
  lastOptimizationValue: string;
  lastOptimizationTooltip: string | null;
  canOperate: boolean;
  /** Server Action já vinculada ao cliente (`syncClientStractSourcesAction.bind(null, clientId)`)
   * — este componente só a invoca via `<form action>`, nunca reimplementa a
   * sincronização. */
  syncAction: NonNullable<React.ComponentPropsWithoutRef<"form">["action"]>;
  /** Já filtrado pra admin (`isAdmin && recentSyncRuns.length > 0`) por quem
   * chama — vazio pra qualquer outro perfil. */
  recentSyncRuns: AccountInfoSyncRun[];
  reviewsHistoryHref: string;
  clientId: string;
  /** Etapa "Link Externo V1": gerar/revogar o link é admin-only — a seção
   * "Compartilhamento" nem aparece pra gestor. */
  isAdmin: boolean;
  hasActiveReportShareLink: boolean;
  reportShareLinkCreatedAtLabel: string | null;
  /** Etapa "Link Externo — token recuperável": URL completa do link ativo,
   * já pronta pra reexibir a qualquer momento — `null` sem link ativo, ou
   * pra um link ativo criado antes desta etapa (sem valor persistido). */
  reportShareLinkUrl: string | null;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar informações da conta"
        className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30"
      />
      <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col overflow-y-auto border-l border-overview-border bg-overview-surface p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-overview-text-primary">Informações da conta</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-md border border-overview-border p-1.5 text-overview-text-secondary hover:bg-overview-surface-hover"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <Section title="Dados">
            <Row label="Dados atualizados" value={lastPerformanceUpdateValue} />
            {latestDataDateLabel && <Row label="Dados disponíveis até" value={latestDataDateLabel} />}
          </Section>

              {(hasStractSource || metaOnlyLastSyncLabel) && (
                <Section title="Sincronização">
                  {hasStractSource ? (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[11px] text-overview-text-muted">Stract</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${syncStatusBadgeClassName}`}>{syncStatusLabel}</span>
                      </div>
                      {syncStartedAtLabel && <Row label="Última sincronização" value={syncStartedAtLabel} />}
                      {canOperate && (
                        <form action={syncAction} className="mt-1">
                          <SubmitButton pendingChildren="Sincronizando..." className={SYNC_SUBMIT_BUTTON_CLASSES}>
                            Sincronizar agora
                          </SubmitButton>
                        </form>
                      )}
                      {recentSyncRuns.length > 0 && (
                        <details className="mt-1 text-xs text-overview-text-secondary [&_summary::-webkit-details-marker]:hidden">
                          <summary className="cursor-pointer select-none font-medium text-overview-text-primary">Ver últimas sincronizações</summary>
                          <ul className="mt-2 flex flex-col gap-2">
                            {recentSyncRuns.map((run) => (
                              <li key={run.id} className="flex flex-col gap-0.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${run.statusBadgeClassName}`}>{run.statusLabel}</span>
                                  <span>{run.startedAtLabel}</span>
                                </div>
                                {run.countsLabel && <p>{run.countsLabel}</p>}
                                {run.errorMessage && <p className="text-overview-danger">{run.errorMessage}</p>}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  ) : (
                    metaOnlyLastSyncLabel && <Row label="Dados sincronizados" value={metaOnlyLastSyncLabel} />
                  )}
                </Section>
              )}

              {isAdmin && (
                <Section title="Compartilhamento">
                  <p className="text-[11px] text-overview-text-muted">
                    Link do cliente — acesso somente leitura ao Relatório de Performance, sem login.
                  </p>
                  <ReportShareLinkPanel
                    clientId={clientId}
                    initialActive={hasActiveReportShareLink}
                    initialCreatedAtLabel={reportShareLinkCreatedAtLabel}
                    initialUrl={reportShareLinkUrl}
                  />
                </Section>
              )}

              <Section title="Operação">
                <Row label="Última otimização" value={lastOptimizationValue} />
                {lastOptimizationTooltip && <p className="text-xs text-overview-text-muted">{lastOptimizationTooltip}</p>}
              </Section>

              <Section title="Histórico">
                {/* Fecha este drawer ao navegar — leva pra Operação
                    (histórico operacional completo mora lá desde a Etapa
                    "MITZA — Reformulação Estrutural"). */}
                <Link href={reviewsHistoryHref} onClick={onClose} className="text-sm font-medium text-brand hover:underline">
                  Ver histórico completo →
                </Link>
              </Section>

              <Section title="Configurações">
                {/* Etapa "Correção de UX do Workspace" (seção 12 do pedido):
                    Configurações saiu do menu horizontal do cliente — esta é
                    a via de acesso (ação ocasional, nunca competindo com
                    Performance/Operação no dia a dia). Nunca duplica o
                    formulário aqui — só o link pra `/edit`. */}
                <Link href={`/clients/${clientId}/edit`} onClick={onClose} className="text-sm font-medium text-brand hover:underline">
                  Editar configurações →
                </Link>
              </Section>
            </div>
      </div>
    </>
  );
}
