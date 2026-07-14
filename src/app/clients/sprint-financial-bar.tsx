import type { SprintFinancials } from "@/lib/sprint-financials";
import { formatCurrency } from "@/lib/format";
import { resolveSprintPeriodSummary, computeExpectedPct, formatRitmoDiffText, positionExpectedMarker } from "@/lib/financial-period";

/**
 * Barra fina de progresso financeiro da sprint — preenchimento azul MITZA
 * (gasto real / planejado, nunca passa de 100% de largura; vermelho
 * discreto só quando o gasto ultrapassa o planejado) com um marcador
 * vertical escuro sobre o "gasto esperado até hoje". Etapa 63: parou de
 * recalcular %/ritmo por conta própria — monta o mesmo `FinancialPeriodSummary`
 * central (`resolveSprintPeriodSummary`) e reaproveita as mesmas funções que
 * `AgencyInvestmentBar` usa, pra nunca haver duas contas de "ritmo"
 * divergentes entre a barra da sprint e a barra do mês. Componente único
 * compartilhado por Sprints (current-client-group.tsx) e pela página do
 * cliente (sprint-card.tsx) — nunca duas barras diferentes mostrando a
 * mesma coisa.
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

  const summary = resolveSprintPeriodSummary(sprint, "");
  const actualPct = summary.pct ?? 0;
  const expectedPct = computeExpectedPct(summary);
  const fillWidth = Math.min(Math.max(actualPct, 0), 100);
  const markerPos = positionExpectedMarker(expectedPct);
  const isOver = actualPct > 100;
  // Sprint que ainda não começou: nunca "Dentro do ritmo esperado" (0
  // gasto vs 0 esperado não é sucesso, é só ausência de dados ainda) — o
  // marcador de esperado some (não faz sentido marcar 0% como referência)
  // e a legenda vira neutra.
  const notStarted = status === "nao_iniciado";
  const ritmoText = notStarted ? "Período ainda não iniciado" : formatRitmoDiffText(summary);

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
        {!notStarted && (
          <div
            className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-700 dark:bg-zinc-300"
            style={{ left: `${markerPos}%` }}
            title={`Esperado até hoje\n${formatCurrency(expectedToDate)}\n${Math.round(expectedPct)}% do planejado`}
          />
        )}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {notStarted ? ritmoText : `${Math.round(actualPct)}% gasto · ${Math.round(expectedPct)}% esperado até hoje${ritmoText ? ` · ${ritmoText}` : ""}`}
      </p>
    </div>
  );
}
