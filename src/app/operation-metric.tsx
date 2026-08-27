import Link from "next/link";
import type { ReactNode } from "react";
import type { StatusTone } from "@/components/workspace/status-dot";
import { TONE_TEXT_CLASSES } from "./investment-metric";
import type { AnalyticsKpiComparison } from "@/lib/analytics";

/** Mesma paleta de tom usada pra "↑X%"/"↓X%" no Hero do Analytics do
 * cliente (`AnalyticsKpiComparisonTone`) — reaproveitada aqui pra "Evolução
 * no período" da Visão Geral colorir a variação embutida no big number
 * (Etapa "Refinamento visual da Visão Geral — Síntese"), nunca uma segunda
 * paleta de verde/vermelho/neutro. */
export const COMPARISON_TONE_TEXT_CLASSES: Record<AnalyticsKpiComparison["tone"], string> = {
  positive: "text-overview-success",
  negative: "text-overview-danger",
  neutral: "text-overview-text-muted",
};

/**
 * Um indicador da área "Indicadores da operação" (Etapa 69 — refinamento
 * visual da Visão Geral) — label discreto, valor principal com peso mas sem
 * exagero, e uma linha de contexto opcional (quantidade + percentual, ou uma
 * segunda métrica relacionada). Só apresentação: recebe tudo já formatado,
 * nunca calcula nada (nenhuma lógica de negócio aqui).
 *
 * Facelift "Painel financeiro e operacional": ganhou `tone` (cor semântica do
 * valor, mesma paleta de `SecondaryInvestmentMetric`) e `linkHref`/`linkLabel`
 * — um link curto abaixo do contexto (ex.: "Ver contas"), pra indicadores que
 * levam a uma lista filtrada sem precisar tornar o card inteiro clicável.
 *
 * Etapa "Refinamento Visão Geral da Agência": `emphasis` dá um destaque a
 * mais pro indicador financeiro principal (Investimento realizado) sem
 * alterar os outros 3 — mesma família tipográfica, só maior/mais pesado.
 *
 * Etapa "Refinamento visual da Visão Geral — Síntese": a seção separada
 * "Evolução no período" foi incorporada aqui — `comparison` (o mesmo objeto
 * já devolvido por `buildPercentChangeComparison`, `lib/analytics.ts`, sem
 * nenhum recálculo) renderiza a variação logo abaixo do big number, na
 * hierarquia label → número → variação → contexto pedida. `context` passa a
 * aceitar `ReactNode` (era só `string`) pra poder embutir a variação de uma
 * métrica secundária (ex.: "CPL R$17,54 · ↑49%") sem precisar de uma linha à
 * parte.
 */
export function OperationMetric({
  label,
  value,
  comparison,
  context,
  href,
  title,
  tone = "neutral",
  linkHref,
  linkLabel,
  emphasis = false,
}: {
  label: string;
  value: string;
  /** `null`/ausente = sem base de comparação real pra este indicador nesta
   * ocasião — nunca uma variação fabricada (mesma regra de
   * `computePercentChange`). */
  comparison?: AnalyticsKpiComparison | null;
  context?: ReactNode;
  href?: string;
  title?: string;
  tone?: StatusTone;
  linkHref?: string;
  linkLabel?: string;
  emphasis?: boolean;
}) {
  const content = (
    <div title={title}>
      <p className="text-[13px] text-overview-text-secondary">{label}</p>
      {/* Refinamento Visual da Visão Geral (Painel Financeiro/Operacional):
          font-semibold → font-medium (~10% mais leve) — mesmo tamanho e
          hierarquia, só um traço menos pesado pra equilibrar o conjunto com
          as demais métricas da página. */}
      <p
        className={`mt-1 leading-none tracking-tight tabular-nums ${
          emphasis ? "text-[27px] font-semibold" : "text-[22px] font-medium"
        } ${TONE_TEXT_CLASSES[tone]}`}
      >
        {value}
      </p>
      {comparison && (
        <p className={`mt-1 text-[13px] font-medium ${COMPARISON_TONE_TEXT_CLASSES[comparison.tone]}`}>{comparison.text}</p>
      )}
      {context && <p className={comparison ? "mt-1 text-[13px] text-overview-text-muted" : "mt-1.5 text-[13px] text-overview-text-muted"}>{context}</p>}
      {linkHref && linkLabel && (
        <Link
          href={linkHref}
          className="mt-1.5 inline-block text-[13px] text-overview-text-muted underline decoration-overview-border hover:text-overview-text-secondary"
        >
          {linkLabel}
        </Link>
      )}
    </div>
  );

  if (!href) return content;

  return (
    <a
      href={href}
      className="-mx-2 -my-1 block rounded-md px-2 py-1 transition-colors duration-150 hover:bg-overview-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {content}
    </a>
  );
}
