import { todayUTC } from "@/lib/today";
import { loadCockpitExplorationPageData } from "@/lib/cockpit-exploration-page-data";
import { MonthSelect } from "../../month-select";
import { IconButton } from "@/components/workspace/button";
import { WorkspaceContainer } from "../../workspace-container";
import { CockpitGlobalFilterBar } from "../../cockpit-global-filter-bar";
import { CockpitAdExplorationSection } from "../../cockpit-ad-exploration-section";

/**
 * KOFF Analytics — "Adaptar o sistema" (pedido explícito do usuário): a aba
 * "Campanhas" da Exploração vira página própria, alcançável pelo menu
 * lateral do cliente — mesma lógica/dado de sempre
 * (`loadCockpitExplorationPageData`, Camada 1 oficial do Relatório), só
 * numa rota dedicada em vez de uma aba dentro do Cockpit.
 */
export default async function ClientCampanhasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; filtro?: string; modo?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const today = todayUTC();

  const data = await loadCockpitExplorationPageData(id, "/campanhas", resolvedSearchParams);

  return (
    <WorkspaceContainer>
      <div className="mt-2 flex flex-wrap items-center gap-2 border-b border-overview-border pb-3 text-sm">
        <div className="flex items-center gap-0.5">
          <IconButton href={data.prevMonthHref} aria-label="Mês anterior" variant="ghost" size="sm">
            &lsaquo;
          </IconButton>
          <MonthSelect today={today} selectedMonthParam={data.monthParam} buildHref={(month) => `/clients/${id}/campanhas?month=${month}`} />
          <IconButton href={data.nextMonthHref} aria-label="Próximo mês" variant="ghost" size="sm">
            &rsaquo;
          </IconButton>
        </div>
      </div>

      <h1 className="mt-6 text-base font-medium text-overview-text-primary">Campanhas</h1>

      <div className="mt-3">
        <CockpitGlobalFilterBar initialText={data.cockpitFilter.text} initialMode={data.cockpitFilter.mode} />
      </div>

      {data.hasMetaChannel ? (
        <div className="mt-4">
          <CockpitAdExplorationSection
            clientId={data.clientId}
            resultType={data.resultType}
            campaigns={data.campaigns}
            adSetDailyRows={data.adSetDailyRows}
            creativeDailyRows={data.creativeDailyRows}
            initialLevel="campaigns"
          />
        </div>
      ) : (
        <p className="mt-4 text-sm text-overview-text-secondary">Este cliente não tem o canal Meta Ads habilitado.</p>
      )}
    </WorkspaceContainer>
  );
}
