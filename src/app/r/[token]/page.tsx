import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { todayUTC } from "@/lib/today";
import { resolveClientIdFromShareSlug, resolveClientIdFromShareToken, resolvePublicShareLinkBaseUrl } from "@/lib/report-share-links";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCockpitViewModel } from "@/lib/cockpit-view-data";
import { CockpitView } from "@/app/clients/cockpit-view";
import { WorkspaceContainer } from "@/app/clients/workspace-container";
import { formatReportPeriodLabel, resolveReportShareClientName, resolveReportShareDefaultPeriod } from "./report-share-metadata";

const REPORT_SHARE_TITLE = "Dashboard de Performance";
const REPORT_SHARE_DESCRIPTION_FALLBACK = "Acompanhe os resultados, investimento e principais indicadores da campanha.";

/**
 * Etapa "OG Metadata do Link Compartilhado": título/descrição/Open
 * Graph/Twitter Card do link enviado ao cliente — hoje o WhatsApp/Google
 * Chat mostravam a identidade genérica da plataforma (`app/layout.tsx`:
 * "Mitza"). NUNCA a pipeline pesada do Cockpit (`buildCockpitViewModel`),
 * só o nome do cliente (`resolveReportShareClientName`, mesma resolução de
 * sempre por token — nunca `clientId` cru, nunca métrica) + o período padrão
 * ("this_month", `resolveReportShareDefaultPeriod`). Token inválido/revogado/
 * cliente excluído cai no MESMO fallback genérico que um token válido sem
 * nome resolvido — nunca revela pelo metadata se um token é ou não válido
 * (a página em si continua decidindo 404 normalmente na renderização).
 * `metadataBase` resolvido aqui (nunca em `app/layout.tsx`, que fica intocado)
 * via `resolvePublicShareLinkBaseUrl` — a MESMA função que já monta a URL
 * pública do link no painel administrativo, garantindo o domínio de
 * produção real (`VERCEL_PROJECT_PRODUCTION_URL`) mesmo sob a proteção de
 * deployment da Vercel. A imagem (`og:image`/`twitter:image`) vem sozinha da
 * convenção de arquivo colocada ao lado (`opengraph-image.tsx`), nunca
 * declarada aqui.
 *
 * Etapa "White label no link público": título/descrição/imagem nunca
 * mencionam "KOFF" — o link é enviado em nome do cliente final da agência,
 * que pode não querer a marca da agência aparecendo no preview (pedido
 * explícito). `siteName` foi removido do openGraph pelo mesmo motivo (não
 * existe um nome neutro pra colocar no lugar sem reintroduzir uma marca).
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const baseUrl = resolvePublicShareLinkBaseUrl();
  const canonicalUrl = `${baseUrl}/r/${token}`;

  const clientName = await resolveReportShareClientName(token);
  const description = clientName
    ? `${clientName} · ${formatReportPeriodLabel(resolveReportShareDefaultPeriod())} — ${REPORT_SHARE_DESCRIPTION_FALLBACK}`
    : REPORT_SHARE_DESCRIPTION_FALLBACK;

  return {
    metadataBase: new URL(baseUrl),
    title: REPORT_SHARE_TITLE,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title: REPORT_SHARE_TITLE,
      description,
      url: canonicalUrl,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: REPORT_SHARE_TITLE,
      description,
    },
  };
}

/**
 * Correção definitiva da divergência Dashboard interno × link compartilhado
 * (pedido explícito do usuário): até esta correção, esta rota renderizava o
 * Relatório de Performance — uma implementação visual inteiramente
 * separada do Cockpit (`/clients/[id]`), nunca atualizada quando o Cockpit
 * foi redesenhado. Agora renderiza o MESMO `<CockpitView>` da agência,
 * alimentado por `buildCockpitViewModel(..., {viewer:{kind:"shared"}})` —
 * nunca uma segunda implementação, nunca um cálculo próprio desta rota.
 *
 * `client_id` NUNCA vem de query param nem de qualquer entrada do
 * visitante: a única fonte de verdade é `resolveClientIdFromShareSlug`
 * (Etapa "Link legível por cliente", tentada PRIMEIRO) ou
 * `resolveClientIdFromShareToken` (fallback — links gerados antes dessa
 * etapa, sem slug), ambas resolvidas no servidor contra
 * `report_share_links` (identificador inexistente, revogado, OU cliente já
 * excluído → `null`, tratado aqui como 404 comum, sem distinguir qual dos
 * casos aconteceu — comportamento neutro, intocado por esta correção).
 *
 * Segurança no servidor (nunca só esconder botão): `buildCockpitViewModel`
 * com `viewer.kind === "shared"` nunca CALCULA os campos administrativos
 * (edição de metas/orçamento, saldo da conta Meta, links pra rotas
 * autenticadas como `/metas` ou `/edit`) — eles chegam `null`/`false` na
 * origem, nunca apenas ocultos na view (ver `lib/cockpit-view-data.ts`).
 * `createAdminClient()` continua sendo o ÚNICO client usado aqui (sem
 * sessão pra amarrar RLS) — seguro porque toda consulta dentro da camada
 * do Cockpit já filtra por `clientId` explícito, e esse `clientId` só
 * chega até aqui depois de já resolvido pelo token.
 *
 * Sem navegação interna nenhuma — a página raiz (`app/layout.tsx`) só
 * embrulha em `AppShell` quando há sessão, e um visitante deste link nunca
 * tem uma.
 */
export default async function PublicClientDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ month?: string; filtro?: string; modo?: string }>;
}) {
  const { token } = await params;
  const clientId = (await resolveClientIdFromShareSlug(token)) ?? (await resolveClientIdFromShareToken(token));
  if (!clientId) notFound();

  const { month: monthQueryParam, filtro: filterTextParam, modo: filterModeParam } = await searchParams;

  const supabase = createAdminClient();
  const model = await buildCockpitViewModel(supabase, clientId, {
    monthQueryParam,
    filterTextParam,
    filterModeParam,
    viewer: { kind: "shared" },
    basePath: `/r/${token}`,
  });

  return (
    <WorkspaceContainer>
      <CockpitView model={model} today={todayUTC()} />
    </WorkspaceContainer>
  );
}
