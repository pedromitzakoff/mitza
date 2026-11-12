import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayUTC } from "@/lib/today";
import { ScrollRestoreOnMount } from "@/lib/scroll-restore";
import { ClientWorkspaceContext } from "../client-workspace-context";
import { WorkspaceContainer } from "../workspace-container";
import { CockpitView } from "../cockpit-view";
import { buildCockpitViewModel, type CockpitBanner } from "@/lib/cockpit-view-data";

export { resolveSelectedGoal, findChannelDataIssue } from "@/lib/cockpit-view-data";

/**
 * Monta a URL de um dos 3 dropdowns de contexto (Mês/Meta-Planejamento/
 * Canal) — núcleo puro, reaproveitado sem mudança desde antes da correção
 * da divergência Dashboard × link compartilhado. Continua exportado e
 * testado (`scripts/test-mitza-one-fase1-cockpit.ts`) mesmo não sendo mais
 * chamado diretamente por esta página (a navegação de mês do Cockpit agora
 * usa `buildCockpitMonthHref`, compartilhada com `/r/[token]`).
 */
export function buildClientContextHref(
  clientId: string,
  current: { month?: string; metricsChannel?: string; goal?: string },
  overrides: { month?: string; metricsChannel?: string | null; goal?: string | null },
): string {
  const params = new URLSearchParams();
  const monthValue = overrides.month ?? current.month;
  if (monthValue) params.set("month", monthValue);
  const channelValue = overrides.metricsChannel !== undefined ? overrides.metricsChannel : current.metricsChannel;
  if (channelValue) params.set("metricsChannel", channelValue);
  const goalValue = overrides.goal !== undefined ? overrides.goal : current.goal;
  if (goalValue) params.set("goal", goalValue);
  const qs = params.toString();
  return `/clients/${clientId}${qs ? `?${qs}` : ""}`;
}

/**
 * `/clients/[id]` — Cockpit Único do Cliente, visão da AGÊNCIA. Correção
 * definitiva da divergência Dashboard interno × link compartilhado (pedido
 * explícito do usuário): esta página virou um wrapper fino — auth +
 * parsing de `searchParams` + `buildCockpitViewModel(..., {viewer:
 * {kind:"agency", isAdmin}})` + `<CockpitView>`. Todo o cálculo (sprints,
 * metas, evolução, exploração de anúncios) mora em
 * `lib/cockpit-view-data.ts`, a MESMA função que `/r/[token]/page.tsx`
 * chama com `{kind:"shared"}` — nunca uma segunda implementação do
 * Dashboard. `ScrollRestoreOnMount`/`ClientWorkspaceContext` ficam só aqui
 * (concerns do workspace autenticado — Sidebar/scroll — que não existem no
 * link público, nunca renderizado dentro do `AppShell`).
 */
export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    synced?: string;
    saved?: string;
    month?: string;
    filtro?: string;
    modo?: string;
  }>;
}) {
  const { id } = await params;
  const { error, synced, saved, month: monthQueryParam, filtro: filterTextParam, modo: filterModeParam } = await searchParams;

  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  const supabase = await createSupabaseClient();

  const maybeBanners: (CockpitBanner | null)[] = [
    error ? { tone: "red", text: error } : null,
    synced ? { tone: "green", text: `${synced} dia(s) de spend sincronizado(s) com o Meta.` } : null,
    saved ? { tone: "green", text: "Dados do cliente atualizados." } : null,
  ];
  const extraBanners = maybeBanners.filter((banner): banner is CockpitBanner => banner !== null);

  const model = await buildCockpitViewModel(supabase, id, {
    monthQueryParam,
    filterTextParam,
    filterModeParam,
    viewer: { kind: "agency", isAdmin },
    basePath: `/clients/${id}`,
    extraBanners,
  });

  return (
    <WorkspaceContainer>
      <ScrollRestoreOnMount />
      <ClientWorkspaceContext name={model.clientName} />
      <CockpitView model={model} today={todayUTC()} />
    </WorkspaceContainer>
  );
}
