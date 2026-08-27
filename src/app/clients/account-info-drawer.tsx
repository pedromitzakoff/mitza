"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { SubmitButton } from "@/app/submit-button";

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
 * "Informações da conta" (Etapa "Refinamento Visual 2.0 — Ajuste de
 * Arquitetura"): a rodada anterior tinha removido a faixa técnica sempre
 * visível do cabeçalho e reunido tudo num disclosure no FIM da página —
 * pouco acessível na prática, ninguém rola até lá. Vira, nesta etapa, uma
 * ação na própria barra de navegação (mesma linguagem visual dos demais
 * itens, nunca `role="tab"` — não troca o conteúdo principal, não mexe na
 * URL) que abre este drawer lateral, mesmo padrão visual dos demais
 * (`mitza-backdrop-in`/`mitza-panel-in`, ver `creative-comparison-drawer.tsx`/
 * `achievement-detail-drawer.tsx`).
 *
 * Reorganização, não reprocessamento: todo valor chega já formatado por
 * `[id]/page.tsx` (mesmas variáveis/cálculos de sempre — `lastOptimization`,
 * `monthPerformanceSummary`, `latestSyncStatus`, `recentSyncRuns` — só
 * reagrupadas em 3 seções conceituais: Dados (o que a Visão Geral está
 * lendo) / Sincronização (saúde da integração) / Operação (acompanhamento
 * humano) + Histórico (link pro drawer já existente,
 * `ClientOperationalHistoryDrawer`, nunca duplicado). "Última revisão" não
 * existe como campo separado de propósito — nesta plataforma otimização
 * JÁ É a revisão da conta (`account_reviews`, ver `LastOptimizationInfo`),
 * um segundo campo duplicaria o mesmo evento.
 *
 * Exceção continua fora daqui: sincronização com problema real aparece nos
 * banners do topo da página (`stractSyncNeedsAttention`, `[id]/page.tsx`),
 * nunca escondida atrás deste drawer — aqui é só para ESTADO SAUDÁVEL,
 * consultável sob demanda.
 */
export function AccountInfoDrawer({
  triggerClassName,
  lastPerformanceUpdateLabel,
  lastPerformanceUpdateValue,
  lastPerformanceUpdateSourceLabel,
  latestDataDateLabel,
  hasStractSource,
  syncStatusLabel,
  syncStatusBadgeClassName,
  syncStartedAtLabel,
  metaOnlyLastSyncLabel,
  lastOptimizationLabel,
  lastOptimizationValue,
  lastOptimizationTooltip,
  canOperate,
  syncAction,
  recentSyncRuns,
  reviewsHistoryHref,
}: {
  triggerClassName: string;
  lastPerformanceUpdateLabel: string;
  lastPerformanceUpdateValue: string;
  lastPerformanceUpdateSourceLabel: string | null;
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
  lastOptimizationLabel: string;
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
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={triggerClassName}>
        Informações da conta
      </button>

      {open && (
        <>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fechar informações da conta"
            className="mitza-backdrop-in fixed inset-0 z-40 bg-black/30"
          />
          <div className="mitza-panel-in fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col overflow-y-auto border-l border-overview-border bg-overview-surface p-5 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-overview-text-primary">Informações da conta</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="shrink-0 rounded-md border border-overview-border p-1.5 text-overview-text-secondary hover:bg-overview-surface-hover"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <Section title="Dados">
                <Row label={lastPerformanceUpdateLabel} value={lastPerformanceUpdateValue} />
                {lastPerformanceUpdateSourceLabel && <Row label="Origem" value={lastPerformanceUpdateSourceLabel} />}
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

              <Section title="Operação">
                <Row label={lastOptimizationLabel} value={lastOptimizationValue} />
                {lastOptimizationTooltip && <p className="text-xs text-overview-text-muted">{lastOptimizationTooltip}</p>}
              </Section>

              <Section title="Histórico">
                {/* Fecha este drawer ao navegar — evita os dois drawers
                    (este + `ClientOperationalHistoryDrawer`) empilhados ao
                    mesmo tempo; o estado local de `open` não reseta sozinho
                    numa navegação client-side (o componente não desmonta). */}
                <Link
                  href={reviewsHistoryHref}
                  scroll={false}
                  onClick={() => setOpen(false)}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  Ver histórico completo →
                </Link>
              </Section>
            </div>
          </div>
        </>
      )}
    </>
  );
}
