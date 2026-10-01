import { currentMonthRange, shiftMonthParam } from "@/lib/sprint-financials";
import { formatMonthLabel } from "@/lib/format";
import { ClientContextSelect } from "./client-context-select";

/**
 * Lista de meses selecionáveis (`?month=YYYY-MM`) — núcleo puro, testável
 * sem DOM. Reaproveita `currentMonthRange`/`shiftMonthParam`
 * (`lib/sprint-financials.ts`, já usados pela navegação prev/next de
 * sempre) — nenhuma conta de data nova, só uma janela ao redor do mês
 * corrente. 12 meses pra trás cobre o histórico recente de planejamento;
 * 3 pra frente cobre o horizonte de planejamento futuro já comum na
 * plataforma (`client_month_horizons`).
 */
export function listMonthOptions(today: Date, monthsBack = 12, monthsForward = 3): string[] {
  const current = currentMonthRange(today);
  const options: string[] = [];
  for (let offset = -monthsBack; offset <= monthsForward; offset++) {
    options.push(shiftMonthParam(current, offset));
  }
  return options;
}

/**
 * Seletor de mês (Etapa "Primeira Rodada Visual — Contexto + Performance",
 * seção 4 do pedido): evolui o prev/next (preservado ao lado, como atalho
 * discreto) pra um dropdown explícito — mesmo estado de sempre
 * (`?month=YYYY-MM`, resolvido por `monthRangeFromParam`), nenhuma regra
 * de mês nova. Troca de cliente continua preservando `month` exatamente
 * como já preservava (`ClientWorkspaceHeader`, fora do escopo desta
 * etapa) — este componente só lê/escreve o mesmo param.
 */
export function MonthSelect({
  today,
  selectedMonthParam,
  buildHref,
}: {
  /** Instante real (`todayUTC()`) — mesma referência que `currentMonthRange` já usa em toda a plataforma. */
  today: Date;
  /** Mês em exibição, formato `YYYY-MM` (mesmo `monthParam` já calculado em `page.tsx`). */
  selectedMonthParam: string;
  buildHref: (monthParam: string) => string;
}) {
  const options = listMonthOptions(today).map((value) => ({
    value,
    label: formatMonthLabel(`${value}-01`),
    href: buildHref(value),
    active: value === selectedMonthParam,
  }));

  return <ClientContextSelect label={formatMonthLabel(`${selectedMonthParam}-01`)} options={options} ariaLabel="Mês" />;
}
