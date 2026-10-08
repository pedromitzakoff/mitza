"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatCurrency, formatCount, formatShortDate } from "@/lib/format";
import { formatCostMetric } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import {
  buildNormalizedLineSegments,
  describeCockpitDailyPointState,
  type CockpitDailyEvolutionPoint,
  type NormalizedLinePoint,
} from "@/lib/cockpit-daily-evolution";

export interface CockpitDailyEvolutionSeriesView {
  resultType: PerformanceGoal;
  resultLabel: string;
  costLabel: string;
  /** "Meta Ads + Google Ads" quando o objetivo reúne mais de um canal —
   * mesma convenção de `CockpitResultCardView.channelsLabel`
   * (`cockpit-meta-ritmo-section.tsx`), nunca uma segunda regra. */
  channelsLabel: string | null;
  points: CockpitDailyEvolutionPoint[];
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

/**
 * MITZA ONE — Refinamento visual e analítico da Evolução Diária. Layout em
 * colunas de LARGURA FIXA (em vez do `flex-1` elástico de antes) — condição
 * necessária pra desenhar as linhas de Resultado/Custo por resultado
 * (SVG) alinhadas pixel a pixel com as barras, sem depender de medir o DOM
 * em runtime. A altura do gráfico (`CHART_AREA_HEIGHT_PX`) continua a
 * mesma de antes (seção 6 do pedido: "manter... aproximadamente na altura
 * atual") — só a largura deixou de se esticar pra preencher o contêiner em
 * telas largas.
 *
 * MITZA ONE — Refinamento do Cockpit (seção 5 do pedido): composição
 * invertida da fase anterior — agora só Investimento diário é barra (escala
 * REAL, R$), e Resultado diário / Custo por resultado diário passam a ser
 * LINHAS (normalizadas, 0–1 do próprio máximo na janela — mesma função pura
 * `buildNormalizedLineSegments`, nenhuma fórmula nova). A linha de "meta
 * diária" (dashed) que existia na escala real das barras de Resultado foi
 * removida junto — não existe mais régua real de Resultado pra desenhá-la
 * contra (Resultado agora é normalizado), e normalizar a meta só pra manter
 * a linha introduziria uma aproximação visual que o pedido não pediu.
 */
// MITZA ONE — Ajuste de proporção do Cockpit: cards de Meta & Ritmo e
// Diagnóstico compactados (ver cockpit-meta-ritmo-section.tsx/
// cockpit-diagnostics-card.tsx) abriram espaço vertical na tela — o
// gráfico ganha parte dele (108px -> 150px), continua proporcional
// (barras/linhas/legenda/tooltip inalterados, só a régua vertical cresce).
const CHART_AREA_HEIGHT_PX = 150;
const LABEL_ROW_HEIGHT_PX = 16;
const BAR_MIN_HEIGHT_PX = 3;
const DAY_COLUMN_WIDTH_PX = 20;
const BAR_RECT_WIDTH_PX = 14;
const LINE_STROKE_WIDTH_PX = 1.5;
const LINE_MARKER_RADIUS_PX = 1.5;

/** Visibilidade de cada série — controlada pela legenda interativa (seção 3
 * do pedido), nunca exige reload (estado local do componente). Padrão
 * (Refinamento do Cockpit, seção 5): Investimento (barra) + Resultado
 * (linha) visíveis — a dupla "quanto foi investido / quanto voltou" é a
 * leitura mais imediata; Custo por resultado (linha) disponível via
 * alternância pra não competir visualmente com Resultado no mesmo espaço
 * normalizado por padrão. */
interface SeriesVisibility {
  result: boolean;
  investment: boolean;
  cpl: boolean;
}
const DEFAULT_SERIES_VISIBILITY: SeriesVisibility = { result: true, investment: true, cpl: false };

function formatDayLabel(date: string): string {
  return date.slice(8, 10);
}

function linePointsToPathD(points: NormalizedLinePoint[]): string {
  return points.map((p, index) => `${index === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
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
 * inclusive um tooltip que sobe acima da barra.
 *
 * Correção: `createPortal` pro `document.body` (mesma técnica já usada
 * pelo `Tooltip` oficial da plataforma, `components/ui/tooltip.tsx`) +
 * posicionamento calculado via `getBoundingClientRect` do próprio gatilho,
 * nunca CSS relativo a um ancestral que pode cortar. Funciona
 * independente de qual série esteja visível (seção 4 do pedido) — o
 * gatilho (o `<button>` de cada dia) nunca some, só o CONTEÚDO visual da
 * barra dentro dele depende da visibilidade.
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

/**
 * Legenda interativa (seção 3 do pedido) — 3 botões (um por série), cada um
 * com um selo que já indica o TIPO de série (quadrado = barra, traço =
 * linha), nunca só a cor. `aria-pressed` reflete o estado ligado/desligado
 * pra leitor de tela; alternar é estado local (`useState` no componente
 * pai), nunca um reload.
 */
function SeriesLegend({
  resultLabel,
  costLabel,
  visibility,
  onToggle,
}: {
  resultLabel: string;
  costLabel: string;
  visibility: SeriesVisibility;
  onToggle: (key: keyof SeriesVisibility) => void;
}) {
  const items: { key: keyof SeriesVisibility; label: string; swatch: ReactNode }[] = [
    { key: "investment", label: "Investimento", swatch: <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-blue-500 dark:bg-blue-400" /> },
    { key: "result", label: resultLabel, swatch: <span aria-hidden="true" className="h-0.5 w-3 rounded-full bg-green-500 dark:bg-green-400" /> },
    { key: "cpl", label: costLabel, swatch: <span aria-hidden="true" className="h-0.5 w-3 rounded-full bg-orange-500 dark:bg-orange-400" /> },
  ];

  return (
    <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Séries exibidas no gráfico">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={visibility[item.key]}
          onClick={() => onToggle(item.key)}
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity ${
            visibility[item.key] ? "bg-overview-surface-subtle text-overview-text-primary" : "text-overview-text-muted opacity-50"
          }`}
        >
          {item.swatch}
          {item.label}
        </button>
      ))}
    </div>
  );
}

function DailyEvolutionBar({
  point,
  heightPx,
  resultLabel,
  costLabel,
  showInvestment,
  isOpen,
  onOpen,
  onCloseIfOpen,
  onCloseAll,
}: {
  point: CockpitDailyEvolutionPoint;
  heightPx: number;
  resultLabel: string;
  costLabel: string;
  /** Visibilidade da série "Investimento" (legenda, agora a única barra) —
   * o `<button>` (área de toque/tooltip) NUNCA desaparece quando desligada
   * (seção 4 do pedido: "o tooltip deve funcionar independentemente de qual
   * série esteja visível"); só o retângulo visual da barra some. */
  showInvestment: boolean;
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
    <div
      className="flex shrink-0 flex-col items-center gap-1"
      style={{ width: DAY_COLUMN_WIDTH_PX, height: CHART_AREA_HEIGHT_PX + LABEL_ROW_HEIGHT_PX }}
    >
      <div className="relative flex w-full items-end justify-center" style={{ height: CHART_AREA_HEIGHT_PX }}>
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
          className="group flex h-full w-full items-end justify-center"
        >
          {point.spend !== null && showInvestment && (
            <span
              aria-hidden="true"
              className={`rounded-sm transition-colors ${
                point.spend === 0 ? "bg-overview-border" : "bg-blue-500 group-hover:bg-blue-600 dark:bg-blue-400 dark:group-hover:bg-blue-300"
              }`}
              style={{ width: BAR_RECT_WIDTH_PX, height: `${heightPx}px` }}
            />
          )}
          {point.state === "no_data" && showInvestment && <span aria-hidden="true" className="mb-0.5 h-1 w-1 rounded-full bg-overview-text-muted/50" />}
        </button>
      </div>
      <span className="text-[9px] text-overview-text-muted">{formatDayLabel(point.date)}</span>

      <SmartTooltip anchorRef={anchorRef} open={isOpen}>
        <p className="font-semibold">{formatShortDate(point.date)}</p>
        <p className="mt-0.5">{describeCockpitDailyPointState(point)}</p>
        {point.state === "result" && (
          <>
            <p className="mt-1 text-blue-300 dark:text-blue-700">Investimento: {point.spend !== null ? formatCurrency(point.spend) : "—"}</p>
            <p className="text-green-300 dark:text-green-700">
              {resultLabel}: <span className="font-medium">{formatCount(point.resultCount ?? 0)}</span>
            </p>
            <p className="text-orange-300 dark:text-orange-700">
              {costLabel}: {formatCostMetric(point.costPerResult, formatCurrency)}
            </p>
          </>
        )}
      </SmartTooltip>
    </div>
  );
}

/**
 * MITZA ONE — Refinamento visual e analítico da Evolução Diária: gráfico
 * combinado — barras de Resultado + linhas de Investimento e Custo por
 * resultado, cada série com cor própria (verde/azul/laranja, seção 1 do
 * pedido) e visibilidade controlada pela legenda (seção 3).
 *
 * Escalas (seção 2 do pedido original; seção 5 do Refinamento do Cockpit):
 * as 3 métricas têm unidades diferentes (R$, contagem, R$/resultado) —
 * NUNCA desenhadas sobre a mesma régua. A barra de Investimento continua na
 * escala REAL (R$, igual a antes, só a métrica mudou); as duas linhas
 * (Resultado, Custo por resultado) são normalizadas (0–1 do PRÓPRIO máximo
 * na janela, nunca a escala real de Investimento) e identificadas como tal
 * pela nota abaixo do gráfico — nunca uma normalização silenciosa. Os
 * valores REAIS de todas as séries continuam só no tooltip (seção 6),
 * nunca lidos a partir da altura normalizada da linha.
 */
function DailyEvolutionChart({ series }: { series: CockpitDailyEvolutionSeriesView }) {
  const { points, resultLabel, costLabel } = series;
  // Só UM tooltip ativo por vez (mutuamente exclusivo entre as ~31 barras) —
  // trocar de barra fecha a anterior automaticamente, nunca dois tooltips
  // abertos ao mesmo tempo.
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<SeriesVisibility>(DEFAULT_SERIES_VISIBILITY);

  const maxSpend = Math.max(...points.map((p) => p.spend ?? 0), 1);
  const stats = resolveStatsFromPoints(points);

  const maxResult = Math.max(...points.map((p) => p.resultCount ?? 0), 1);
  const maxCpl = Math.max(...points.map((p) => p.costPerResult ?? 0), 1);
  const resultLine = buildNormalizedLineSegments({
    values: points.map((p) => p.resultCount),
    maxValue: maxResult,
    columnWidthPx: DAY_COLUMN_WIDTH_PX,
    areaHeightPx: CHART_AREA_HEIGHT_PX,
  });
  const cplLine = buildNormalizedLineSegments({
    values: points.map((p) => p.costPerResult),
    maxValue: maxCpl,
    columnWidthPx: DAY_COLUMN_WIDTH_PX,
    areaHeightPx: CHART_AREA_HEIGHT_PX,
  });

  const totalWidthPx = points.length * DAY_COLUMN_WIDTH_PX;

  return (
    <div>
      <SeriesLegend
        resultLabel={resultLabel}
        costLabel={costLabel}
        visibility={visibility}
        onToggle={(key) => setVisibility((prev) => ({ ...prev, [key]: !prev[key] }))}
      />

      <div className="relative mt-2 overflow-x-auto pb-1">
        <div className="relative flex items-start" style={{ width: totalWidthPx }}>
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0"
            width={totalWidthPx}
            height={CHART_AREA_HEIGHT_PX}
            viewBox={`0 0 ${totalWidthPx} ${CHART_AREA_HEIGHT_PX}`}
            preserveAspectRatio="none"
          >
            {visibility.result &&
              resultLine.segments.map((segment, index) => (
                <path
                  key={`result-${index}`}
                  d={linePointsToPathD(segment)}
                  fill="none"
                  className="stroke-green-500 dark:stroke-green-400"
                  strokeWidth={LINE_STROKE_WIDTH_PX}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            {visibility.result &&
              resultLine.markers.map((marker, index) => (
                <circle key={`result-marker-${index}`} cx={marker.x} cy={marker.y} r={LINE_MARKER_RADIUS_PX} className="fill-green-500 dark:fill-green-400" />
              ))}
            {visibility.cpl &&
              cplLine.segments.map((segment, index) => (
                <path
                  key={`cpl-${index}`}
                  d={linePointsToPathD(segment)}
                  fill="none"
                  className="stroke-orange-500 dark:stroke-orange-400"
                  strokeWidth={LINE_STROKE_WIDTH_PX}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            {visibility.cpl &&
              cplLine.markers.map((marker, index) => (
                <circle key={`cpl-marker-${index}`} cx={marker.x} cy={marker.y} r={LINE_MARKER_RADIUS_PX} className="fill-orange-500 dark:fill-orange-400" />
              ))}
          </svg>

          {points.map((point) => (
            <DailyEvolutionBar
              key={point.date}
              point={point}
              heightPx={point.spend !== null ? Math.max((point.spend / maxSpend) * CHART_AREA_HEIGHT_PX, BAR_MIN_HEIGHT_PX) : 0}
              resultLabel={resultLabel}
              costLabel={costLabel}
              showInvestment={visibility.investment}
              isOpen={activeDate === point.date}
              onOpen={() => setActiveDate(point.date)}
              onCloseIfOpen={() => setActiveDate((prev) => (prev === point.date ? null : prev))}
              onCloseAll={() => setActiveDate(null)}
            />
          ))}
        </div>
      </div>

      {(visibility.result || visibility.cpl) && (
        <p className="mt-1 text-[10px] text-overview-text-muted">Linhas em escala relativa (própria de cada série) — valores reais no tooltip.</p>
      )}

      <p className="mt-1 text-xs text-overview-text-secondary">
        Hoje {stats.today ? formatCount(stats.today.resultCount ?? 0) : "—"} · Ontem {stats.yesterday ? formatCount(stats.yesterday.resultCount ?? 0) : "—"} · Média 7d{" "}
        {stats.average7d !== null ? formatCount(stats.average7d) : "—"}/dia
      </p>
    </div>
  );
}

/**
 * MITZA ONE — Evolução Diária no Cockpit: posicionada depois de Meta & Ritmo
 * e Diagnóstico, antes dos Canais (seção 1 do pedido original). Múltiplos
 * objetivos: um botão compacto por objetivo quando o cliente tem mais de um
 * configurado — nunca soma leads com vendas, nunca um seletor de CANAL
 * (isso continua proibido; aqui é só objetivo, já resolvido por
 * `groupChannelsByResultType`, nenhuma segunda regra de agrupamento).
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
