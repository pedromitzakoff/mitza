/**
 * Barra de investimento do novo Design System (Etapa 47) — variante nova,
 * deliberadamente separada de `AgencyInvestmentBar` (`app/agency-
 * investment-bar.tsx`), que continua servindo Sprints e Relatórios sem
 * nenhuma mudança visual: essa é a regra da rodada (só migrar componente
 * compartilhado sem criar variante quando a mudança não afeta outras
 * telas — aqui afetaria, então virou uma variante). Track neutro mais
 * fino, preenchimento azul, marcador como um handle circular (não um
 * traço quase invisível) com tooltip nativo.
 */
export function ProgressBar({
  planned,
  actual,
  expectedToDate,
}: {
  planned: number;
  actual: number;
  expectedToDate: number;
}) {
  if (planned <= 0) {
    return <div className="h-2 w-full rounded-full bg-overview-surface-subtle" />;
  }

  const actualPct = (actual / planned) * 100;
  const expectedPct = (expectedToDate / planned) * 100;
  const fillWidth = Math.min(Math.max(actualPct, 0), 100);
  const markerPos = Math.min(Math.max(expectedPct, 2), 98);
  const isOver = actualPct > 100;

  return (
    <div className="relative h-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-overview-surface-subtle">
        <div
          className={`h-full rounded-full transition-[width] duration-200 ease-out ${isOver ? "bg-overview-danger" : "bg-brand"}`}
          style={{ width: `${fillWidth}%` }}
        />
      </div>
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-help rounded-full border-2 border-overview-surface bg-navy shadow-[var(--shadow-float)] transition-[left] duration-200 ease-out"
        style={{ left: `${markerPos}%` }}
        title={`Esperado até hoje: ${Math.round(expectedPct)}%`}
      />
    </div>
  );
}
