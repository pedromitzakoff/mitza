import type { AnalyticsHero } from "@/lib/analytics";

/**
 * Hero do Analytics — Etapa "Analytics Instagramável" (facelift): o primeiro
 * elemento que o olho encontra. UM número central (nunca uma lista),
 * dependente do objetivo (`buildAnalyticsHero`), com a variação vs. período
 * anterior de mesma duração só aparecendo quando existe uma base real de
 * comparação — sem seta/percentual fabricado quando `percentChange` é
 * `null` (sem histórico, ou período anterior zerado).
 *
 * Facelift: reduzido de `text-6xl` pra `text-4xl` (ainda o maior elemento da
 * tela, sem dominar a viewport) — valor e rótulo ficam na MESMA linha de
 * texto, tratados como um bloco único só com peso/cor diferentes, em vez de
 * dois tamanhos de fonte bem distintos que liam como elementos separados. O
 * rótulo de período saiu daqui (já aparece no seletor de período do
 * cabeçalho — nunca repetir a mesma informação duas vezes na tela).
 */
export function AnalyticsHeroSection({ hero }: { hero: AnalyticsHero }) {
  const trend =
    hero.percentChange === null
      ? null
      : hero.percentChange >= 0
        ? { symbol: "↑", tone: "text-emerald-600 dark:text-emerald-400" }
        : { symbol: "↓", tone: "text-red-600 dark:text-red-500" };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {hero.value} <span className="text-lg font-medium text-muted-foreground sm:text-xl">{hero.label}</span>
      </p>
      {trend && (
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-semibold tabular-nums ${trend.tone}`}>
            {trend.symbol} {Math.abs(hero.percentChange!).toFixed(0)}%
          </span>
          <span className="text-xs text-muted-foreground">comparado ao período anterior</span>
        </div>
      )}
    </div>
  );
}
