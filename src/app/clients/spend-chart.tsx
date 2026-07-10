"use client";

import { useId, useMemo, useState } from "react";
import type { CumulativeSpendPoint } from "@/lib/spend-chart-data";
import { formatCurrency, formatShortDate } from "@/lib/format";

const WIDTH = 720;

/** "compact" é o padrão (card de sprint, dentro do cliente); "large" é
 * usado no gráfico consolidado da agência (Visão Geral), que precisa de
 * mais altura por concentrar todos os clientes numa linha só. */
const SIZES = {
  compact: { height: 90, padding: { top: 8, right: 16, bottom: 16, left: 56 } },
  large: { height: 220, padding: { top: 14, right: 16, bottom: 24, left: 64 } },
} as const;

export function SpendChart({
  points,
  size = "compact",
}: {
  points: CumulativeSpendPoint[];
  size?: "compact" | "large";
}) {
  const gradientId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const HEIGHT = SIZES[size].height;
  const PADDING = SIZES[size].padding;

  const { plannedPath, actualPath, maxValue, xFor, yFor } = useMemo(() => {
    const innerWidth = WIDTH - PADDING.left - PADDING.right;
    const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

    const max = Math.max(
      1,
      ...points.map((p) => p.plannedCumulative),
      ...points.map((p) => p.actualCumulative ?? 0),
    );

    const xFor = (index: number) =>
      PADDING.left + (points.length > 1 ? (index / (points.length - 1)) * innerWidth : 0);
    const yFor = (value: number) => PADDING.top + innerHeight - (value / max) * innerHeight;

    const toPath = (values: (number | null)[]) =>
      values
        .map((value, index) =>
          value === null ? null : `${index === 0 || values[index - 1] === null ? "M" : "L"}${xFor(index)},${yFor(value)}`,
        )
        .filter((segment): segment is string => segment !== null)
        .join(" ");

    return {
      plannedPath: toPath(points.map((p) => p.plannedCumulative)),
      actualPath: toPath(points.map((p) => p.actualCumulative)),
      maxValue: max,
      xFor,
      yFor,
    };
  }, [points, HEIGHT, PADDING]);

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem dados neste mês ainda.</p>;
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const yTicks = [0, 0.5, 1].map((fraction) => fraction * maxValue);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Planejado acumulado x gasto real acumulado no mês"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const relativeX = ((event.clientX - rect.left) / rect.width) * WIDTH;
          const innerWidth = WIDTH - PADDING.left - PADDING.right;
          const ratio = Math.min(1, Math.max(0, (relativeX - PADDING.left) / innerWidth));
          const index = Math.round(ratio * (points.length - 1));
          setHoverIndex(index);
        }}
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={PADDING.left - 8}
              y={yFor(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {formatCurrency(tick)}
            </text>
          </g>
        ))}

        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
          </linearGradient>
        </defs>

        <path d={plannedPath} fill="none" stroke="currentColor" className="text-zinc-400 dark:text-zinc-600" strokeWidth={2} strokeDasharray="4 4" />
        <path d={actualPath} fill="none" stroke="var(--color-brand)" strokeWidth={2.5} strokeLinecap="round" />

        {hovered && (
          <line
            x1={xFor(hoverIndex!)}
            x2={xFor(hoverIndex!)}
            y1={PADDING.top}
            y2={HEIGHT - PADDING.bottom}
            className="stroke-border"
            strokeWidth={1}
          />
        )}

        {points.map(
          (point, index) =>
            index % Math.ceil(points.length / 8) === 0 && (
              <text
                key={point.date}
                x={xFor(index)}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {formatShortDate(point.date)}
              </text>
            ),
        )}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm"
          style={{
            left: `${(xFor(hoverIndex!) / WIDTH) * 100}%`,
            transform: hoverIndex! > points.length / 2 ? "translateX(-105%)" : "translateX(5%)",
          }}
        >
          <p className="font-medium text-foreground">{formatShortDate(hovered.date)}</p>
          <p className="text-zinc-500 dark:text-zinc-400">
            Planejado: {formatCurrency(hovered.plannedCumulative)}
          </p>
          {hovered.actualCumulative !== null && (
            <p style={{ color: "var(--color-brand)" }}>
              Real: {formatCurrency(hovered.actualCumulative)}
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t-2 border-dashed border-zinc-400 dark:border-zinc-600" />
          Planejado acumulado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ backgroundColor: "var(--color-brand)" }} />
          Gasto real acumulado
        </span>
      </div>
    </div>
  );
}
