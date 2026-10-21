"use client";

import { useId, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency, formatCount, formatPercent, formatShortDate } from "@/lib/format";
import {
  CHART_METRIC_IDS,
  type ChartMetricId,
  type ChartMetricSeries,
  type ChartMetricUnit,
  type ChartSeriesPoint,
} from "@/lib/meta-ads-dashboard/evolution-data";

/**
 * MITZA ONE — KOFF Analytics Fase 2, Etapa 2.3 (Gráficos interativos).
 * Seção "Evolução da performance" do Dashboard Meta Ads — Recharts
 * (aprovado pelo usuário), identidade KOFF (grafite/areia/branco — nenhuma
 * cor nova: a linha do período atual é `#17171A`, a do período
 * anterior/segunda métrica é `#6F6B65`, a MESMA paleta já usada em todo o
 * resto do dashboard).
 *
 * Três modos de comparação (pedido do usuário, itens 5/6 — nunca
 * simultâneos, pra nunca misturar semânticas diferentes no mesmo
 * gráfico):
 * - "Sem comparação": 1 linha, a métrica selecionada, só o período atual.
 * - "Período anterior": 2 linhas NO MESMO gráfico (mesmo eixo Y, mesma
 *   unidade — a MESMA métrica nos dois períodos, nunca um dual-axis),
 *   alinhadas por posição (dia 1 do período atual com dia 1 do anterior,
 *   nunca por data civil — os dois períodos têm datas diferentes).
 * - "Outra métrica": 2 PAINÉIS separados, cada um com seu próprio eixo Y
 *   corretamente escalado pra sua própria unidade — nunca dois eixos na
 *   MESMA área de plotagem (pedido explícito do usuário: "sem misturar
 *   valores incompatíveis no mesmo eixo").
 *
 * Todo dado já vem pronto do servidor (`series`, `MetaAdsDashboardData.evolution`)
 * — este componente nunca recalcula métrica nenhuma, só decide o que
 * mostrar. Pontos `null` (dia sem nenhum registro) quebram a linha
 * (`connectNulls={false}`) em vez de interpolar ou virar zero.
 */

function formatMetricValue(unit: ChartMetricUnit, value: number): string {
  switch (unit) {
    case "currency":
      return formatCurrency(value);
    case "percent":
      return formatPercent(value * 100);
    case "ratio":
      return `${value.toFixed(2)}x`;
    case "count":
      return formatCount(value);
  }
}

type CompareMode = "none" | "previous_period" | "other_metric";

type ChartRow = Record<string, string | number | null>;

function buildSingleRows(points: ChartSeriesPoint[]): ChartRow[] {
  return points.map((point) => ({ date: point.date, value: point.value }));
}

/** Alinha o período atual e o anterior por POSIÇÃO (índice), nunca por
 * data civil — `previousEquivalentPeriod` garante a mesma duração, então
 * `current[i]`/`previous[i]` são sempre "dia i" de cada período. */
function buildOverlayRows(current: ChartSeriesPoint[], previous: ChartSeriesPoint[]): ChartRow[] {
  return current.map((point, index) => ({
    date: point.date,
    previousDate: previous[index]?.date ?? null,
    current: point.value,
    previous: previous[index]?.value ?? null,
  }));
}

const SELECT_CLASS = "min-h-9 rounded-lg border border-[#D9D3C9] bg-white px-2 text-xs text-[#17171A]";

interface ChartLineConfig {
  dataKey: string;
  name: string;
  color: string;
  dashed?: boolean;
}

function EvolutionChartPanel({
  title,
  unit,
  rows,
  lines,
}: {
  title: string;
  unit: ChartMetricUnit;
  rows: ChartRow[];
  lines: ChartLineConfig[];
}) {
  return (
    <div className="rounded-xl border border-[#D9D3C9] bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-[#6F6B65]">{title}</div>
      <div className="mt-3 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#EFE9E0" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => formatShortDate(value)}
              tick={{ fontSize: 11, fill: "#6F6B65" }}
              axisLine={{ stroke: "#D9D3C9" }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(value: number) => formatMetricValue(unit, value)}
              tick={{ fontSize: 11, fill: "#6F6B65" }}
              axisLine={false}
              tickLine={false}
              width={76}
            />
            <Tooltip
              formatter={(value) => (typeof value === "number" ? formatMetricValue(unit, value) : value)}
              labelFormatter={(label) => (typeof label === "string" ? formatShortDate(label) : label)}
              contentStyle={{ borderRadius: 8, borderColor: "#D9D3C9", fontSize: 12 }}
            />
            {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {lines.map((line) => (
              <Line
                key={line.dataKey}
                type="monotone"
                dataKey={line.dataKey}
                name={line.name}
                stroke={line.color}
                strokeWidth={2}
                strokeDasharray={line.dashed ? "5 4" : undefined}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function EvolutionSection({ series }: { series: ChartMetricSeries[] }) {
  const [metricAId, setMetricAId] = useState<ChartMetricId>("investment");
  const [compareMode, setCompareMode] = useState<CompareMode>("none");
  const [metricBId, setMetricBId] = useState<ChartMetricId>("results");
  const formId = useId();

  const seriesById = useMemo(() => new Map(series.map((item) => [item.id, item])), [series]);
  const metricA = seriesById.get(metricAId) ?? series[0];
  const metricB = compareMode === "other_metric" ? seriesById.get(metricBId) : undefined;

  // Nenhuma memoização manual aqui — o cálculo é barato (mapear, no máximo,
  // os dias do período selecionado) e `metricA`/`metricB` já são, eles
  // próprios, derivados a cada render (busca em `seriesById`), então uma
  // dependência `useMemo` nunca ficaria estável o bastante pra valer a pena.
  const singleRows = buildSingleRows(metricA.current);
  const overlayRows = buildOverlayRows(metricA.current, metricA.previous);
  const metricBRows = metricB ? buildSingleRows(metricB.current) : [];

  return (
    <section className="mt-6">
      <h2 className="text-lg font-bold tracking-tight text-[#17171A]">Evolução da performance</h2>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          aria-label="Métrica principal"
          id={`${formId}-metric-a`}
          value={metricAId}
          onChange={(event) => setMetricAId(event.target.value as ChartMetricId)}
          className={SELECT_CLASS}
        >
          {CHART_METRIC_IDS.map((id) => (
            <option key={id} value={id}>
              {seriesById.get(id)?.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Comparar com"
          value={compareMode}
          onChange={(event) => setCompareMode(event.target.value as CompareMode)}
          className={SELECT_CLASS}
        >
          <option value="none">Sem comparação</option>
          <option value="previous_period">Período anterior</option>
          <option value="other_metric">Outra métrica</option>
        </select>

        {compareMode === "other_metric" && (
          <select
            aria-label="Métrica de comparação"
            value={metricBId}
            onChange={(event) => setMetricBId(event.target.value as ChartMetricId)}
            className={SELECT_CLASS}
          >
            {CHART_METRIC_IDS.filter((id) => id !== metricAId).map((id) => (
              <option key={id} value={id}>
                {seriesById.get(id)?.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {compareMode === "other_metric" && metricB ? (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <EvolutionChartPanel
            title={metricA.label}
            unit={metricA.unit}
            rows={singleRows}
            lines={[{ dataKey: "value", name: metricA.label, color: "#17171A" }]}
          />
          <EvolutionChartPanel
            title={metricB.label}
            unit={metricB.unit}
            rows={metricBRows}
            lines={[{ dataKey: "value", name: metricB.label, color: "#17171A" }]}
          />
        </div>
      ) : compareMode === "previous_period" ? (
        <div className="mt-4">
          <EvolutionChartPanel
            title={metricA.label}
            unit={metricA.unit}
            rows={overlayRows}
            lines={[
              { dataKey: "current", name: "Período atual", color: "#17171A" },
              { dataKey: "previous", name: "Período anterior", color: "#6F6B65", dashed: true },
            ]}
          />
        </div>
      ) : (
        <div className="mt-4">
          <EvolutionChartPanel
            title={metricA.label}
            unit={metricA.unit}
            rows={singleRows}
            lines={[{ dataKey: "value", name: metricA.label, color: "#17171A" }]}
          />
        </div>
      )}
    </section>
  );
}
