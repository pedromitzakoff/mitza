import type { AnalyticsHero } from "@/lib/analytics";

/**
 * Hero do Analytics — Etapa "Analytics Instagramável": o primeiro elemento
 * que o olho encontra, pedido explícito do usuário como "próximo de uma
 * landing page, não de um dashboard". UM número central (nunca uma lista),
 * dependente do objetivo (`buildAnalyticsHero`), com a variação vs. período
 * anterior de mesma duração só aparecendo quando existe uma base real de
 * comparação — sem seta/percentual fabricado quando `percentChange` é
 * `null` (sem histórico, ou período anterior zerado).
 */
export function AnalyticsHeroSection({ hero, periodLabel }: { hero: AnalyticsHero; periodLabel: string }) {
  const trend =
    hero.percentChange === null
      ? null
      : hero.percentChange >= 0
        ? { symbol: "▲", tone: "text-emerald-600 dark:text-emerald-400" }
        : { symbol: "▼", tone: "text-red-600 dark:text-red-500" };

  return (
    <div className="flex flex-col gap-3 py-6 sm:py-10">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{periodLabel}</p>
      <p className="text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
        {hero.value} <span className="text-xl font-medium text-muted-foreground sm:text-2xl">{hero.label}</span>
      </p>
      {trend && (
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold tabular-nums ${trend.tone}`}>
            {trend.symbol} {Math.abs(hero.percentChange!).toFixed(0)}%
          </span>
          <span className="text-xs text-muted-foreground">comparado ao período anterior</span>
        </div>
      )}
    </div>
  );
}
