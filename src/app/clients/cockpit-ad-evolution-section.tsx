"use client";

import { useId, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency, formatCount, formatPercent, formatShortDate } from "@/lib/format";
import {
  CHART_METRIC_IDS,
  type ChartMetricId,
  type ChartMetricSeries,
  type ChartMetricUnit,
  type ChartSeriesPoint,
} from "@/lib/meta-ads-dashboard/evolution-data";

/**
 * MITZA ONE — Cockpit Único do Cliente, "Evolução da performance Meta Ads"
 * (consolidação da antiga `clients/[id]/meta-ads/evolution-section.tsx`,
 * Etapa 2.3, pra dentro do Cockpit). Recharts (já aprovado pelo usuário na
 * Etapa 2.3), restilizado com os MESMOS tokens do resto do Cockpit
 * (`overview-*`/`brand`) em vez da identidade KOFF específica da rota
 * removida.
 *
 * Diferença real do original: o Cockpit nunca busca um período anterior
 * pra esta seção (mesma convenção do resto do Cockpit — Meta & Ritmo/
 * Evolução Diária tampouco comparam mês a mês), então o modo "Período
 * anterior" foi removido daqui (a série `previous` que chegaria sempre
 * nula não tem leitura nenhuma pro usuário) — só "Sem comparação" e
 * "Outra métrica" (2 painéis, cada um com seu próprio eixo, nunca
 * dual-axis) continuam.
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

type CompareMode = "none" | "other_metric";

type ChartRow = Record<string, string | number | null>;

function buildSingleRows(points: ChartSeriesPoint[]): ChartRow[] {
  return points.map((point) => ({ date: point.date, value: point.value }));
}

const SELECT_CLASS = "min-h-9 rounded-lg border border-overview-border bg-overview-surface px-2 text-xs text-overview-text-primary";

function EvolutionChartPanel({ title, unit, rows }: { title: string; unit: ChartMetricUnit; rows: ChartRow[] }) {
  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">{title}</p>
      <div className="mt-3 h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--overview-border)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => formatShortDate(value)}
              tick={{ fontSize: 11, fill: "var(--overview-text-muted)" }}
              axisLine={{ stroke: "var(--overview-border)" }}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              tickFormatter={(value: number) => formatMetricValue(unit, value)}
              tick={{ fontSize: 11, fill: "var(--overview-text-muted)" }}
              axisLine={false}
              tickLine={false}
              width={72}
            />
            <Tooltip
              formatter={(value) => (typeof value === "number" ? formatMetricValue(unit, value) : value)}
              labelFormatter={(label) => (typeof label === "string" ? formatShortDate(label) : label)}
              contentStyle={{
                borderRadius: 8,
                borderColor: "var(--overview-border)",
                backgroundColor: "var(--overview-surface)",
                color: "var(--overview-text-primary)",
                fontSize: 12,
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              name={title}
              stroke="var(--brand)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function CockpitAdEvolutionSection({ series }: { series: ChartMetricSeries[] }) {
  // Padrão "impressões" (não "investimento") — a seção "Evolução Diária"
  // do Cockpit já mostra investimento por dia; começar este gráfico por
  // outra métrica evita a MESMA série duplicada logo abaixo (pedido do
  // usuário, Etapa "Redesign": "evitar duplicar indicadores que já
  // apareçam em outras partes do Cockpit"). Investimento continua
  // selecionável normalmente, só não é mais o padrão.
  const [metricAId, setMetricAId] = useState<ChartMetricId>("impressions");
  const [compareMode, setCompareMode] = useState<CompareMode>("none");
  const [metricBId, setMetricBId] = useState<ChartMetricId>("ctr");
  const formId = useId();

  const seriesById = useMemo(() => new Map(series.map((item) => [item.id, item])), [series]);
  const metricA = seriesById.get(metricAId) ?? series[0];
  const metricB = compareMode === "other_metric" ? seriesById.get(metricBId) : undefined;

  const singleRows = buildSingleRows(metricA.current);
  const metricBRows = metricB ? buildSingleRows(metricB.current) : [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
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
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <EvolutionChartPanel title={metricA.label} unit={metricA.unit} rows={singleRows} />
          <EvolutionChartPanel title={metricB.label} unit={metricB.unit} rows={metricBRows} />
        </div>
      ) : (
        <div className="mt-3">
          <EvolutionChartPanel title={metricA.label} unit={metricA.unit} rows={singleRows} />
        </div>
      )}
    </div>
  );
}
