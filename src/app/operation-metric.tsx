import Link from "next/link";
import type { StatusTone } from "@/components/workspace/status-dot";
import { TONE_TEXT_CLASSES } from "./investment-metric";

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
 */
export function OperationMetric({
  label,
  value,
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
  context?: string;
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
      {context && <p className="mt-1.5 text-[13px] text-overview-text-muted">{context}</p>}
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

/**
 * Faixa compacta de "Operação" (Facelift "Painel financeiro e operacional"):
 * label pequeno + valor de destaque intermediário — deliberadamente menor
 * que `OperationMetric`/`PrimaryInvestmentMetric` (esses indicadores não
 * disputam atenção com os KPIs de Resultados/Ritmo, só descrevem a execução
 * operacional). `context` é sempre secundário (ex.: o % de execução abaixo
 * da contagem bruta de tarefas), nunca outro número do mesmo peso.
 */
export function OperationMiniKpi({
  label,
  value,
  context,
}: {
  label: string;
  value: string;
  context?: string;
}) {
  return (
    <div>
      <p className="text-[10.5px] font-medium uppercase tracking-wide text-overview-text-muted">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold leading-none text-overview-text-primary tabular-nums">{value}</p>
      {context && <p className="mt-1 text-[11px] text-overview-text-muted">{context}</p>}
    </div>
  );
}
