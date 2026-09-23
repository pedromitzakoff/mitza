import Link from "next/link";
import type { AnalyticsPeriodPreset } from "@/lib/analytics";
import type { ReportView } from "@/lib/report-view-classification";
import { buildReportViewHref } from "./report-period-nav";

/**
 * Seletor "Resultados principais" / "Objetivos secundários" (Etapa
 * "Separar o Relatório por finalidade das campanhas") — navegação pura via
 * URL (mesmo padrão de `ReportPeriodControl`: a URL é a fonte de verdade,
 * nunca um estado de cliente paralelo), preserva o período atual em
 * exibição. Só renderizado por `page.tsx` quando `hasSecondaryCampaigns` é
 * verdadeiro — cliente que nunca classificou nenhuma campanha numa
 * finalidade secundária nunca vê este seletor (Relatório continua
 * exatamente como sempre foi).
 */
export function ReportViewToggle({
  basePath,
  activePreset,
  period,
  view,
}: {
  basePath: string;
  activePreset: AnalyticsPeriodPreset;
  period: { start: string; end: string };
  view: ReportView;
}) {
  const custom = activePreset === "custom" ? period : undefined;

  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-full border border-[#D9D3C9] bg-white p-1 text-xs font-semibold">
      <Link
        href={buildReportViewHref(basePath, "principal", activePreset, custom)}
        className={`rounded-full px-3 py-1.5 ${view === "principal" ? "bg-[#17171A] text-white" : "text-[#6F6B65] hover:text-[#17171A]"}`}
      >
        Resultados principais
      </Link>
      <Link
        href={buildReportViewHref(basePath, "secundario", activePreset, custom)}
        className={`rounded-full px-3 py-1.5 ${view === "secundario" ? "bg-[#17171A] text-white" : "text-[#6F6B65] hover:text-[#17171A]"}`}
      >
        Objetivos secundários
      </Link>
    </div>
  );
}
