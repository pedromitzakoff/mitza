/** Barra fina de progresso financeiro da sprint — azul MITZA no estado
 * normal, vermelho discreto só quando o gasto ultrapassa o planejado
 * (preenchimento nunca passa de 100% de largura). Componente único
 * compartilhado por Sprints (client-group.tsx) e pela página do cliente
 * (sprint-card.tsx) — nunca duas barras diferentes mostrando a mesma coisa. */
export function SprintFinancialBar({ actualSpend, plannedSpend }: { actualSpend: number; plannedSpend: number }) {
  if (plannedSpend <= 0) {
    return (
      <div>
        <div className="h-1 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" />
        <p className="mt-0.5 text-[11px] text-muted-foreground">Meta não configurada</p>
      </div>
    );
  }

  const pct = (actualSpend / plannedSpend) * 100;
  const barWidth = Math.min(Math.max(pct, 0), 100);
  const isOver = pct > 100;

  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div
        className={`h-full rounded-full ${isOver ? "bg-red-500" : "bg-brand"}`}
        style={{ width: `${barWidth}%` }}
      />
    </div>
  );
}
