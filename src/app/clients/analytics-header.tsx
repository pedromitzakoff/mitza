import Link from "next/link";
import { ANALYTICS_PERIOD_PRESET_OPTIONS, type AnalyticsPeriodPreset } from "@/lib/analytics";
import { formatDateRange } from "@/lib/format";

/**
 * Seletor de período do Analytics — SEMPRE independente de sprint (pedido
 * explícito do usuário). 100% server-rendered (Links + `<form method="get">`
 * nativo pro período personalizado), mesmo padrão de navegação por
 * querystring já usado no resto da página (mês anterior/próximo, abas) —
 * nenhum JavaScript de cliente novo só pra trocar o período.
 */
export function AnalyticsHeader({
  baseHref,
  activePreset,
  customStart,
  customEnd,
  periodStart,
  periodEnd,
}: {
  /** URL da própria aba Analytics, já com `area=analytics` — cada preset só
   * concatena `&analyticsPreset=...`. */
  baseHref: string;
  activePreset: AnalyticsPeriodPreset;
  /** Pré-preenche o formulário de período personalizado — sempre o período
   * efetivamente em exibição (mesmo quando o preset ativo não é "custom"),
   * pra abrir o ajuste manual já a partir do que está na tela. */
  customStart: string;
  customEnd: string;
  periodStart: string;
  periodEnd: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Analytics</h2>
          <p className="text-xs text-muted-foreground">{formatDateRange(periodStart, periodEnd)}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {ANALYTICS_PERIOD_PRESET_OPTIONS.map((option) => (
            <Link
              key={option.value}
              href={`${baseHref}&analyticsPreset=${option.value}`}
              scroll={false}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                activePreset === option.value
                  ? "bg-brand text-white"
                  : "border border-border text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      <form action={baseHref.split("?")[0]} className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
        {baseHref
          .split("?")[1]
          ?.split("&")
          .filter((pair) => pair && !pair.startsWith("analyticsPreset=") && !pair.startsWith("analyticsStart=") && !pair.startsWith("analyticsEnd="))
          .map((pair) => {
            const [key, value] = pair.split("=");
            return <input key={key} type="hidden" name={key} value={decodeURIComponent(value ?? "")} />;
          })}
        <input type="hidden" name="analyticsPreset" value="custom" />
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Data inicial
          <input
            type="date"
            name="analyticsStart"
            defaultValue={customStart}
            className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Data final
          <input
            type="date"
            name="analyticsEnd"
            defaultValue={customEnd}
            className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground"
          />
        </label>
        <button
          type="submit"
          className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
            activePreset === "custom" ? "bg-brand text-white" : "border border-border text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          }`}
        >
          Personalizado
        </button>
      </form>
    </div>
  );
}
