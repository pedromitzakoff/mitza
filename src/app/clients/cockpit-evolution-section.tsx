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
 * Etapa "Gráficos de Evolução, refinamento visual" (pedido explícito do
 * usuário: "ferramentas de análise visual claras, elegantes e interativas"):
 * cabeçalho com valor agregado do período + variação % (nunca calculado por
 * média simples de pontos diários — `total`/`previousTotal` já vêm prontos
 * de `evolution-data.ts`/`cockpit-evolution-merge.ts`), tooltip com
 * comparação ao período anterior por posição, eixo X cortado no último dia
 * com dado real (nunca estendido até o fim do mês), e linha pontilhada
 * opcional do período anterior. Nenhum cálculo novo de agregação aqui —
 * este arquivo só formata/compõe o que os dois módulos de dados já
 * calculam.
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

/** Variação % entre dois valores — `null` sem base confiável pra comparar
 * (período anterior ausente, ou zero: "variação sobre zero" não é um
 * percentual, nunca `Infinity`/`NaN` exibido). Mesma convenção de
 * `safeDivide` (`lib/performance.ts`): denominador zero/ausente → `null`. */
export function computeVariationFraction(current: number | null, previous: number | null | undefined): number | null {
  if (current === null || previous === null || previous === undefined || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export function formatSignedPercent(fraction: number): string {
  const sign = fraction > 0 ? "+" : fraction < 0 ? "−" : "";
  return `${sign}${formatPercent(Math.abs(fraction) * 100)}`;
}

export type ChartRow = { date: string; value: number | null; previousValue?: number | null };

/** Monta as linhas do gráfico — período atual sempre; período anterior
 * (quando existe e o toggle está ligado) entra alinhado por ÍNDICE/posição,
 * nunca por data civil (datas diferentes entre os dois períodos, mesma
 * convenção já documentada em `evolution-data.ts`). */
export function buildRows(current: EvolutionSeriesOption["current"], previous: EvolutionSeriesOption["previous"] | undefined, showPrevious: boolean): ChartRow[] {
  return current.map((point, index) => ({
    date: point.date,
    value: point.value,
    previousValue: showPrevious && previous ? (previous[index]?.value ?? null) : undefined,
  }));
}

/** Corta a cauda de dias sem nenhum dado (fim do mês corrente ainda não
 * vivido, ou sincronização ainda não chegou) — pedido explícito do usuário:
 * "não estender a linha artificialmente até o fim do mês". Só a CAUDA:
 * um vão no MEIO da série (dia sem dado entre dois dias com dado) continua
 * intocado — isso é informação real (dia sem sincronizar), nunca escondida.
 * Série inteiramente vazia fica como está (nada pra cortar). */
export function trimTrailingEmptyRows(rows: ChartRow[]): ChartRow[] {
  let lastWithData = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].value !== null) {
      lastWithData = i;
      break;
    }
  }
  if (lastWithData === -1) return rows;
  return rows.slice(0, lastWithData + 1);
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

/** Tooltip próprio — igual acessível por toque no celular (Recharts ativa
 * no toque por padrão, mesmo componente/sem lib nova) — mostra a data, o
 * valor exato do dia e, quando o período anterior está sendo comparado, o
 * valor equivalente + variação daquele dia específico (não a do período
 * inteiro, que já vive no cabeçalho). */
interface EvolutionTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly { payload?: ChartRow }[];
  unit: ChartMetricUnit;
}

function EvolutionTooltip({ active, payload, label, unit }: EvolutionTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row || row.value === null) return null;

  const dayVariation = computeVariationFraction(row.value, row.previousValue);

  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface px-3 py-2 text-xs text-overview-text-primary shadow-sm">
      <p className="font-medium">{typeof label === "string" ? formatShortDate(label) : label}</p>
      <p className="mt-1 tabular-nums">{formatMetricValue(unit, row.value)}</p>
      {row.previousValue !== undefined && row.previousValue !== null && (
        <p className="mt-0.5 text-overview-text-muted tabular-nums">
          Período anterior: {formatMetricValue(unit, row.previousValue)}
          {dayVariation !== null && <span> ({formatSignedPercent(dayVariation)})</span>}
        </p>
      )}
    </div>
  );
}

function EvolutionChartHeader({ metric }: { metric: EvolutionSeriesOption }) {
  const variation = computeVariationFraction(metric.total, metric.previousTotal);
  return (
    <div className="flex items-baseline justify-between gap-2">
      <p className="text-xs font-medium text-overview-text-secondary">{metric.label}</p>
      <div className="flex items-baseline gap-1.5">
        <p className="text-lg font-semibold tabular-nums text-overview-text-primary">
          {metric.total !== null ? formatMetricValue(metric.unit, metric.total) : "—"}
        </p>
        {variation !== null && (
          <span className={`text-xs font-medium tabular-nums ${variation > 0 ? "text-emerald-600" : variation < 0 ? "text-red-600" : "text-overview-text-muted"}`}>
            {formatSignedPercent(variation)}
          </span>
        )}
      </div>
    </div>
  );
}

function EvolutionChartPanel({ unit, rows }: { unit: ChartMetricUnit; rows: ChartRow[] }) {
  const hasPrevious = rows.some((r) => r.previousValue !== undefined);

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--overview-border)" strokeDasharray="3 3" vertical={false} />
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
          <Tooltip content={(props) => <EvolutionTooltip {...props} unit={unit} />} trigger="hover" />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--brand)"
            strokeWidth={2}
            dot={{ r: 2, strokeWidth: 0, fill: "var(--brand)" }}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
          />
          {hasPrevious && (
            <Line
              type="monotone"
              dataKey="previousValue"
              stroke="var(--overview-text-muted)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
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
  const [showPrevious, setShowPrevious] = useState(false);
  const canComparePrevious = Boolean(metric?.previous && metric.previous.length > 0);

  return (
    <div className="rounded-lg border border-overview-border bg-overview-surface p-3">
      <div className="flex items-center gap-2">
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
        {canComparePrevious && (
          <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-overview-text-secondary">
            <input type="checkbox" checked={showPrevious} onChange={(event) => setShowPrevious(event.target.checked)} className="h-3.5 w-3.5" />
            Período anterior
          </label>
        )}
      </div>
      {metric ? (
        <>
          <div className="mt-3">
            <EvolutionChartHeader metric={metric} />
          </div>
          <div className="mt-2">
            <EvolutionChartPanel unit={metric.unit} rows={trimTrailingEmptyRows(buildRows(metric.current, metric.previous, showPrevious && canComparePrevious))} />
          </div>
        </>
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
  // Etapa "Otimizacao mobile - Fase 1" (pedido explicito do usuario): no
  // celular, mostrar UM grafico por vez (menos rolagem, mais foco) com uma
  // aba pra alternar - nunca uma segunda logica de dados/selecao, so um
  // "qual dos dois paineis ja montados esta visivel agora" puramente
  // visual (CSS `hidden`/`block`); no desktop (`lg:`) os dois continuam
  // sempre visiveis lado a lado, like antes.
  const [mobileActiveSide, setMobileActiveSide] = useState<Side>("left");

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
        <>
          <div className="mt-3 flex gap-2 lg:hidden">
            {(["left", "right"] as const).map((side) => {
              const sideMetric = series.find((s) => s.id === (side === "left" ? leftId : rightId)) ?? series[0];
              const isActive = mobileActiveSide === side;
              return (
                <button
                  key={side}
                  type="button"
                  onClick={() => setMobileActiveSide(side)}
                  aria-pressed={isActive}
                  className={`min-h-9 flex-1 rounded-full border px-3 text-xs font-medium ${
                    isActive
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-overview-border text-overview-text-secondary hover:bg-overview-surface-hover"
                  }`}
                >
                  {sideMetric?.label ?? (side === "left" ? "Gráfico 1" : "Gráfico 2")}
                </button>
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className={mobileActiveSide === "left" ? "block" : "hidden lg:block"}>
              <EvolutionChartSlot side="left" series={series} selectedId={leftId} onSelect={(id) => handleSelect("left", id)} />
            </div>
            <div className={mobileActiveSide === "right" ? "block" : "hidden lg:block"}>
              <EvolutionChartSlot side="right" series={series} selectedId={rightId} onSelect={(id) => handleSelect("right", id)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
