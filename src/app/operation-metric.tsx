/**
 * Um indicador da área "Indicadores da operação" (Etapa 69 — refinamento
 * visual da Visão Geral) — label discreto, valor principal com peso mas sem
 * exagero, e uma linha de contexto opcional (quantidade + percentual, ou uma
 * segunda métrica relacionada). Só apresentação: recebe tudo já formatado,
 * nunca calcula nada (nenhuma lógica de negócio aqui).
 */
export function OperationMetric({
  label,
  value,
  context,
  href,
  title,
}: {
  label: string;
  value: string;
  context?: string;
  href?: string;
  title?: string;
}) {
  const content = (
    <div title={title}>
      <p className="text-[13px] text-overview-text-secondary">{label}</p>
      <p className="mt-1 text-[26px] font-semibold leading-none tracking-tight text-overview-text-primary tabular-nums">
        {value}
      </p>
      {context && <p className="mt-1.5 text-[13px] text-overview-text-muted">{context}</p>}
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
