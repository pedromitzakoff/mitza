import Link from "next/link";
import type { PerformanceSummary } from "@/lib/performance";
import { deriveMonthlyKpiTexts } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { formatCurrency } from "@/lib/format";

function Kpi({ label, value, auxiliary }: { label: string; value: string; auxiliary?: string | null }) {
  return (
    <div className="flex min-w-[7rem] flex-col gap-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-overview-text-muted">{label}</p>
      <p className="text-xl font-semibold tracking-tight text-overview-text-primary">{value}</p>
      {/* Linha reservada mesmo vazia: nem todo Kpi tem auxiliar (ex.:
          "Investimento"), mas os que estão na mesma linha precisam da mesma
          altura pra não ficar com a base desalinhada num `flex` que estica
          os itens (`align-items: stretch`, o padrão). */}
      <p className="min-h-[1em] text-xs text-overview-text-secondary">{auxiliary}</p>
    </div>
  );
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
  const { resultsValue, resultsAuxiliary, costValue } = deriveMonthlyKpiTexts(
    performanceGoal,
    performanceSummary,
    formatCurrency,
  );

  // Meta como texto auxiliar discreto do custo por resultado (nunca mais
  // uma métrica própria) — só existe quando há meta configurada, mesmo
  // valor de sempre (`targetCostPerResult`), nenhum cálculo novo.
  const costAuxiliary = targetCostPerResult !== null ? `Meta ${formatCurrency(targetCostPerResult)}` : null;

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
      {/* Uma única linha, sem grid nem divisor entre "linhas" (Etapa "Visão
          Geral: decisão em 5 segundos") — `flex-wrap` deixa cada KPI ocupar
          só o espaço que precisa e quebrar pro mobile sozinho, em vez do
          grid fixo de antes que reservava colunas vazias. Mesma composição
          do `AnalyticsKpiGrid` (Analytics), de propósito: a Visão Geral e o
          Analytics agora falam a mesma linguagem visual de "linha de KPIs",
          só com tipografia maior aqui (é a tela de decisão, não a de
          investigação). */}
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <Kpi label="Investimento" value={formatCurrency(monthActual)} />
        <Kpi label="Resultados" value={resultsValue} auxiliary={resultsAuxiliary} />
        <Kpi label="Custo por resultado" value={costValue} auxiliary={costAuxiliary} />
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
