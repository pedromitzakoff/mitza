import { formatCurrency } from "@/lib/format";

/**
 * Barra compacta do resumo "Investimento do mês" da Visão Geral — preenchimento
 * azul MITZA (realizado / planejado, nunca passa de 100% de largura; vermelho
 * discreto só quando ultrapassa o planejado) com um marcador circular
 * destacado (não um traço fino) sobre "esperado até hoje", com tooltip.
 * Mesma linguagem visual de `SprintFinancialBar`, mas o marcador aqui é mais
 * visível — pedido explícito pra este resumo, que é a peça central do
 * dashboard da agência.
 */
export function AgencyInvestmentBar({
  planned,
  actual,
  expectedToDate,
}: {
  planned: number;
  actual: number;
  expectedToDate: number;
}) {
  if (planned <= 0) {
    return (
      <div>
        <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" />
        <p className="mt-1 text-[11px] text-muted-foreground">Nenhum planejamento configurado neste recorte.</p>
      </div>
    );
  }

  const actualPct = (actual / planned) * 100;
  const expectedPct = (expectedToDate / planned) * 100;
  const fillWidth = Math.min(Math.max(actualPct, 0), 100);
  const markerPos = Math.min(Math.max(expectedPct, 2), 98);
  const isOver = actualPct > 100;

  return (
    <div className="relative h-2.5">
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full ${isOver ? "bg-red-500" : "bg-brand"}`}
          style={{ width: `${fillWidth}%` }}
        />
      </div>
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-help rounded-full border-2 border-white bg-zinc-700 shadow-sm dark:border-zinc-950 dark:bg-zinc-300"
        style={{ left: `${markerPos}%` }}
        title={`Esperado até hoje\n${formatCurrency(expectedToDate)}\n${Math.round(expectedPct)}% do planejado`}
      />
    </div>
  );
}
