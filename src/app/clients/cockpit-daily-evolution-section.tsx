"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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

const TOOLTIP_WIDTH_PX = 160;
const TOOLTIP_VIEWPORT_MARGIN_PX = 8;
const TOOLTIP_ANCHOR_GAP_PX = 6;

/**
 * Etapa "Correção do tooltip da Evolução Diária": o tooltip antigo era um
 * `<div>` posicionado `absolute bottom-full` DENTRO da própria barra — a
 * linha de barras usa `overflow-x-auto` (rolagem horizontal pras ~31
 * barras do mês), e por regra do próprio CSS (não um bug do Tailwind):
 * definir `overflow-x` como algo diferente de `visible` força o
 * `overflow-y` (que ficava `visible` na prática) a virar `auto` também —
 * o contêiner passa a cortar QUALQUER conteúdo que estoure sua altura,
 * inclusive um tooltip que sobe acima da barra. Era exatamente esse corte
 * visto no topo do tooltip (nunca `z-index`: o tooltip já vencia a pilha,
 * só não tinha como aparecer fora da CAIXA que o cortava).
 *
 * Correção: `createPortal` pro `document.body` (mesma técnica já usada
 * pelo `Tooltip` oficial da plataforma, `components/ui/tooltip.tsx`) +
 * posicionamento calculado via `getBoundingClientRect` do próprio gatilho,
 * nunca CSS relativo a um ancestral que pode cortar. Como o tooltip some
 * da árvore de layout da barra (só existe em `document.body`, com
 * `position: fixed`), ele nunca altera a altura/largura do gráfico nem
 * provoca rolagem nova — só se sobrepõe visualmente ao conteúdo da página.
 *
 * Posicionamento "inteligente": prefere ACIMA do gatilho; se não houver
 * espaço (barra do dia 01 bem no topo da viewport, por exemplo — raro,
 * mas a regra é geométrica, não por índice do dia), abre ABAIXO. Na
 * horizontal, centra no gatilho mas sempre dentro da viewport (`clamp`
 * entre `TOOLTIP_VIEWPORT_MARGIN_PX` e a borda direita) — cobre as barras
 * das EXTREMIDADES do gráfico (dia 01 e dia 31), que antes empurravam o
 * tooltip pra fora da área visível/rolável.
 *
 * Mede o próprio tooltip (`tooltipRef`) em vez de estimar altura/largura —
 * funciona igual pra qualquer barra (seção 2 do pedido de correção:
 * "independentemente da altura da barra selecionada") e pra qualquer
 * conteúdo (tooltip de `no_data`/`future`, com só 2 linhas, é mais baixo
 * que o de `result`, com até 6). `useLayoutEffect` mede e reposiciona ANTES
 * do navegador pintar a tela — o tooltip só fica `visible` depois de já
 * estar na posição certa, nunca aparece "pulando" de um canto pro outro.
 */
function SmartTooltip({
  anchorRef,
  open,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  children: ReactNode;
}) {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    function measure() {
      if (!open) {
        setPosition(null);
        return;
      }
      const anchor = anchorRef.current;
      const tooltip = tooltipRef.current;
      if (!anchor) return;

      const anchorRect = anchor.getBoundingClientRect();
      const tooltipWidth = tooltip?.offsetWidth ?? TOOLTIP_WIDTH_PX;
      const tooltipHeight = tooltip?.offsetHeight ?? 0;

      const fitsAbove = anchorRect.top - tooltipHeight - TOOLTIP_ANCHOR_GAP_PX >= TOOLTIP_VIEWPORT_MARGIN_PX;
      let top = fitsAbove
        ? anchorRect.top - tooltipHeight - TOOLTIP_ANCHOR_GAP_PX
        : anchorRect.bottom + TOOLTIP_ANCHOR_GAP_PX;
      // Mesmo abrindo abaixo, nunca deixa estourar o rodapé da viewport
      // (ex.: gráfico perto do fim da página numa tela baixa).
      top = Math.min(top, window.innerHeight - tooltipHeight - TOOLTIP_VIEWPORT_MARGIN_PX);
      top = Math.max(top, TOOLTIP_VIEWPORT_MARGIN_PX);

      let left = anchorRect.left + anchorRect.width / 2 - tooltipWidth / 2;
      left = Math.min(left, window.innerWidth - tooltipWidth - TOOLTIP_VIEWPORT_MARGIN_PX);
      left = Math.max(left, TOOLTIP_VIEWPORT_MARGIN_PX);

      setPosition({ top, left });
    }

    measure();
  }, [open, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      className="pointer-events-none fixed z-50 w-40 rounded-md bg-zinc-900 p-2 text-[11px] text-zinc-100 shadow-[var(--shadow-float)] dark:bg-zinc-100 dark:text-zinc-900"
      style={position ? { top: position.top, left: position.left, visibility: "visible" } : { top: 0, left: 0, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}

function DailyEvolutionBar({
  point,
  heightPx,
  resultLabel,
  costLabel,
  dailyTarget,
  isOpen,
  onOpen,
  onCloseIfOpen,
  onCloseAll,
}: {
  point: CockpitDailyEvolutionPoint;
  heightPx: number;
  resultLabel: string;
  costLabel: string;
  dailyTarget: number | null;
  isOpen: boolean;
  /** Abre SEMPRE este dia (nunca um toggle) — hover/foco/toque entrando
   * aqui simplesmente afirmam "este é o tooltip ativo agora"; trocar de
   * barra fecha a anterior sozinho (só uma pode estar ativa por vez). */
  onOpen: () => void;
  /** Fecha só se ESTE dia ainda for o ativo — evita que um `mouseleave`/
   * `blur` tardio de uma barra feche o tooltip de OUTRA que já abriu
   * depois (ex.: mouse saindo da barra A exatamente quando o foco já
   * passou pra barra B). */
  onCloseIfOpen: () => void;
  onCloseAll: () => void;
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="flex min-w-[18px] flex-1 flex-col items-center gap-1" style={{ height: BAR_AREA_HEIGHT_PX + 16 }}>
      <div className="flex w-full flex-1 items-end justify-center">
        <button
          ref={anchorRef}
          type="button"
          onMouseEnter={onOpen}
          onMouseLeave={onCloseIfOpen}
          onFocus={onOpen}
          onBlur={onCloseIfOpen}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCloseAll();
          }}
          aria-label={`${formatShortDate(point.date)}: ${describeCockpitDailyPointState(point)}`}
          className={
            point.state === "result"
              ? `w-full rounded-sm transition-colors ${point.resultCount === 0 ? "bg-overview-border" : "bg-overview-brand-subtle hover:bg-brand"}`
              : "flex h-full w-full items-end justify-center"
          }
          style={point.state === "result" ? { height: `${heightPx}px` } : undefined}
        >
          {point.state === "no_data" && <span className="mb-0.5 h-1 w-1 rounded-full bg-overview-text-muted/50" />}
        </button>
      </div>
      <span className="text-[9px] text-overview-text-muted">{formatDayLabel(point.date)}</span>

      <SmartTooltip anchorRef={anchorRef} open={isOpen}>
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
      </SmartTooltip>
    </div>
  );
}

function DailyEvolutionChart({ series }: { series: CockpitDailyEvolutionSeriesView }) {
  const { points, dailyTarget, resultLabel, costLabel } = series;
  // Só UM tooltip ativo por vez (mutuamente exclusivo entre as ~31 barras) —
  // trocar de barra fecha a anterior automaticamente, nunca dois tooltips
  // abertos ao mesmo tempo.
  const [activeDate, setActiveDate] = useState<string | null>(null);

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
        {points.map((point) => (
          <DailyEvolutionBar
            key={point.date}
            point={point}
            heightPx={point.state === "result" ? Math.max(((point.resultCount ?? 0) / maxValue) * BAR_AREA_HEIGHT_PX, BAR_MIN_HEIGHT_PX) : 0}
            resultLabel={resultLabel}
            costLabel={costLabel}
            dailyTarget={dailyTarget}
            isOpen={activeDate === point.date}
            onOpen={() => setActiveDate(point.date)}
            onCloseIfOpen={() => setActiveDate((prev) => (prev === point.date ? null : prev))}
            onCloseAll={() => setActiveDate(null)}
          />
        ))}
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
