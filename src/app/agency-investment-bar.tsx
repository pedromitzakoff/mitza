import { formatCurrency } from "@/lib/format";

/**
 * Barra do resumo "Investimento do mês" da Visão Geral — o componente mais
 * característico do dashboard (Etapa 41): trilha neutra mais espessa,
 * preenchimento azul MITZA (realizado / planejado, nunca passa de 100% de
 * largura; vermelho discreto só quando ultrapassa o planejado) com
 * transição curta ao mudar de mês/filtro, e um marcador circular — não um
 * traço fino — sobre "esperado até hoje", com tooltip nativo. Mesma
 * linguagem visual de `SprintFinancialBar`, com mais presença aqui porque é
 * a peça central da tela.
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
        <div className="h-3 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" />
        <p className="mt-1.5 text-[11px] text-muted-foreground">Nenhum planejamento configurado neste recorte.</p>
      </div>
    );
  }

  const actualPct = (actual / planned) * 100;
  const expectedPct = (expectedToDate / planned) * 100;
  const fillWidth = Math.min(Math.max(actualPct, 0), 100);
  const markerPos = Math.min(Math.max(expectedPct, 2), 98);
  const isOver = actualPct > 100;

  return (
    <div>
      <div className="relative h-3">
        <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ease-out ${isOver ? "bg-red-500" : "bg-brand"}`}
            style={{ width: `${fillWidth}%` }}
          />
        </div>
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-help rounded-full border-2 border-white bg-navy shadow-[var(--shadow-float)] transition-[left] duration-300 ease-out dark:border-zinc-950"
          style={{ left: `${markerPos}%` }}
          title={`Esperado até hoje\n${formatCurrency(expectedToDate)}\n${Math.round(expectedPct)}% do planejado`}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {Math.round(actualPct)}% realizado · {Math.round(expectedPct)}% esperado até hoje
      </p>
    </div>
  );
}
