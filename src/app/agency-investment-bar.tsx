import { formatCurrency, formatPercent } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import type { FinancialPeriodSummary } from "@/lib/financial-period";
import {
  computeExpectedPct,
  formatDeviationCurrencyText,
  formatExpectedMarkerLabel,
  formatExpectedMarkerTooltip,
  positionExpectedMarker,
} from "@/lib/financial-period";
import type { MonthTemporalStatus } from "@/lib/monthly-budget";

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
 *
 * Etapa 68: o marcador ganhou um rótulo visível acima da barra ("Esperado
 * hoje · X%", ou o texto de período encerrado/não iniciado — seção 6/16),
 * nunca só uma linha fina sem legenda; o tooltip passou a ter as 4 linhas
 * pedidas (o que é / % do mês / valor em reais / origem do cálculo); e uma
 * legenda compacta identifica as duas cores da trilha.
 *
 * Etapa "Simetria Performance x Investimento": ganhou dois parâmetros pra
 * ser reaproveitada também pelo card "Performance" (`MonthlyGoalProgress`,
 * uma métrica de CONTAGEM — resultado/meta, nunca R$) em vez de duplicar a
 * barra/marcador numa segunda implementação: `formatValue` (o tooltip do
 * marcador mostra o valor formatado do jeito certo pra cada domínio — R$
 * pro investimento, contagem simples pro resultado) e `overflowIsPositive`
 * (estourar 100% do PLANEJADO é ruim — vira vermelho; estourar 100% da META
 * de resultado é bom — nunca vira vermelho). Nenhum comportamento muda pra
 * quem já usa esta barra sem passar os dois (default = exatamente como
 * antes).
 */
export function AgencyInvestmentBar({
  summary,
  showExpectedMarker = true,
  monthTemporalStatus,
  showLegend = true,
  formatValue = formatCurrency,
  overflowIsPositive = false,
}: {
  summary: FinancialPeriodSummary;
  /** Etapa 64: `false` some com o marcador de "esperado até hoje", a
   * legenda e o texto de desvio, deixando só trilha + preenchimento — usado
   * pela sprint atual (Etapa 67, seção 12: a sprint nunca reintroduz este
   * marcador). Mês (página do cliente, Relatório, Sprints > Mensal
   * Consolidado) continua com o comportamento padrão (`true`). */
  showExpectedMarker?: boolean;
  /** Etapa 68, seção 16: `undefined` = mês corrente (rótulo "Esperado hoje ·
   * X%", o caso mais comum); `"passado"`/`"futuro"` trocam o texto do
   * marcador pra "Período encerrado"/"Período ainda não iniciado", já que
   * 100%/0% sozinhos não comunicam que é o PERÍODO (não os dados) que está
   * encerrado/não começou. Nunca usado quando `showExpectedMarker` é
   * `false` (sprint). */
  monthTemporalStatus?: MonthTemporalStatus;
  /** Etapa 73, seção 20: `false` esconde a legenda de cores + o texto de
   * desvio abaixo da barra (o rótulo sobre o marcador nunca some — continua
   * sempre visível). Default `true` preserva o comportamento de sempre pra
   * Visão Geral/Sprints/Relatório; só "Investimento do mês" da página do
   * cliente passa `false`, porque essa mesma informação passou a viver,
   * numa única apresentação (nunca duas frases pro mesmo número), dentro de
   * "Ver detalhes do investimento". */
  showLegend?: boolean;
  /** Formatador do valor numérico dentro do tooltip do marcador (3ª linha
   * de `formatExpectedMarkerTooltip`) — default `formatCurrency` preserva
   * 100% o comportamento de sempre pra todo consumidor existente. */
  formatValue?: (value: number) => string;
  /** `true` = nunca pinta o preenchimento de vermelho ao passar de 100% do
   * "planejado" (métrica onde superar a meta é BOM, ex.: resultado de
   * performance) — default `false` preserva o comportamento de sempre
   * (investimento: estourar o orçamento é ruim, vira vermelho). */
  overflowIsPositive?: boolean;
}) {
  const { planned, actual } = summary;

  if (planned <= 0) {
    if (!showExpectedMarker) {
      return <div className="h-3 w-full rounded-full bg-overview-surface-subtle" />;
    }
    return (
      <div>
        <div className="h-3 w-full rounded-full bg-overview-surface-subtle" />
        <EmptyState size="2xs" className="mt-1.5">Nenhum planejamento configurado neste recorte.</EmptyState>
      </div>
    );
  }

  const actualPct = (actual / planned) * 100;
  const expectedPct = computeExpectedPct(summary);
  const fillWidth = Math.min(Math.max(actualPct, 0), 100);
  const markerPos = positionExpectedMarker(expectedPct);
  // O rótulo em TEXTO precisa de mais margem lateral que a linha fina do
  // marcador (uma palavra inteira não cabe colada na borda arredondada da
  // barra) — clamp próprio, só pra posicionamento do texto (seção 7: "em
  // telas pequenas, evitar que o label saia para fora da barra").
  const labelPos = Math.min(Math.max(expectedPct, 14), 86);
  const isOver = actualPct > 100 && !overflowIsPositive;
  const deviationText = formatDeviationCurrencyText(summary, formatCurrency);
  const markerLabel = formatExpectedMarkerLabel(expectedPct, formatPercent, monthTemporalStatus);
  const markerTooltip = formatExpectedMarkerTooltip(summary, formatValue, formatPercent);

  if (!showExpectedMarker) {
    return (
      <div className="h-3 w-full overflow-hidden rounded-full bg-overview-surface-subtle">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-out ${isOver ? "bg-red-500" : "bg-brand"}`}
          style={{ width: `${fillWidth}%` }}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Rótulo do marcador (Etapa 68, seção 6): nunca só uma bolinha —
          sempre um texto visível associado, sem precisar de hover. Linha
          própria (não sobreposta ao conteúdo acima), pra reservar altura de
          verdade em vez de posicionamento absoluto solto. */}
      <div className="relative h-3.5">
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-navy"
          style={{ left: `${labelPos}%` }}
        >
          {markerLabel}
        </span>
      </div>
      <div className="relative h-3">
        <div className="h-3 w-full overflow-hidden rounded-full bg-overview-surface-subtle">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ease-out ${isOver ? "bg-red-500" : "bg-brand"}`}
            style={{ width: `${fillWidth}%` }}
          />
        </div>
        {/* Marcador de "esperado até hoje": linha vertical fina (não mais uma
            bolinha) — mais fácil de ler contra o preenchimento estreito de
            uma barra de sprint curta, e sempre com legenda visível acima
            (nunca só no tooltip). */}
        <div
          className="absolute top-0 h-3 w-0.5 -translate-x-1/2 cursor-help bg-navy shadow-[0_0_0_1px_rgba(255,255,255,0.8)] transition-[left] duration-300 ease-out dark:bg-white dark:shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
          style={{ left: `${markerPos}%` }}
          title={markerTooltip}
        />
      </div>
      {/* Legenda compacta (Etapa 68, seção 8) + % realizado — uma linha só,
          discreta, sem aumentar a altura da seção. */}
      {showLegend && (
        <>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-overview-text-secondary">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-brand" aria-hidden="true" />
              {Math.round(actualPct)}% realizado
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-0.5 bg-navy dark:bg-white" aria-hidden="true" />
              Marcador: esperado até hoje
            </span>
          </p>
          {deviationText && <p className="mt-0.5 text-[11px] text-overview-text-secondary">{deviationText}</p>}
        </>
      )}
    </div>
  );
}
