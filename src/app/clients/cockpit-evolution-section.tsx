"use client";

import { useEffect, useId, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency, formatCount, formatPercent, formatShortDate } from "@/lib/format";
import type { ChartMetricUnit } from "@/lib/meta-ads-dashboard/evolution-data";
import type { EvolutionSeriesOption } from "@/lib/cockpit-evolution-merge";

/**
 * KOFF Analytics — "Refinamento de UX e filtros globais do Cockpit" (pedido
 * explícito do usuário): "Evolução da performance" passa a ser SEMPRE
 * exatamente DOIS gráficos visíveis, lado a lado no desktop, cada um com
 * seu PRÓPRIO seletor de métrica — nunca mais o modo "Outra métrica" (que
 * fazia um dos dois gráficos depender da escolha do outro). Seleção de cada
 * lado é independente e persistida por cliente (`localStorage`, mesmo
 * padrão de `cockpit-ad-metric-cards.tsx`/`cockpit-ad-exploration-section.tsx`
 * — nunca uma tabela nova). Defaults (resolvidos por quem monta a página,
 * com o contexto completo de quais séries existem): esquerda = resultados,
 * direita = investimento.
 *
 * Motor Recharts da antiga `cockpit-ad-evolution-section.tsx` preservado
 * integralmente (mesmas escalas/unidades/tooltip) — só a composição ao
 * redor mudou (2 painéis fixos em vez de 1-2 condicionais).
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

type ChartRow = Record<string, string | number | null>;

function buildRows(points: EvolutionSeriesOption["current"]): ChartRow[] {
  return points.map((point) => ({ date: point.date, value: point.value }));
}

const SELECT_CLASS = "min-h-9 w-full rounded-lg border border-overview-border bg-overview-surface px-2 text-xs text-overview-text-primary";
const STORAGE_KEY_PREFIX = "mitza:cockpit:evolution:";

type Side = "left" | "right";

function loadStoredMetricId(clientId: string, side: Side): string | null {
  try {
    return window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${side}:${clientId}`);
  } catch {
    return null;
  }
}

function saveStoredMetricId(clientId: string, side: Side, id: string) {
  try {
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${side}:${clientId}`, id);
  } catch {
    // Armazenamento indisponível — seleção não persiste entre sessões nesse caso, nunca quebra a tela.
  }
}

function EvolutionChartPanel({ title, unit, rows }: { title: string; unit: ChartMetricUnit; rows: ChartRow[] }) {
  return (
    <div className="h-64 w-full">
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
  );
}

function EvolutionChartSlot({
  side,
  series,
  selectedId,
  onSelect,
}: {
  side: Side;
  series: EvolutionSeriesOption[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const formId = useId();
  const metric = series.find((s) => s.id === selectedId) ?? series[0];

  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-3">
      <select
        aria-label={side === "left" ? "Métrica do gráfico esquerdo" : "Métrica do gráfico direito"}
        id={`${formId}-metric`}
        value={metric?.id ?? ""}
        onChange={(event) => onSelect(event.target.value)}
        className={SELECT_CLASS}
      >
        {series.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      {metric ? (
        <div className="mt-3">
          <EvolutionChartPanel title={metric.label} unit={metric.unit} rows={buildRows(metric.current)} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-overview-text-secondary">Nenhuma métrica disponível.</p>
      )}
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
  clientId,
  series,
  defaultLeftId,
  defaultRightId,
  freshness,
  emptyMessage,
}: {
  clientId: string;
  series: EvolutionSeriesOption[];
  /** Resolvidos por quem monta a página, com o contexto completo de quais
   * séries existem pra este cliente neste escopo (pedido explícito do
   * usuário: "esquerda = resultados; direita = investimento") — este
   * componente nunca decide sozinho qual id "parece" ser resultado/
   * investimento. */
  defaultLeftId: string;
  defaultRightId: string;
  freshness?: CockpitEvolutionFreshnessView | null;
  /** Mostrado só quando `series` está vazia. */
  emptyMessage: string;
}) {
  const [leftId, setLeftId] = useState(defaultLeftId);
  const [rightId, setRightId] = useState(defaultRightId);

  // Mesmo cuidado de hidratação de sempre (CockpitAdMetricCards): a
  // primeira renderização usa sempre o default (idêntico servidor/cliente),
  // só troca pra preferência salva dentro de um useEffect.
  const availableIds = series.map((s) => s.id).join(",");
  useEffect(() => {
    function applyStoredSelection() {
      const storedLeft = loadStoredMetricId(clientId, "left");
      const storedRight = loadStoredMetricId(clientId, "right");
      setLeftId(storedLeft && series.some((s) => s.id === storedLeft) ? storedLeft : defaultLeftId);
      setRightId(storedRight && series.some((s) => s.id === storedRight) ? storedRight : defaultRightId);
    }
    applyStoredSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, defaultLeftId, defaultRightId, availableIds]);

  function handleSelect(side: Side, id: string) {
    if (side === "left") setLeftId(id);
    else setRightId(id);
    saveStoredMetricId(clientId, side, id);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-medium text-overview-text-primary">Evolução da performance</h2>
        {freshness && (
          <p className="shrink-0 text-right text-[11px] text-overview-text-muted">
            {freshness.latestDataLabel ? `Dados até ${freshness.latestDataLabel}` : "Frescor dos dados: desconhecido"}
            {freshness.latestSyncLabel && <span className="block">Última sincronização: {freshness.latestSyncLabel}</span>}
          </p>
        )}
      </div>

      {series.length === 0 ? (
        <p className="mt-3 text-sm text-overview-text-secondary">{emptyMessage}</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <EvolutionChartSlot side="left" series={series} selectedId={leftId} onSelect={(id) => handleSelect("left", id)} />
          <EvolutionChartSlot side="right" series={series} selectedId={rightId} onSelect={(id) => handleSelect("right", id)} />
        </div>
      )}
    </div>
  );
}
