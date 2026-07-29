import { formatShortDate } from "@/lib/format";
import type { AnalyticsTrend } from "@/lib/analytics";

/**
 * Gráfico de evolução diária — SVG desenhado à mão, sem biblioteca nova
 * (o projeto não usa nenhuma solução de gráficos hoje — Etapa Analytics
 * MVP, ver relatório de entrega). Escopo deliberadamente mínimo pro MVP:
 * sem eixo numérico (cada série é normalizada ao próprio intervalo, como um
 * sparkline) e sem tooltip interativo no hover — só o valor do último dia,
 * rotulado diretamente (mesmo princípio de "rótulo direto em vez de eixo
 * denso" do resto da plataforma). Nunca dual-axis numérico: as duas séries
 * dividem o mesmo espaço visual só pra leitura de tendência relativa, nunca
 * pra comparação de valor absoluto entre elas.
 */
const WIDTH = 600;
const HEIGHT = 140;
const PADDING_X = 4;
const PADDING_Y = 8;

function buildPath(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? (WIDTH - PADDING_X * 2) / (values.length - 1) : 0;

  return values
    .map((value, index) => {
      const x = PADDING_X + index * stepX;
      const normalized = (value - min) / range;
      const y = HEIGHT - PADDING_Y - normalized * (HEIGHT - PADDING_Y * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function AnalyticsTrendChart({
  trend,
  formatCurrencyValue,
}: {
  trend: AnalyticsTrend;
  formatCurrencyValue: (value: number) => string;
}) {
  // A métrica de resultado é sempre a série principal quando existe
  // (prioridade do pedido original: resultado > investimento) — sem ela
  // (fluxo manual, sem granularidade diária), investimento vira a única
  // série, nunca um gráfico vazio.
  const primary = trend.result ?? trend.spend;
  const secondary = trend.result ? trend.spend : null;

  const primaryPath = buildPath(primary.points.map((p) => p.value));
  const secondaryPath = secondary ? buildPath(secondary.points.map((p) => p.value)) : null;

  const firstDate = primary.points[0]?.date;
  const lastDate = primary.points[primary.points.length - 1]?.date;
  const lastPrimaryValue = primary.points[primary.points.length - 1]?.value ?? 0;
  const lastSecondaryValue = secondary?.points[secondary.points.length - 1]?.value ?? null;

  const primaryValueLabel = trend.result ? String(lastPrimaryValue) : formatCurrencyValue(lastPrimaryValue);
  const secondaryValueLabel = lastSecondaryValue !== null ? formatCurrencyValue(lastSecondaryValue) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--brand)" }} aria-hidden="true" />
          <span className="text-muted-foreground">{primary.label}:</span>
          <span className="font-medium text-foreground">{primaryValueLabel}</span>
        </span>
        {secondary && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--muted-foreground)" }} aria-hidden="true" />
            <span className="text-muted-foreground">{secondary.label}:</span>
            <span className="font-medium text-foreground">{secondaryValueLabel}</span>
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="mt-2 h-32 w-full"
        role="img"
        aria-label={`Evolução diária de ${primary.label}${secondary ? ` e ${secondary.label}` : ""} no período`}
      >
        {secondaryPath && (
          <path d={secondaryPath} fill="none" stroke="var(--muted-foreground)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
        )}
        <path d={primaryPath} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{firstDate ? formatShortDate(firstDate) : ""}</span>
        <span>{lastDate ? formatShortDate(lastDate) : ""}</span>
      </div>
    </div>
  );
}
