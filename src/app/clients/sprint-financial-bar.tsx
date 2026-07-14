/**
 * Barra fina de progresso financeiro da sprint — preenchimento azul MITZA
 * (gasto real / previsto, nunca passa de 100% de largura; vermelho discreto
 * só quando o gasto ultrapassa o previsto). Etapa 65: removido o marcador de
 * "esperado até hoje" (linha vertical + legenda) e qualquer texto abaixo da
 * barra — o gestor já tem os valores exatos nos 4 indicadores acima dela,
 * nunca mais uma segunda leitura de "ritmo" só pra esta barra. Recebe
 * `actualSpend`/`totalPrevisto` já prontos (mesma fonte de
 * `computeSprintInvestmentAmounts` que os indicadores usam) em vez de um
 * `FinancialPeriodSummary` — essa barra não representa mais "esperado",
 * então não precisa mais do formato central de ritmo.
 */
export function SprintFinancialBar({ actualSpend, totalPrevisto }: { actualSpend: number; totalPrevisto: number }) {
  if (totalPrevisto <= 0) {
    return <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800" />;
  }

  const actualPct = (actualSpend / totalPrevisto) * 100;
  const fillWidth = Math.min(Math.max(actualPct, 0), 100);
  const isOver = actualPct > 100;

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div
        className={`h-full rounded-full ${isOver ? "bg-red-500" : "bg-brand"}`}
        style={{ width: `${fillWidth}%` }}
      />
    </div>
  );
}
