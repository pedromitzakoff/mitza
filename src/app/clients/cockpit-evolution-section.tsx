"use client";

import { useId, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency, formatCount, formatPercent, formatShortDate } from "@/lib/format";
import type { ChartMetricUnit } from "@/lib/meta-ads-dashboard/evolution-data";
import type { EvolutionSeriesOption } from "@/lib/cockpit-evolution-merge";

/**
 * KOFF Analytics — Redesign definitivo do Cockpit, "Evolução da
 * performance": módulo ÚNICO, em vez dos dois gráficos separados que
 * existiam antes (Evolução Diária, SVG artesanal, por objetivo; Evolução
 * Meta Ads, Recharts, métricas de mídia). Motor Recharts da antiga
 * `cockpit-ad-evolution-section.tsx` (já aprovado pelo usuário na Etapa
 * 2.3) mantido — só generaliza o tipo de série (`EvolutionSeriesOption`, com
 * `id: string` em vez da união fixa `ChartMetricId`) pra aceitar tanto as
 * métricas de mídia Meta Ads quanto as séries diárias por objetivo
 * (Resultado/Custo/Investimento, `lib/cockpit-evolution-merge.ts`) no MESMO
 * seletor — quem monta a página decide a lista final (concatenação simples,
 * nenhuma fusão de dado aqui).
 *
 * Escalas/unidades preservadas: cada métrica mantém seu próprio eixo
 * (`ChartMetricUnit` — currency/count/percent/ratio), nunca um dual-axis;
 * "Outra métrica" compara duas séries lado a lado, cada painel com sua
 * própria régua — mesma disciplina de sempre (nunca a mesma escala pra
 * métricas de unidades diferentes).
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

function buildRows(points: EvolutionSeriesOption["current"]): ChartRow[] {
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

export interface CockpitEvolutionFreshnessView {
  /** "Dados até DD/MM" — `null` = frescor desconhecido (nenhuma fonte
   * habilitada tem `last_imported_date` ainda). */
  latestDataLabel: string | null;
  /** "há X" relativo — `null` = nenhuma fonte habilitada sincronizou com
   * sucesso ainda. */
  latestSyncLabel: string | null;
}

export function CockpitEvolutionSection({
  series,
  freshness,
  emptyMessage,
}: {
  series: EvolutionSeriesOption[];
  freshness?: CockpitEvolutionFreshnessView | null;
  /** Mostrado só quando `series` está vazia — decidido por quem monta a
   * página (mesma disciplina de "sem objetivo configurado"/"sem dados
   * diários"/"sem canal Meta" que a seção antiga já tinha, nunca recalculado
   * aqui). */
  emptyMessage: string;
}) {
  const [metricAId, setMetricAId] = useState<string>(series[0]?.id ?? "");
  const [compareMode, setCompareMode] = useState<CompareMode>("none");
  const [metricBId, setMetricBId] = useState<string>(series[1]?.id ?? series[0]?.id ?? "");
  const formId = useId();

  const seriesById = useMemo(() => new Map(series.map((item) => [item.id, item])), [series]);
  const metricA = seriesById.get(metricAId) ?? series[0];
  const metricB = compareMode === "other_metric" ? (seriesById.get(metricBId) ?? series.find((s) => s.id !== metricA?.id)) : undefined;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Evolução da performance</h2>
        {freshness && (
          <p className="shrink-0 text-right text-[11px] text-overview-text-muted">
            {freshness.latestDataLabel ? `Dados até ${freshness.latestDataLabel}` : "Frescor dos dados: desconhecido"}
            {freshness.latestSyncLabel && <span className="block">Última sincronização: {freshness.latestSyncLabel}</span>}
          </p>
        )}
      </div>

      {series.length === 0 || !metricA ? (
        <p className="mt-3 text-sm text-overview-text-secondary">{emptyMessage}</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              aria-label="Métrica principal"
              id={`${formId}-metric-a`}
              value={metricA.id}
              onChange={(event) => setMetricAId(event.target.value)}
              className={SELECT_CLASS}
            >
              {series.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
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
                onChange={(event) => setMetricBId(event.target.value)}
                className={SELECT_CLASS}
              >
                {series
                  .filter((item) => item.id !== metricA.id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
              </select>
            )}
          </div>

          {compareMode === "other_metric" && metricB ? (
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <EvolutionChartPanel title={metricA.label} unit={metricA.unit} rows={buildRows(metricA.current)} />
              <EvolutionChartPanel title={metricB.label} unit={metricB.unit} rows={buildRows(metricB.current)} />
            </div>
          ) : (
            <div className="mt-3">
              <EvolutionChartPanel title={metricA.label} unit={metricA.unit} rows={buildRows(metricA.current)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
