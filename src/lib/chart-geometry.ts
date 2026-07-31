/**
 * Geometria pura do gráfico de evolução diária — extraída de
 * `analytics-trend-chart.tsx` (Etapa "Analytics Instagramável") pra ser
 * reaproveitada também pelo renderer estático do AnalyticsReport
 * (`lib/analytics-report/renderers/html-renderer.ts`): o MESMO cálculo de
 * curva/eixo em pixel produz o SVG interativo da tela e o SVG estático do
 * PDF — nunca duas fórmulas de geometria divergindo entre os dois lugares.
 * Sem Supabase, sem React — só matemática determinística a partir de
 * `{date, value}[]`.
 */

export interface ScaledPoint {
  x: number;
  y: number;
  date: string;
  value: number;
}

export interface ChartDimensions {
  width: number;
  height: number;
  paddingX: number;
  paddingY: number;
}

export function scalePoints(points: { date: string; value: number }[], dims: ChartDimensions): ScaledPoint[] {
  if (points.length === 0) return [];
  const { width, height, paddingX, paddingY } = dims;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = points.length > 1 ? (width - paddingX * 2) / (points.length - 1) : 0;

  return points.map((point, index) => ({
    x: paddingX + index * stepX,
    y: height - paddingY - ((point.value - min) / range) * (height - paddingY * 2),
    date: point.date,
    value: point.value,
  }));
}

/** Curva suave (Catmull-Rom → Bézier cúbica, tensão 1/6) — sem overshoot
 * perceptível, sem biblioteca de gráficos. */
export function buildSmoothPath(points: ScaledPoint[]): string {
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
 * último dia, distribuídos uniformemente. */
export function buildTickIndices(length: number): number[] {
  if (length <= 1) return length === 1 ? [0] : [];
  const tickCount = Math.min(5, length);
  const indices = Array.from({ length: tickCount }, (_, i) => Math.round((i * (length - 1)) / (tickCount - 1)));
  return Array.from(new Set(indices));
}
