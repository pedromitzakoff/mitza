import Link from "next/link";
import type { MetricDiagnostic, MetricDirection, MetricTone } from "@/lib/metric-diagnostics";

const TONE_TEXT_CLASSES: Record<MetricTone, string> = {
  positive: "text-overview-success",
  negative: "text-overview-danger",
  neutral: "text-overview-text-muted",
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
 * calcularam. A seta é sempre só a direção matemática do desvio; a cor
 * vem exclusivamente de `diagnostic.tone`, resolvido pela regra do
 * indicador (menor-é-melhor, maior-é-melhor, ou qualquer-desvio-é-ruim) —
 * nunca da seta.
 */
export function MetricDeviation({
  label,
  value,
  diagnostic,
  size = "md",
  href,
  title,
}: {
  label: string;
  value: string;
  /** `null` = sem meta/esperado configurado pra este indicador ainda —
   * nunca inventa um desvio quando não há base de comparação; o
   * componente simplesmente não mostra a linha de desvio. */
  diagnostic: MetricDiagnostic | null;
  size?: "md" | "lg";
  href?: string;
  title?: string;
}) {
  const valueClass = size === "lg" ? "text-2xl font-bold text-navy" : "text-base font-semibold text-overview-text-primary";

  const deviation =
    diagnostic && diagnostic.deviationPct !== null
      ? {
          text: `${DIRECTION_ARROW[diagnostic.direction]} ${Math.abs(diagnostic.deviationPct * 100).toFixed(0)}%`.trim(),
          tone: diagnostic.tone,
        }
      : null;

  const content = (
    <div title={title}>
      <p className="text-[11px] text-overview-text-muted">{label}</p>
      <p className={`tabular-nums ${valueClass}`}>{value}</p>
      {deviation && (
        <p className={`text-xs font-medium tabular-nums ${TONE_TEXT_CLASSES[deviation.tone]}`}>{deviation.text}</p>
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
