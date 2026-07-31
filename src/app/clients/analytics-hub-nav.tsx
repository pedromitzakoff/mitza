import Link from "next/link";

export type AnalyticsHubSection = "resumo" | "criativos" | "campanhas" | "acoes" | "insights";

const HUB_SECTIONS: { key: AnalyticsHubSection; label: string }[] = [
  { key: "resumo", label: "Resumo" },
  { key: "criativos", label: "Criativos" },
  { key: "campanhas", label: "Campanhas" },
  { key: "acoes", label: "Ações" },
  { key: "insights", label: "Insights" },
];

/**
 * Sub-navegação do hub de Analytics — mesmo padrão visual das abas
 * principais (`AREA_TABS`), só um nível abaixo (texto menor, sem a borda
 * inferior cheia da página) pra deixar clara a hierarquia: isso é uma
 * seção DENTRO de Analytics, nunca uma aba irmã de Visão Geral/Timeline.
 */
export function AnalyticsHubNav({ baseHref, activeSection }: { baseHref: string; activeSection: AnalyticsHubSection }) {
  return (
    <div className="mb-6 flex items-center gap-5 border-b border-border text-sm">
      {HUB_SECTIONS.map((section) => (
        <Link
          key={section.key}
          href={`${baseHref}&analyticsSection=${section.key}`}
          scroll={false}
          role="tab"
          aria-selected={section.key === activeSection}
          className={`-mb-px shrink-0 border-b-2 pb-2 font-medium transition-colors ${
            section.key === activeSection
              ? "border-brand text-brand"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {section.label}
        </Link>
      ))}
    </div>
  );
}
