import Link from "next/link";
import type { StatusTone } from "./status-dot";

const TONE_TEXT_CLASSES: Record<StatusTone, string> = {
  success: "text-overview-success",
  warning: "text-overview-warning",
  danger: "text-overview-danger",
  neutral: "text-overview-text-primary",
  brand: "text-brand",
};

/** Um indicador label+valor — a unidade básica de "Saúde da operação" e
 * "Controle de investimento". `size="lg"` marca os números mais
 * importantes de um grupo (ex.: Planejado/Realizado) com mais peso visual;
 * os demais ficam secundários por padrão. Clicável (`href`) quando o
 * indicador filtra a tabela — hover discreto, nunca um botão. */
export function Metric({
  label,
  value,
  href,
  tone = "neutral",
  size = "md",
  title,
}: {
  label: string;
  value: string;
  href?: string;
  tone?: StatusTone;
  size?: "md" | "lg";
  title?: string;
}) {
  const valueClass =
    size === "lg"
      ? `text-2xl font-bold ${tone === "neutral" ? "text-navy" : TONE_TEXT_CLASSES[tone]}`
      : `text-base font-semibold ${TONE_TEXT_CLASSES[tone]}`;

  const content = (
    <div title={title}>
      <p className="text-[11px] text-overview-text-muted">{label}</p>
      <p className={`tabular-nums ${valueClass}`}>{value}</p>
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
