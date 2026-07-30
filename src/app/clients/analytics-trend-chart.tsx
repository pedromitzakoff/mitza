"use client";

import { useRef, useState } from "react";
import { formatShortDate } from "@/lib/format";
import type { AnalyticsTrend } from "@/lib/analytics";

/**
 * Gráfico de evolução diária — Etapa "Analytics Instagramável" (facelift):
 * era uma sparkline estática (sem eixo, sem hover); agora é o elemento
 * visual PRINCIPAL da página, com crosshair + tooltip, linhas suaves, eixo
 * X legível e pontos discretos só no hover — seguindo a régua do skill de
 * dataviz (marca fina, 1 hue por série, sem dual-axis numérico, hover
 * sempre presente em gráfico de linha). Continua um SVG desenhado à mão,
 * sem lib nova — só ganhou uma camada de interação client-side.
 *
 * Cada série continua normalizada ao PRÓPRIO intervalo (nunca um eixo
 * numérico absoluto compartilhado entre investimento e resultado — leitura
 * é sempre de TENDÊNCIA relativa, nunca de comparação de valor entre as
 * duas, mesmo princípio de sempre).
 *
 * `events` é opcional e ainda não alimentado por dado real (nenhuma
 * funcionalidade nova nesta etapa) — só existe pra já preparar o layout pra
 * marcar otimizações na linha do tempo no futuro, sem precisar redesenhar o
 * componente quando esse dado existir.
 */
const WIDTH = 720;
const HEIGHT = 220;
const PADDING_X = 8;
const PADDING_Y = 16;
const GRIDLINES = 3;

export interface AnalyticsChartEvent {
  date: string;
  label: string;
}

interface ScaledPoint {
  x: number;
  y: number;
  date: string;
  value: number;
}

function scalePoints(points: { date: string; value: number }[]): ScaledPoint[] {
  if (points.length === 0) return [];
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = points.length > 1 ? (WIDTH - PADDING_X * 2) / (points.length - 1) : 0;

  return points.map((point, index) => ({
    x: PADDING_X + index * stepX,
    y: HEIGHT - PADDING_Y - ((point.value - min) / range) * (HEIGHT - PADDING_Y * 2),
    date: point.date,
    value: point.value,
  }));
}

/** Curva suave (Catmull-Rom → Bézier cúbica, tensão 1/6) — "linhas suaves"
 * pedidas explicitamente, sem overshoot perceptível e sem biblioteca nova. */
function buildSmoothPath(points: ScaledPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;

  let d = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

/** Índices de tick do eixo X — no máximo 5, sempre incluindo o primeiro e o
 * último dia, distribuídos uniformemente (nunca um tick por dia: eixo denso
 * não é legível). */
function buildTickIndices(length: number): number[] {
  if (length <= 1) return length === 1 ? [0] : [];
  const tickCount = Math.min(5, length);
  const indices = Array.from({ length: tickCount }, (_, i) => Math.round((i * (length - 1)) / (tickCount - 1)));
  return Array.from(new Set(indices));
}

export function AnalyticsTrendChart({
  trend,
  formatCurrencyValue,
  events = [],
}: {
  trend: AnalyticsTrend;
  formatCurrencyValue: (value: number) => string;
  events?: AnalyticsChartEvent[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // A métrica de resultado é sempre a série principal quando existe
  // (prioridade do pedido original: resultado > investimento) — sem ela
  // (fluxo manual, sem granularidade diária), investimento vira a única
  // série, nunca um gráfico vazio.
  const primary = trend.result ?? trend.spend;
  const secondary = trend.result ? trend.spend : null;

  const primaryPoints = scalePoints(primary.points);
  const secondaryPoints = secondary ? scalePoints(secondary.points) : null;

  const primaryValueLabel = (value: number) => (trend.result ? String(value) : formatCurrencyValue(value));
  const secondaryValueLabel = (value: number) => formatCurrencyValue(value);

  const tickIndices = buildTickIndices(primaryPoints.length);
  const eventPositions = events
    .map((event) => ({ event, index: primary.points.findIndex((p) => p.date === event.date) }))
    .filter((e): e is { event: AnalyticsChartEvent; index: number } => e.index >= 0);

  function handleMouseMove(clientX: number) {
    const container = containerRef.current;
    if (!container || primaryPoints.length === 0) return;
    const rect = container.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const index = Math.round(ratio * (primaryPoints.length - 1));
    setHoverIndex(index);
  }

  const hovered = hoverIndex !== null ? primaryPoints[hoverIndex] : null;
  const hoveredSecondary = hoverIndex !== null ? (secondaryPoints?.[hoverIndex] ?? null) : null;
  const tooltipLeftPercent = hovered ? (hovered.x / WIDTH) * 100 : 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--brand)" }} aria-hidden="true" />
          <span className="text-muted-foreground">{primary.label}</span>
        </span>
        {secondary && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--muted-foreground)" }} aria-hidden="true" />
            <span className="text-muted-foreground">{secondary.label}</span>
          </span>
        )}
      </div>

      <div ref={containerRef} className="relative mt-3">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="mitza-backdrop-in h-56 w-full"
          role="img"
          aria-label={`Evolução diária de ${primary.label}${secondary ? ` e ${secondary.label}` : ""} no período`}
          onMouseMove={(e) => handleMouseMove(e.clientX)}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {Array.from({ length: GRIDLINES }, (_, i) => {
            const y = PADDING_Y + (i * (HEIGHT - PADDING_Y * 2)) / (GRIDLINES - 1);
            return <line key={i} x1={0} y1={y} x2={WIDTH} y2={y} stroke="var(--border-default)" strokeWidth={1} opacity={0.6} />;
          })}

          {hovered && (
            <line x1={hovered.x} y1={PADDING_Y} x2={hovered.x} y2={HEIGHT - PADDING_Y} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.5} />
          )}

          {secondaryPoints && (
            <path d={buildSmoothPath(secondaryPoints)} fill="none" stroke="var(--muted-foreground)" strokeWidth={2} strokeLinecap="round" opacity={0.55} />
          )}
          <path d={buildSmoothPath(primaryPoints)} fill="none" stroke="var(--brand)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

          {eventPositions.map(({ event, index }) => (
            <circle key={event.date} cx={primaryPoints[index].x} cy={primaryPoints[index].y} r={3.5} fill="var(--card)" stroke="var(--brand)" strokeWidth={2} />
          ))}

          {hoveredSecondary && <circle cx={hoveredSecondary.x} cy={hoveredSecondary.y} r={3} fill="var(--card)" stroke="var(--muted-foreground)" strokeWidth={2} />}
          {hovered && <circle cx={hovered.x} cy={hovered.y} r={4} fill="var(--card)" stroke="var(--brand)" strokeWidth={2.5} />}
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute top-0 flex -translate-x-1/2 flex-col gap-1 rounded-lg border border-border bg-card px-2.5 py-2 text-xs shadow-[var(--shadow-float)]"
            style={{ left: `${tooltipLeftPercent}%` }}
          >
            <p className="font-medium text-foreground">{formatShortDate(hovered.date)}</p>
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--brand)" }} aria-hidden="true" />
              {primary.label}: <span className="font-medium text-foreground">{primaryValueLabel(hovered.value)}</span>
            </p>
            {hoveredSecondary && (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--muted-foreground)" }} aria-hidden="true" />
                {secondary!.label}: <span className="font-medium text-foreground">{secondaryValueLabel(hoveredSecondary.value)}</span>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="relative mt-1 h-4 text-[11px] text-muted-foreground">
        {tickIndices.map((index) => (
          <span
            key={index}
            className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
            style={{ left: `${(primaryPoints[index].x / WIDTH) * 100}%` }}
          >
            {formatShortDate(primaryPoints[index].date)}
          </span>
        ))}
      </div>
    </div>
  );
}
