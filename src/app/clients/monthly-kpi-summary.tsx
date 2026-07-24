import Link from "next/link";
import type { PerformanceSummary } from "@/lib/performance";
import { deriveMonthlyKpiTexts } from "@/lib/performance";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { formatCurrency } from "@/lib/format";

function Kpi({ label, value, auxiliary }: { label: string; value: string; auxiliary?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tracking-tight text-foreground">{value}</p>
      {auxiliary && <p className="text-xs text-muted-foreground">{auxiliary}</p>}
    </div>
  );
}

/**
 * Investimento/resultados/custo por resultado/meta — abre a página do
 * cliente (Etapa 75: sem o rótulo "Principais KPIs do mês" acima, o card
 * começa direto pelas métricas). Nenhum cálculo muda: os 4 números sempre
 * vêm já calculados (`monthActual`/`monthPerformanceSummary`/
 * `targetCostPerResult` da própria página); os textos de resultado/custo
 * vêm de `deriveMonthlyKpiTexts` (lib/performance.ts), central e testável —
 * nunca recomputados aqui.
 *
 * Etapa "Meta entra no card principal": a Meta deixou de ser uma seção
 * própria ("Performance do mês", removida) e virou a 4ª métrica, com o
 * mesmo peso visual das outras 3 — ela é só mais um dado usado pra
 * interpretar o CPA/CPL, não um fluxo separado.
 *
 * Etapa "Remover comparação percentual do card": a linha de diagnóstico
 * ("X% acima/abaixo da meta"/"Dentro da meta", que ficava logo abaixo da
 * grade) foi removida — posicionada sob "Investimento total", ela dava a
 * entender que a comparação era sobre o valor investido, quando na verdade
 * sempre foi sobre custo por resultado vs. meta. A Meta continua exibida
 * normalmente como a 4ª métrica; só a leitura textual da comparação saiu
 * daqui (nenhuma outra tela foi alterada).
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

  const metaValue = targetCostPerResult !== null ? formatCurrency(targetCostPerResult) : "—";

  return (
    <div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Kpi label="Investimento total" value={formatCurrency(monthActual)} />
        <Kpi label="Resultados" value={resultsValue} auxiliary={resultsAuxiliary} />
        <Kpi label="Custo por resultado" value={costValue} />
        <Kpi label="Meta" value={metaValue} />
      </div>
      {!performanceGoal && (
        <Link href={configureObjectiveHref} className="mt-1 inline-block text-xs font-medium text-brand hover:underline">
          Configurar objetivo
        </Link>
      )}
    </div>
  );
}
