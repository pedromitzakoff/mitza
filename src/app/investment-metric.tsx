import Link from "next/link";
import type { StatusTone } from "@/components/workspace/status-dot";

const PRIMARY_VALUE_SIZE: Record<"lg" | "md", string> = {
  lg: "text-[36px]",
  md: "text-[28px]",
};

const TONE_TEXT_CLASSES: Record<StatusTone, string> = {
  success: "text-overview-success",
  warning: "text-overview-warning",
  danger: "text-overview-danger",
  neutral: "text-overview-text-primary",
  brand: "text-brand",
};

/**
 * Camada 1 do "Controle de investimento" (Etapa 69) — os números que o
 * olhar deve encontrar primeiro (Planejado, Realizado, Orçamento
 * utilizado). `size="lg"` marca Planejado/Realizado; `size="md"` marca
 * Orçamento utilizado (destaque intermediário, nunca do mesmo tamanho).
 * Só apresentação — recebe o valor já formatado.
 */
export function PrimaryInvestmentMetric({
  label,
  value,
  size = "lg",
}: {
  label: string;
  value: string;
  size?: "lg" | "md";
}) {
  return (
    <div>
      <p className="text-[13px] text-overview-text-secondary">{label}</p>
      <p className={`mt-1 ${PRIMARY_VALUE_SIZE[size]} font-semibold leading-none tracking-tight text-overview-text-primary tabular-nums`}>
        {value}
      </p>
    </div>
  );
}

/**
 * Camada 2 do "Controle de investimento" (Etapa 69) — o contexto de ritmo
 * (esperado hoje, esperado em reais, diferença, contas fora do ritmo).
 * Deliberadamente menor e mais discreto que `PrimaryInvestmentMetric`, pra
 * nunca competir visualmente com Planejado/Realizado/Orçamento utilizado.
 * `tone` só deve usar cor semântica (warning/danger) quando o desvio
 * realmente pede atenção — nunca decorativo.
 */
export function SecondaryInvestmentMetric({
  label,
  value,
  tone = "neutral",
  href,
  title,
}: {
  label: string;
  value: string;
  tone?: StatusTone;
  href?: string;
  title?: string;
}) {
  const content = (
    <div title={title}>
      <p className="text-[12px] text-overview-text-muted">{label}</p>
      <p className={`mt-0.5 text-[19px] font-medium leading-tight tabular-nums ${TONE_TEXT_CLASSES[tone]}`}>{value}</p>
    </div>
  );

  if (!href) return content;

  return (
    <Link
      href={href}
      className="-mx-1.5 -my-1 block rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-overview-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {content}
    </Link>
  );
}
