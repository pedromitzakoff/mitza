import { formatCurrency } from "@/lib/format";
import type { FinancialPeriodSummary } from "@/lib/financial-period";
import { computeExpectedPct, formatDeviationCurrencyText, positionExpectedMarker } from "@/lib/financial-period";

/**
 * Barra do resumo "Investimento do mês" (Visão Geral, página do cliente,
 * tela Sprints, Relatório) — trilha neutra, preenchimento azul MITZA
 * (realizado / planejado, nunca passa de 100% de largura; vermelho discreto
 * só quando ultrapassa o planejado inteiro) e um marcador de "esperado até
 * hoje". Etapa 63: o marcador virou uma linha vertical fina com legenda
 * própria (antes era uma bolinha sem legenda visível, só tooltip) e os
 * textos abaixo da barra passaram a reaproveitar as funções centrais de
 * `lib/financial-period.ts` (nunca mais um cálculo de "ritmo" próprio deste
 * componente) — a mesma barra, com o mesmo texto, em qualquer tela que a
 * use, porque `summary` já vem de `resolveMonthPeriodSummary`/
 * `resolveSprintPeriodSummary`.
 */
export function AgencyInvestmentBar({ summary }: { summary: FinancialPeriodSummary }) {
  const { planned, actual, expectedToDate } = summary;

  if (planned <= 0) {
    return (
      <div>
        <div className="h-3 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" />
        <p className="mt-1.5 text-[11px] text-muted-foreground">Nenhum planejamento configurado neste recorte.</p>
      </div>
    );
  }

  const actualPct = (actual / planned) * 100;
  const expectedPct = computeExpectedPct(summary);
  const fillWidth = Math.min(Math.max(actualPct, 0), 100);
  const markerPos = positionExpectedMarker(expectedPct);
  const isOver = actualPct > 100;
  const deviationText = formatDeviationCurrencyText(summary, formatCurrency);

  return (
    <div>
      <div className="relative h-3">
        <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ease-out ${isOver ? "bg-red-500" : "bg-brand"}`}
            style={{ width: `${fillWidth}%` }}
          />
        </div>
        {/* Marcador de "esperado até hoje": linha vertical fina (não mais uma
            bolinha) — mais fácil de ler contra o preenchimento estreito de
            uma barra de sprint curta, e sempre com legenda visível abaixo
            (nunca só no tooltip). */}
        <div
          className="absolute top-0 h-3 w-0.5 -translate-x-1/2 cursor-help bg-navy shadow-[0_0_0_1px_rgba(255,255,255,0.8)] transition-[left] duration-300 ease-out dark:bg-white dark:shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
          style={{ left: `${markerPos}%` }}
          title={`Esperado até hoje\n${formatCurrency(expectedToDate)}\n${Math.round(expectedPct)}% do planejado`}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-navy align-middle dark:bg-white" aria-hidden="true" />
        {Math.round(actualPct)}% realizado · {Math.round(expectedPct)}% esperado até hoje
      </p>
      {deviationText && <p className="mt-0.5 text-[11px] text-muted-foreground">{deviationText}</p>}
    </div>
  );
}
