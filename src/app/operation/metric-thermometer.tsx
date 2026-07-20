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
 * Termômetro único e reutilizável — versão compacta de uma linha só
 * (Etapa "Compactação da Operação"). Nenhuma mudança de comportamento em
 * relação à versão anterior: mesmo cálculo de barra (`actual/planned`,
 * capado em 100%), mesmo marcador de ritmo esperado (`expected`, só pra
 * `mode="higher-better"` — custo nunca tem, porque a meta já é o próprio
 * limite da barra), mesmo `tone` vindo de fora (nunca recalculado aqui) e
 * mesma regra de ausência (`emptyMessage`, nunca inferida de `actual`/
 * `planned` sendo `0`). Só o LAYOUT mudou: sem legenda por extenso (a
 * ordem fixa investimento→resultado→custo, sempre a mesma em todo card, é
 * o que ensina qual coluna é qual) e sem o valor da meta em texto (a
 * barra e o marcador já comunicam isso visualmente) — pra caber os três
 * indicadores mais a metadata numa única linha, sem nunca variar a altura
 * do card. Estado vazio vira um "—" com a explicação completa só no
 * `title` (tooltip nativo do navegador), nunca um texto que ocupe espaço
 * extra.
 */
export function MetricThermometer({
  mode,
  actual,
  planned,
  expected,
  formattedActual,
  tone,
  emptyMessage,
}: {
  mode: MetricThermometerMode;
  actual: number | null;
  planned: number | null;
  /** Marcador de ritmo esperado até hoje — `null`/igual a `planned` não
   * desenha marcador (ex.: custo, onde a meta já É o limite da barra). */
  expected: number | null;
  formattedActual: string;
  tone: MetricThermometerTone;
  /** Quando definido, substitui valor+barra por "—" (texto completo só no
   * `title`) — nunca inferido de `0`, nunca muda a altura da linha. */
  emptyMessage?: string;
  /** Reservado pra uma futura indicação de tendência (melhorando/piorando/
   * estável) — não usado nesta etapa; o slot já existe pra não precisar
   * remodelar o componente quando ela chegar. */
  trend?: "up" | "down" | "stable";
}) {
  const hasBar = !emptyMessage && planned !== null && planned > 0 && actual !== null;
  const fillPct = hasBar ? clamp((actual! / planned!) * 100, 0, 100) : 0;
  const markerPct =
    hasBar && expected !== null && expected !== planned ? clamp((expected / planned!) * 100, 4, 96) : null;
  const isOverPlanned = hasBar && mode === "lower-better" && actual! > planned!;

  if (emptyMessage) {
    return (
      <span className="whitespace-nowrap text-xs text-muted-foreground" title={emptyMessage}>
        —
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span className="whitespace-nowrap text-xs tabular-nums text-foreground">{formattedActual}</span>
      {isOverPlanned && <span className="text-[10px] leading-none text-red-600 dark:text-red-400">▲</span>}
      <span className="relative h-1 w-10 shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${FILL_TONE_CLASS[tone]}`}
          style={{ width: `${fillPct}%` }}
        />
        {markerPct !== null && (
          <span
            className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-foreground/40"
            style={{ left: `${markerPct}%` }}
          />
        )}
      </span>
    </span>
  );
}
