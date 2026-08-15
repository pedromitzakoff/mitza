import Link from "next/link";
import type { MetricDiagnostic, MetricDirection, MetricTone } from "@/lib/metric-diagnostics";

const TONE_TEXT_CLASSES: Record<MetricTone, string> = {
  normal: "text-overview-text-muted",
  attention: "text-overview-warning",
  critical: "text-overview-danger",
};

const DIRECTION_ARROW: Record<MetricDirection, string> = {
  up: "↑",
  down: "↓",
  flat: "",
};

/**
 * Unidade visual única pra qualquer indicador com meta/esperado (Etapa
 * "Motor de Diagnóstico Único") — reaproveitar em qualquer tela (Dashboard,
 * Operação, Prontuário do Cliente) em vez de montar essa combinação de
 * novo em cada lugar. Este componente NUNCA decide cor/direção sozinho —
 * só renderiza o que `evaluateMetricDiagnostic`/`evaluateCpaDiagnostic`/
 * `evaluateInvestmentDiagnostic` (src/lib/metric-diagnostics.ts) já
 * calcularam, pela mesma régua de magnitude pra qualquer métrica (até 10%
 * normal, 10–20% atenção, acima de 20% crítico). No estado normal a linha
 * de desvio nem aparece — só a exceção deve chamar atenção; a seta é
 * sempre só a direção matemática do desvio, nunca decide cor sozinha.
 *
 * `referenceLabel` (Etapa "Central de Decisão Diária" da Operação): junta
 * valor + referência (ex.: "Meta R$ 10,00") + desvio na MESMA linha, em vez
 * de uma coluna "Meta" separada em outro canto do layout — o pedido
 * explícito era aproximar essas três informações pra reduzir o esforço de
 * leitura lateral. Sem desvio (dentro do normal, ou sem diagnóstico), a
 * referência ainda aparece sozinha, só que em tom neutro (nunca inventa uma
 * cor de alerta que o diagnóstico não decidiu).
 */
export function MetricDeviation({
  label,
  value,
  diagnostic,
  size = "md",
  href,
  title,
  referenceLabel,
}: {
  label: string;
  value: string;
  /** `null` = sem meta/esperado configurado pra este indicador ainda, ou
   * indicador sem régua de desvio — nunca inventa um desvio quando não há
   * base de comparação; o componente simplesmente não mostra a linha de
   * desvio. */
  diagnostic: MetricDiagnostic | null;
  size?: "md" | "lg";
  href?: string;
  title?: string;
  /** Ex.: "Meta R$ 10,00" — texto de referência exibido junto do desvio
   * (`"Meta R$ 10,00 · ↑ 58%"`) ou sozinho, em tom neutro, quando não há
   * desvio a mostrar. `undefined` preserva o comportamento de sempre (só
   * valor + desvio, sem referência). */
  referenceLabel?: string;
}) {
  const valueClass = size === "lg" ? "text-2xl font-bold text-navy" : "text-base font-semibold text-overview-text-primary";

  const deviation =
    diagnostic && diagnostic.tone !== "normal" && diagnostic.deviationPct !== null
      ? {
          text: `${DIRECTION_ARROW[diagnostic.direction]} ${Math.abs(diagnostic.deviationPct * 100).toFixed(0)}%`.trim(),
          tone: diagnostic.tone,
        }
      : null;

  const referenceLine = referenceLabel
    ? { text: deviation ? `${referenceLabel} · ${deviation.text}` : referenceLabel, tone: deviation?.tone }
    : deviation
      ? { text: deviation.text, tone: deviation.tone }
      : null;

  const content = (
    <div title={title}>
      <p className="text-[11px] text-overview-text-muted">{label}</p>
      <p className={`tabular-nums ${valueClass}`}>{value}</p>
      {referenceLine && (
        <p className={`text-xs font-medium tabular-nums ${referenceLine.tone ? TONE_TEXT_CLASSES[referenceLine.tone] : "text-overview-text-muted"}`}>
          {referenceLine.text}
        </p>
      )}
    </div>
  );

  return href ? (
    <Link
      href={href}
      className="-mx-1.5 rounded-md px-1.5 py-0.5 transition-colors duration-150 hover:bg-overview-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {content}
    </Link>
  ) : (
    content
  );
}
