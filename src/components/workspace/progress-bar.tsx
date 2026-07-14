import { formatCurrency, formatPercent } from "@/lib/format";
import type { MonthTemporalStatus } from "@/lib/monthly-budget";

/**
 * Barra de investimento do novo Design System (Etapa 47) — variante nova,
 * deliberadamente separada de `AgencyInvestmentBar` (`app/agency-
 * investment-bar.tsx`), que continua servindo Sprints e Relatórios sem
 * nenhuma mudança visual: essa é a regra da rodada (só migrar componente
 * compartilhado sem criar variante quando a mudança não afeta outras
 * telas — aqui afetaria, então virou uma variante). Track neutro mais
 * fino, preenchimento azul, marcador como um handle circular (não um
 * traço quase invisível) com tooltip nativo.
 *
 * Etapa 68: o marcador ganhou um rótulo visível acima da barra ("Esperado
 * hoje · X%", seção 6) — nunca só o handle sem legenda — mais uma legenda
 * compacta de cores abaixo (seção 8). `monthTemporalStatus` (seção 16) troca
 * o texto do rótulo pra "Período encerrado"/"Período ainda não iniciado"
 * quando o mês navegado não é o corrente.
 */
export function ProgressBar({
  planned,
  actual,
  expectedToDate,
  monthTemporalStatus,
}: {
  planned: number;
  actual: number;
  expectedToDate: number;
  monthTemporalStatus?: MonthTemporalStatus;
}) {
  if (planned <= 0) {
    return <div className="h-2 w-full rounded-full bg-overview-surface-subtle" />;
  }

  const actualPct = (actual / planned) * 100;
  const expectedPct = (expectedToDate / planned) * 100;
  const fillWidth = Math.min(Math.max(actualPct, 0), 100);
  const markerPos = Math.min(Math.max(expectedPct, 2), 98);
  const labelPos = Math.min(Math.max(expectedPct, 14), 86);
  const isOver = actualPct > 100;

  const markerLabel =
    monthTemporalStatus === "passado"
      ? `Período encerrado · ${formatPercent(expectedPct)} esperado`
      : monthTemporalStatus === "futuro"
        ? `Período ainda não iniciado · ${formatPercent(expectedPct)} esperado`
        : `Esperado hoje · ${formatPercent(expectedPct)}`;
  const markerTooltip = [
    "Esperado até hoje",
    `${formatPercent(expectedPct)} do orçamento`,
    formatCurrency(expectedToDate),
    "Referência calculada pelo avanço proporcional do mês.",
  ].join("\n");

  return (
    <div>
      <div className="relative h-3.5">
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-overview-text-secondary"
          style={{ left: `${labelPos}%` }}
        >
          {markerLabel}
        </span>
      </div>
      <div className="relative h-2">
        <div className="h-2 w-full overflow-hidden rounded-full bg-overview-surface-subtle">
          <div
            className={`h-full rounded-full transition-[width] duration-200 ease-out ${isOver ? "bg-overview-danger" : "bg-brand"}`}
            style={{ width: `${fillWidth}%` }}
          />
        </div>
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-help rounded-full border-2 border-overview-surface bg-navy shadow-[var(--shadow-float)] transition-[left] duration-200 ease-out"
          style={{ left: `${markerPos}%` }}
          title={markerTooltip}
        />
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-overview-text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-brand" aria-hidden="true" />
          Realizado
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-navy" aria-hidden="true" />
          Marcador: esperado até hoje
        </span>
      </p>
    </div>
  );
}
