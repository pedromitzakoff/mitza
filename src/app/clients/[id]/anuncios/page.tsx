import { todayUTC } from "@/lib/today";
import { loadCockpitExplorationPageData } from "@/lib/cockpit-exploration-page-data";
import { PeriodRangePicker } from "../../period-range-picker";
import { WorkspaceContainer } from "../../workspace-container";
import { CockpitGlobalFilterBar } from "../../cockpit-global-filter-bar";
import { CockpitAdExplorationSection } from "../../cockpit-ad-exploration-section";

/**
 * KOFF Analytics — "Adaptar o sistema" (pedido explícito do usuário): a aba
 * "Anúncios" da Exploração vira página própria, alcançável pelo menu
 * lateral do cliente — mesma lógica/dado de sempre
 * (`loadCockpitExplorationPageData`, Camada 1 oficial do Relatório), só
 * numa rota dedicada, já abrindo direto na aba de Anúncios
 * (`initialLevel="ads"`) em vez de Campanhas.
 */
export default async function ClientAnunciosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; period?: string; start?: string; end?: string; filtro?: string; modo?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const today = todayUTC();

  const data = await loadCockpitExplorationPageData(id, "/anuncios", resolvedSearchParams);

  return (
    <WorkspaceContainer>
      <div className="mt-2 flex flex-wrap items-center gap-2 border-b border-overview-border pb-3 text-sm">
        <PeriodRangePicker basePath={data.basePath} resolved={data.periodResolved} today={today.toISOString().slice(0, 10)} />
      </div>

      <h1 className="mt-6 text-base font-medium text-overview-text-primary">Anúncios</h1>

      <div className="mt-3">
        <CockpitGlobalFilterBar initialText={data.cockpitFilter.text} initialMode={data.cockpitFilter.mode} />
      </div>

      {data.hasMetaChannel ? (
        <div className="mt-4">
          <CockpitAdExplorationSection
            clientId={data.clientId}
            campaigns={data.campaigns}
            adSetDailyRows={data.adSetDailyRows}
            creativeDailyRows={data.creativeDailyRows}
            initialLevel="ads"
          />
        </div>
      ) : (
        <p className="mt-4 text-sm text-overview-text-secondary">Este cliente não tem o canal Meta Ads habilitado.</p>
      )}
    </WorkspaceContainer>
  );
}
