export type MetricThermometerMode = "higher-better" | "lower-better";
export type MetricThermometerTone = "neutral" | "warning" | "danger";

const FILL_TONE_CLASS: Record<MetricThermometerTone, string> = {
  neutral: "bg-brand",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Termômetro único e reutilizável (Etapa "Redesenho da Operação") —
 * investimento e resultado usam `mode="higher-better"` (barra = progresso
 * em direção a um alvo, marcador = ritmo esperado até hoje); custo usa
 * `mode="lower-better"` (menor é melhor: sem marcador de ritmo — a meta É
 * o próprio limite da barra — e com indicador acima/abaixo da meta ao
 * lado do valor). O comportamento muda por PROPRIEDADE, nunca por um
 * componente `Cost*` separado.
 *
 * Nunca infere ausência a partir de `actual`/`planned` sendo `0` — todo
 * estado de ausência (sem plano, sem dados sincronizados, amostra
 * insuficiente etc.) é decidido por quem chama (`operation-client-card.tsx`,
 * a partir dos campos explícitos do `AccountHealthEvaluation`) e passado
 * como `emptyMessage`, que substitui a barra por um texto neutro.
 *
 * `tone` também vem de fora — sempre derivado de `DimensionSeverity` (nunca
 * recalculado aqui), pra nunca ter duas fontes de verdade sobre o que é
 * "grave" nesta plataforma.
 */
export function MetricThermometer({
  label,
  mode,
  actual,
  planned,
  expected,
  formattedActual,
  formattedPlanned,
  tone,
  emptyMessage,
}: {
  label: string;
  mode: MetricThermometerMode;
  actual: number | null;
  planned: number | null;
  /** Marcador de ritmo esperado até hoje — `null`/igual a `planned` não
   * desenha marcador (ex.: custo, onde a meta já É o limite da barra). */
  expected: number | null;
  formattedActual: string;
  formattedPlanned: string;
  tone: MetricThermometerTone;
  /** Quando definido, substitui a barra por esta mensagem neutra — nunca
   * inferida de `0`. */
  emptyMessage?: string;
  /** Reservado pra uma futura indicação de tendência (melhorando/piorando/
   * estável) — não usado nesta etapa; o slot já existe pra não precisar
   * remodelar o componente quando ela chegar. */
  trend?: "up" | "down" | "stable";
}) {
  const isLowerBetter = mode === "lower-better";
  const hasBar = !emptyMessage && planned !== null && planned > 0 && actual !== null;

  const fillPct = hasBar ? clamp((actual! / planned!) * 100, 0, 100) : 0;
  const markerPct =
    hasBar && expected !== null && expected !== planned ? clamp((expected / planned!) * 100, 2, 98) : null;
  const isOverPlanned = hasBar && actual! > planned!;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {!emptyMessage && (
          <span className="whitespace-nowrap text-xs tabular-nums text-foreground">
            {formattedActual}
            <span className="text-muted-foreground">
              {" / "}
              {isLowerBetter ? "meta " : ""}
              {formattedPlanned}
            </span>
            {isLowerBetter && hasBar && (
              <span className={`ml-1.5 ${isOverPlanned ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                {isOverPlanned ? "▲ acima" : "▼ abaixo"}
              </span>
            )}
          </span>
        )}
      </div>

      {emptyMessage ? (
        <p className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] text-muted-foreground dark:bg-zinc-900">{emptyMessage}</p>
      ) : (
        <div className="relative h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full transition-[width] duration-200 ease-out ${FILL_TONE_CLASS[tone]}`}
            style={{ width: `${fillPct}%` }}
          />
          {markerPct !== null && (
            <div
              className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-foreground/40"
              style={{ left: `${markerPct}%` }}
              title="Esperado até hoje"
            />
          )}
        </div>
      )}
    </div>
  );
}
