"use client";

import { useRef, useState } from "react";
import { formatCurrency, formatShortDate } from "@/lib/format";
import type { AnalyticsTrend } from "@/lib/analytics";
import { buildSmoothPath, buildTickIndices, scalePoints } from "@/lib/chart-geometry";

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

const CHART_DIMENSIONS = { width: WIDTH, height: HEIGHT, paddingX: PADDING_X, paddingY: PADDING_Y };

export function AnalyticsTrendChart({
  trend,
  events = [],
}: {
  trend: AnalyticsTrend;
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

  const primaryPoints = scalePoints(primary.points, CHART_DIMENSIONS);
  const secondaryPoints = secondary ? scalePoints(secondary.points, CHART_DIMENSIONS) : null;

  const primaryValueLabel = (value: number) => (trend.result ? String(value) : formatCurrency(value));
  const secondaryValueLabel = (value: number) => formatCurrency(value);

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
