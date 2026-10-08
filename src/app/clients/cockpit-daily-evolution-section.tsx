"use client";

import { useState } from "react";
import { formatCurrency, formatCount, formatShortDate } from "@/lib/format";
import { formatCostMetric } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { describeCockpitDailyPointState, type CockpitDailyEvolutionPoint } from "@/lib/cockpit-daily-evolution";

export interface CockpitDailyEvolutionSeriesView {
  resultType: PerformanceGoal;
  resultLabel: string;
  costLabel: string;
  /** "Meta Ads + Google Ads" quando o objetivo reúne mais de um canal —
   * mesma convenção de `CockpitResultCardView.channelsLabel`
   * (`cockpit-meta-ritmo-section.tsx`), nunca uma segunda regra. */
  channelsLabel: string | null;
  points: CockpitDailyEvolutionPoint[];
  dailyTarget: number | null;
}

export interface CockpitDailyEvolutionFreshnessView {
  /** "Dados até DD/MM", já formatado — `null` = frescor desconhecido
   * (nenhuma fonte habilitada tem `last_imported_date` ainda; nunca uma
   * data inventada). */
  latestDataLabel: string | null;
  /** "há X" relativo — `null` = nenhuma fonte habilitada sincronizou com
   * sucesso ainda. Sempre distinto do campo acima (seção 5 do pedido). */
  latestSyncLabel: string | null;
}

export type CockpitDailyEvolutionView =
  | { kind: "no_goal" }
  | { kind: "unavailable" }
  | { kind: "available"; series: CockpitDailyEvolutionSeriesView[]; freshness: CockpitDailyEvolutionFreshnessView };

const BAR_AREA_HEIGHT_PX = 108;
const BAR_MIN_HEIGHT_PX = 3;

function formatDayLabel(date: string): string {
  return date.slice(8, 10);
}

/** Último ponto com `state === "result"` dentre os últimos `count`
 * (cronológicos) — base de "Hoje"/"Ontem"/"Média 7d", nunca um índice fixo
 * (um mês com dias futuros no fim não pode fazer "Hoje" apontar pro
 * último elemento do array, que seria um dia futuro). */
function resolveStatsFromPoints(points: CockpitDailyEvolutionPoint[]) {
  const confirmed = points.filter((p) => p.state === "result");
  const today = confirmed.at(-1) ?? null;
  const yesterday = confirmed.length > 1 ? confirmed.at(-2)! : null;
  const last7 = confirmed.slice(-7);
  const average7d = last7.length > 0 ? last7.reduce((sum, p) => sum + (p.resultCount ?? 0), 0) / last7.length : null;
  return { today, yesterday, average7d };
}

function DailyEvolutionChart({ series }: { series: CockpitDailyEvolutionSeriesView }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const { points, dailyTarget, resultLabel, costLabel } = series;

  const maxValue = Math.max(...points.map((p) => p.resultCount ?? 0), dailyTarget ?? 0, 1);
  const targetLinePct = dailyTarget !== null ? Math.min(100, (dailyTarget / maxValue) * 100) : null;
  const stats = resolveStatsFromPoints(points);

  return (
    <div>
      <div className="relative mt-2 flex items-end gap-1 overflow-x-auto pb-1" style={{ height: BAR_AREA_HEIGHT_PX + 28 }}>
        {targetLinePct !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-overview-border"
            style={{ bottom: `${targetLinePct}%`, height: BAR_AREA_HEIGHT_PX }}
          />
        )}
        {points.map((point, index) => {
          const isActive = activeIndex === index;
          const heightPx = point.state === "result" ? Math.max(((point.resultCount ?? 0) / maxValue) * BAR_AREA_HEIGHT_PX, BAR_MIN_HEIGHT_PX) : 0;

          return (
            <div key={point.date} className="group relative flex min-w-[18px] flex-1 flex-col items-center gap-1" style={{ height: BAR_AREA_HEIGHT_PX + 16 }}>
              <div className="flex w-full flex-1 items-end justify-center">
                {point.state === "result" ? (
                  <button
                    type="button"
                    onClick={() => setActiveIndex((prev) => (prev === index ? null : index))}
                    aria-label={`${formatShortDate(point.date)}: ${describeCockpitDailyPointState(point)}`}
                    className={`w-full rounded-sm transition-colors ${point.resultCount === 0 ? "bg-overview-border" : "bg-overview-brand-subtle group-hover:bg-brand"}`}
                    style={{ height: `${heightPx}px` }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveIndex((prev) => (prev === index ? null : index))}
                    aria-label={`${formatShortDate(point.date)}: ${describeCockpitDailyPointState(point)}`}
                    className="flex h-full w-full items-end justify-center"
                  >
                    {point.state === "no_data" && <span className="mb-0.5 h-1 w-1 rounded-full bg-overview-text-muted/50" />}
                  </button>
                )}
              </div>
              <span className="text-[9px] text-overview-text-muted">{formatDayLabel(point.date)}</span>

              <div
                role="tooltip"
                className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-40 -translate-x-1/2 rounded-md bg-zinc-900 p-2 text-[11px] text-zinc-100 shadow-[var(--shadow-float)] dark:bg-zinc-100 dark:text-zinc-900 ${
                  isActive ? "visible opacity-100" : "invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
                } transition-opacity`}
              >
                <p className="font-semibold">{formatShortDate(point.date)}</p>
                <p className="mt-0.5">{describeCockpitDailyPointState(point)}</p>
                {point.state === "result" && (
                  <>
                    <p className="mt-1">
                      {resultLabel}: <span className="font-medium">{formatCount(point.resultCount ?? 0)}</span>
                    </p>
                    {dailyTarget !== null && <p>Meta diária: {formatCount(dailyTarget)}</p>}
                    <p>Investimento: {point.spend !== null ? formatCurrency(point.spend) : "—"}</p>
                    <p>
                      {costLabel}: {formatCostMetric(point.costPerResult, formatCurrency)}
                    </p>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-1 text-xs text-overview-text-secondary">
        Hoje {stats.today ? formatCount(stats.today.resultCount ?? 0) : "—"} · Ontem {stats.yesterday ? formatCount(stats.yesterday.resultCount ?? 0) : "—"} · Média 7d{" "}
        {stats.average7d !== null ? formatCount(stats.average7d) : "—"}/dia
      </p>
    </div>
  );
}

/**
 * MITZA ONE — Evolução Diária no Cockpit: posicionada depois de Meta & Ritmo
 * e Diagnóstico, antes dos Canais (seção 1 do pedido). Combina barras
 * (resultado realizado por dia) + referência de meta diária, quando
 * disponível — nunca investimento/CPL/CPA no próprio gráfico (seção 2 do
 * pedido deixa a linha de custo OPCIONAL, "somente se melhorar a leitura";
 * num espaço de ~280px com 28-31 barras, uma segunda linha com eixo próprio
 * prejudicaria a legibilidade mais do que ajudaria — decisão documentada no
 * relatório de entrega). Investimento/CPL/CPA ficam só no tooltip, onde o
 * pedido já os exige de qualquer forma.
 *
 * Múltiplos objetivos (seção 4 do pedido): um botão compacto por objetivo
 * quando o cliente tem mais de um configurado — nunca soma leads com
 * vendas, nunca um seletor de CANAL (isso continua proibido; aqui é só
 * objetivo, já resolvido por `groupChannelsByResultType`, nenhuma segunda
 * regra de agrupamento).
 */
export function CockpitDailyEvolutionSection({ view }: { view: CockpitDailyEvolutionView }) {
  const [selectedGoal, setSelectedGoal] = useState<PerformanceGoal | null>(
    view.kind === "available" ? view.series[0]?.resultType ?? null : null,
  );

  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Evolução Diária</h2>
        {view.kind === "available" && (
          <p className="shrink-0 text-right text-[11px] text-overview-text-muted">
            {view.freshness.latestDataLabel ? `Dados até ${view.freshness.latestDataLabel}` : "Frescor dos dados: desconhecido"}
            {view.freshness.latestSyncLabel && <span className="block">Última sincronização: {view.freshness.latestSyncLabel}</span>}
          </p>
        )}
      </div>

      {view.kind === "no_goal" && <p className="mt-3 text-sm text-overview-text-secondary">Este cliente ainda não tem um objetivo de performance configurado.</p>}
      {view.kind === "unavailable" && <p className="mt-3 text-sm text-overview-text-secondary">Sem dados diários disponíveis para este cliente.</p>}

      {view.kind === "available" && (
        <>
          {view.series.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {view.series.map((s) => (
                <button
                  key={s.resultType}
                  type="button"
                  onClick={() => setSelectedGoal(s.resultType)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    selectedGoal === s.resultType ? "bg-brand text-white" : "bg-overview-surface-subtle text-overview-text-secondary"
                  }`}
                >
                  {s.resultLabel}
                  {s.channelsLabel ? ` · ${s.channelsLabel}` : ""}
                </button>
              ))}
            </div>
          )}

          {view.series
            .filter((s) => s.resultType === selectedGoal)
            .map((s) => <DailyEvolutionChart key={s.resultType} series={s} />)}
        </>
      )}
    </div>
  );
}
