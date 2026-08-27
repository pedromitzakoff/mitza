import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "brand";

const DOT_CLASSES: Record<StatusTone, string> = {
  success: "bg-overview-success",
  warning: "bg-overview-warning",
  danger: "bg-overview-danger",
  neutral: "bg-overview-text-muted",
  brand: "bg-brand",
};

const LABEL_CLASSES: Record<StatusTone, string> = {
  success: "text-overview-success",
  warning: "text-overview-warning",
  danger: "text-overview-danger",
  neutral: "text-overview-text-secondary",
  brand: "text-brand",
};

/**
 * "● Normal" / "● Atenção" / "● Crítico" — a preferência do novo Design
 * System (Etapa 47) por status dot + texto em vez de badges/pills grandes.
 * Nunca comunica estado só por cor: o texto ao lado é sempre exibido.
 */
export function StatusDot({
  tone,
  label,
  className,
  emphasize = false,
}: {
  tone: StatusTone;
  label: string;
  className?: string;
  /** Rótulo em cor semântica (ex.: "Crítico" em vermelho) em vez de texto
   * secundário neutro — usar com moderação (severidades altas). */
  emphasize?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${className ?? ""}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASSES[tone]}`} aria-hidden="true" />
      <span className={emphasize ? `font-medium ${LABEL_CLASSES[tone]}` : "text-overview-text-secondary"}>{label}</span>
    </span>
  );
}

/** Destaca só o primeiro percentual dentro de um motivo ("CPL 58% acima da
 * meta") — o número é o fato acionável, o resto da frase continua no mesmo
 * peso neutro de sempre. Utilitário compartilhado (ex.: Operação) pra
 * qualquer tela reaproveitar sem duplicar o regex. */
export function emphasizeDeviationText(reason: string, tone: StatusTone): ReactNode {
  const match = reason.match(/\d+%/);
  if (!match || match.index === undefined) return reason;
  const start = match.index;
  const end = start + match[0].length;
  return (
    <>
      {reason.slice(0, start)}
      <span className={`font-semibold ${LABEL_CLASSES[tone]}`}>{match[0]}</span>
      {reason.slice(end)}
    </>
  );
}
