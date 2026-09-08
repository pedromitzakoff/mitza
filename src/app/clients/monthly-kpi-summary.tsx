import Link from "next/link";
import type { PerformanceSummary } from "@/lib/performance";
import { deriveMonthlyKpiTexts } from "@/lib/performance";
import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import { formatCurrency } from "@/lib/format";

function Kpi({ label, value, auxiliary }: { label: string; value: string; auxiliary?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">{label}</p>
      <p className="text-xl font-semibold tracking-tight text-overview-text-primary tabular-nums">{value}</p>
      {/* Linha reservada mesmo vazia: nem todo Kpi tem auxiliar (ex.:
          "Investimento"), mas os que estão na mesma linha precisam da mesma
          altura pra não ficar com a base desalinhada. */}
      <p className="min-h-[1em] text-xs text-overview-text-secondary">{auxiliary}</p>
    </div>
  );
}

/** Verde-limão só quando `comparison.status === "better"` (custo por
 * resultado abaixo da meta) — mesma régua canônica reaproveitada do
 * Relatório de Performance (`PerformanceStatus`/`comparison.tone`, nunca
 * uma segunda regra de "isso é bom?" inventada aqui). Qualquer outro status
 * fica em texto neutro — a paleta KOFF não tem cor de alerta pra "pior",
 * só ausência do acento. */
function CostComparisonNote({ text, isBetter }: { text: string; isBetter: boolean }) {
  if (isBetter) {
    return <span className="inline-block rounded-full bg-lime px-2 py-0.5 text-[11px] font-bold text-[#17171A]">{text}</span>;
  }
  return <span className="text-xs text-overview-text-secondary">{text}</span>;
}

/**
 * Investimento/resultados/custo por resultado (+ faturamento/ROAS quando
 * aplicável) — abre a página do cliente (Etapa 75: sem o rótulo "Principais
 * KPIs do mês" acima, o card começa direto pelas métricas). Nenhum cálculo
 * muda: todos os números sempre vêm já calculados (`monthActual`/
 * `performanceSummary`/`targetCostPerResult` da própria página); os textos
 * de resultado/custo vêm de `deriveMonthlyKpiTexts` (lib/performance.ts),
 * central e testável — nunca recomputados aqui.
 *
 * Etapa "Visão Geral: decisão em 5 segundos": esta tela deixa de tentar
 * mostrar tudo com o mesmo peso e passa a ter uma única linha enxuta de
 * KPIs (nunca mais um grid 4x2 de cards) — só o essencial pra uma decisão
 * rápida:
 * - a Meta deixou de ser uma métrica própria (mesmo peso visual das outras)
 *   e virou texto auxiliar discreto sob "Custo por resultado" (ex.: "CPA
 *   R$37,73" com "Meta R$30" pequeno embaixo) — a mesma informação de
 *   sempre, só sem obrigar o gestor a comparar duas áreas da tela;
 * - "Ticket médio" saiu desta área (`PerformanceSummary.averageTicket`
 *   continua calculado normalmente — só passou a ser exibido no Analytics,
 *   que é a tela de investigação, nunca a de decisão rápida).
 *
 * Etapa "Remover comparação percentual do card": a linha de diagnóstico
 * ("X% acima/abaixo da meta"/"Dentro da meta", que ficava logo abaixo da
 * grade) foi removida — posicionada sob "Investimento total", ela dava a
 * entender que a comparação era sobre o valor investido, quando na verdade
 * sempre foi sobre custo por resultado vs. meta.
 *
 * Etapa "Dois relógios no cabeçalho": o texto de proveniência/sincronização
 * (`getLatestPerformanceUpdateText`, "Meta · Sincronizado em...") saiu
 * daqui — mesmo dado agora vive só no cabeçalho da página do cliente
 * ("Última atualização da performance"), nunca duplicado nos dois lugares.
 */
export function MonthlyKpiSummary({
  monthActual,
  performanceGoal,
  performanceSummary,
  targetCostPerResult,
  configureObjectiveHref,
}: {
  monthActual: number;
  performanceGoal: PerformanceGoal | null;
  /** `null` só quando `performanceGoal` também é `null`. */
  performanceSummary: PerformanceSummary | null;
  /** Meta de custo por resultado vigente — `null` quando não configurada. */
  targetCostPerResult: number | null;
  configureObjectiveHref: string;
}) {
  const { resultsAuxiliary, costValue } = deriveMonthlyKpiTexts(performanceGoal, performanceSummary, formatCurrency);

  // Etapa "Evolução Visual Incremental — Área do Cliente": mesmo princípio
  // do hero do Relatório de Performance ("informação principal primeiro") —
  // o número de resultado vira protagonista tipográfico, separado do rótulo
  // do objetivo (nunca a string combinada de `deriveMonthlyKpiTexts`, que
  // mistura número+palavra num tamanho só — aqui lidos direto de
  // `performanceSummary`/`PERFORMANCE_GOALS`, os MESMOS dados que já
  // alimentavam o KPI "Resultados" de sempre, nenhum cálculo novo). Sem meta
  // configurada ou sem dado no período, cai pro texto auxiliar de sempre
  // (`resultsAuxiliary`), mesmo comportamento de antes desta etapa.
  const hasHeroResult = performanceGoal !== null && performanceSummary !== null && performanceSummary.hasAnyRecord;
  const heroValue = hasHeroResult ? String(performanceSummary.resultCount) : "—";
  const heroLabel = performanceGoal ? PERFORMANCE_GOALS[performanceGoal].resultMetricLabel : "Resultados";

  // Meta como texto auxiliar discreto do custo por resultado (nunca mais
  // uma métrica própria) — só existe quando há meta configurada, mesmo
  // valor de sempre (`targetCostPerResult`), nenhum cálculo novo. Verde-limão
  // reaproveita `performanceSummary.comparison.status` (mesmo campo
  // canônico já usado pelo Relatório) — nunca recalcula "está bom?" aqui.
  const costAuxiliary = targetCostPerResult !== null ? `Meta ${formatCurrency(targetCostPerResult)}` : null;
  const isCostBetterThanTarget = performanceSummary?.comparison.status === "better";

  // Faturamento/ROAS — Etapa "Receita e ROAS": linha auxiliar, nunca
  // renderizada quando `revenue` é null (cliente sem objetivo de vendas, ou
  // sem `value_column` configurado na integração) — nenhuma checagem de
  // `performanceGoal === "sales"` aqui, a ausência de `revenue` já resolve
  // isso sozinha (mesmo espírito do resto da camada de domínio: nunca
  // inferir por objetivo, sempre pela presença do dado). Ticket médio
  // (`performanceSummary.averageTicket`) continua calculado normalmente,
  // só não é mais lido nesta tela — ver `buildAnalyticsKpiCards` (Analytics).
  const revenue = performanceSummary?.revenue ?? null;
  const roas = performanceSummary?.roas ?? null;
  const hasRevenue = revenue !== null;
  const revenueValue = revenue !== null ? formatCurrency(revenue) : "—";
  const roasValue = roas !== null ? `${roas.toFixed(1)}x` : "—";

  return (
    <div>
      {/* Etapa "Evolução Visual Incremental — Área do Cliente": o resultado
          do mês vira hero tipográfico (mesmo princípio do Relatório —
          "informação principal primeiro", nunca mais um KPI com o mesmo
          peso dos demais). Investimento/Custo por resultado/Faturamento/
          ROAS continuam a fileira enxuta de sempre (`auto-fit`+`minmax`,
          Etapa "Refinamento Visual 2.0"), agora abaixo do hero em vez de ao
          lado dele — nenhum valor recalculado, só reordenado/redimensionado. */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">{heroLabel}</p>
        <p className="text-[40px] font-extrabold leading-none tracking-tight text-overview-text-primary tabular-nums">
          {heroValue}
        </p>
        {resultsAuxiliary && <p className="mt-1 text-xs text-overview-text-secondary">{resultsAuxiliary}</p>}
      </div>

      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-x-8 gap-y-4">
        <Kpi label="Investimento" value={formatCurrency(monthActual)} />
        <div className="flex flex-col gap-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Custo por resultado</p>
          <p className="text-xl font-semibold tracking-tight text-overview-text-primary tabular-nums">{costValue}</p>
          <div className="min-h-[1em]">{costAuxiliary && <CostComparisonNote text={costAuxiliary} isBetter={isCostBetterThanTarget} />}</div>
        </div>
        {hasRevenue && <Kpi label="Faturamento" value={revenueValue} />}
        {hasRevenue && <Kpi label="ROAS" value={roasValue} />}
      </div>
      {!performanceGoal && (
        <Link href={configureObjectiveHref} className="mt-2 inline-block text-xs font-medium text-brand hover:underline">
          Configurar objetivo
        </Link>
      )}
    </div>
  );
}
