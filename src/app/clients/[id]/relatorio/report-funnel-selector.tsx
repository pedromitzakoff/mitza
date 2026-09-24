import Link from "next/link";
import type { AnalyticsPeriodPreset } from "@/lib/analytics";
import { GENERAL_REPORT_VIEW, type ReportView } from "@/lib/performance-report/report-data";
import { buildReportViewHref } from "./report-period-nav";

/**
 * Seletor "Visão geral" / "Visão por funil" (Etapa "Gestão de Funis
 * Estratégicos por Cliente" — substitui o antigo toggle binário "Resultados
 * principais"/"Objetivos secundários"). Navegação pura via URL (mesmo padrão
 * de `ReportPeriodControl`), preserva o período atual em exibição. Só
 * renderizado por `page.tsx` quando `activeFunnels.length > 0` — cliente sem
 * nenhum funil configurado nunca vê este seletor (Relatório continua
 * exatamente como sempre foi).
 *
 * Um funil desativado ainda pode estar selecionado (link salvo/compartilhado
 * antes da desativação) sem aparecer na lista de opções — `currentFunnelName`
 * cobre esse caso, garantindo que o rótulo do funil atual sempre apareça
 * mesmo que ele não esteja mais entre os ativos.
 */
export function ReportFunnelSelector({
  basePath,
  activePreset,
  period,
  view,
  funnels,
  currentFunnelName,
}: {
  basePath: string;
  activePreset: AnalyticsPeriodPreset;
  period: { start: string; end: string };
  view: ReportView;
  funnels: { id: string; name: string }[];
  /** Nome do funil selecionado, quando ele não está (mais) em `funnels` —
   * `undefined` no caso comum (funil ativo, já presente na lista). */
  currentFunnelName?: string;
}) {
  const custom = activePreset === "custom" ? period : undefined;
  const options = [{ id: GENERAL_REPORT_VIEW, name: "Visão geral" }, ...funnels];
  if (view !== GENERAL_REPORT_VIEW && currentFunnelName && !funnels.some((f) => f.id === view)) {
    options.push({ id: view, name: currentFunnelName });
  }

  return (
    <div className="inline-flex w-fit max-w-full flex-wrap items-center gap-1 rounded-full border border-[#D9D3C9] bg-white p-1 text-xs font-semibold">
      {options.map((option) => (
        <Link
          key={option.id}
          href={buildReportViewHref(basePath, option.id, activePreset, custom)}
          className={`rounded-full px-3 py-1.5 ${view === option.id ? "bg-[#17171A] text-white" : "text-[#6F6B65] hover:text-[#17171A]"}`}
        >
          {option.name}
        </Link>
      ))}
    </div>
  );
}
