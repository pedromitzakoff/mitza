import type { SprintFinancials } from "@/lib/sprint-financials";
import { formatCurrency } from "@/lib/format";

/**
 * Barra fina de progresso financeiro da sprint — preenchimento azul MITZA
 * (gasto real / planejado, nunca passa de 100% de largura; vermelho
 * discreto só quando o gasto ultrapassa o planejado) com um marcador
 * vertical escuro sobre o "gasto esperado até hoje" (dias corridos da
 * sprint, mesma conta já centralizada em computeSprintFinancials — não
 * inventa uma tolerância nova). Componente único compartilhado por Sprints
 * (client-group.tsx) e pela página do cliente (sprint-card.tsx) — nunca
 * duas barras diferentes mostrando a mesma coisa.
 */
export function SprintFinancialBar({ sprint }: { sprint: SprintFinancials }) {
  const { plannedSpend, actualSpend, expectedToDate, status } = sprint;

  if (plannedSpend <= 0) {
    return (
      <div>
        <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" />
        <p className="mt-0.5 text-[11px] text-muted-foreground">Meta não configurada</p>
      </div>
    );
  }

  const actualPct = (actualSpend / plannedSpend) * 100;
  const expectedPct = (expectedToDate / plannedSpend) * 100;
  const fillWidth = Math.min(Math.max(actualPct, 0), 100);
  const markerPos = Math.min(Math.max(expectedPct, 1), 99);
  const isOver = actualPct > 100;
  const ppDiff = Math.round(Math.abs(actualPct - expectedPct));

  const ritmoText =
    status === "acima"
      ? `${ppDiff} p.p. acima do ritmo`
      : status === "abaixo"
        ? `${ppDiff} p.p. abaixo do ritmo`
        : status === "dentro"
          ? "Dentro do ritmo esperado"
          : null;

  return (
    <div>
      <div className="relative h-1.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full ${isOver ? "bg-red-500" : "bg-brand"}`}
            style={{ width: `${fillWidth}%` }}
            title={`Gasto real\n${formatCurrency(actualSpend)}\n${Math.round(actualPct)}% do planejado`}
          />
        </div>
        <div
          className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-700 dark:bg-zinc-300"
          style={{ left: `${markerPos}%` }}
          title={`Esperado até hoje\n${formatCurrency(expectedToDate)}\n${Math.round(expectedPct)}% do planejado`}
        />
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {Math.round(actualPct)}% gasto · {Math.round(expectedPct)}% esperado até hoje
        {ritmoText ? ` · ${ritmoText}` : ""}
      </p>
    </div>
  );
}
