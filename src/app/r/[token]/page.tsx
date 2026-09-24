import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { todayDateString } from "@/lib/today";
import { resolveAnalyticsPeriod, type AnalyticsPeriodPreset } from "@/lib/analytics";
import { buildPerformanceReportData, GENERAL_REPORT_VIEW } from "@/lib/performance-report/report-data";
import { buildPerformanceReportDocument } from "@/lib/performance-report/report-document";
import { resolveClientIdFromShareToken, resolvePublicShareLinkBaseUrl } from "@/lib/report-share-links";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReportPeriodControl } from "@/app/clients/[id]/relatorio/report-period-control";
import { ReportBody } from "@/app/clients/[id]/relatorio/report-body";
import { ReportHeader } from "@/app/clients/[id]/relatorio/report-header";
import { formatReportPeriodLabel, resolveReportShareClientName, resolveReportShareDefaultPeriod } from "./report-share-metadata";

const REPORT_SHARE_TITLE = "Relatório de Performance";
const REPORT_SHARE_DESCRIPTION_FALLBACK = "Acompanhe os resultados, investimento e principais indicadores da campanha.";

/**
 * Etapa "OG Metadata do Relatório Público": título/descrição/Open
 * Graph/Twitter Card do link enviado ao cliente — hoje o WhatsApp/Google
 * Chat mostravam a identidade genérica da plataforma (`app/layout.tsx`:
 * "Mitza"). NUNCA a pipeline pesada do relatório (`buildPerformanceReportData`),
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
 * Etapa "Link Externo V1" — Performance Report somente leitura, sem login,
 * para envio direto ao cliente (`/r/[token]`). O `client_id` NUNCA vem de
 * query param nem de qualquer entrada do visitante: a única fonte de
 * verdade é `resolveClientIdFromShareToken`, que resolve o token no
 * servidor contra `report_share_links` (token inexistente, revogado, OU
 * cliente já excluído → `null`, tratado aqui como 404 comum, sem distinguir
 * qual dos três casos aconteceu — comportamento neutro).
 *
 * Reaproveita 100% a Camada 1/2 já existente (`buildPerformanceReportData` →
 * `buildPerformanceReportDocument`, as MESMAS que alimentam
 * `/clients/[id]/relatorio` e o PDF) e o MESMO corpo visual (`ReportBody`) —
 * nenhum cálculo, query ou componente próprio desta rota. A única diferença
 * é o client Supabase: aqui é sempre `createAdminClient()` (sem sessão pra
 * amarrar RLS), seguro porque toda consulta dentro dessa camada já filtra
 * por `clientId` explícito (auditado antes de implementar esta rota) — o
 * `clientId` em si só chega até aqui depois de já resolvido pelo token.
 *
 * Sem "Baixar PDF" (fora de escopo desta V1) e sem qualquer navegação
 * interna — a página raiz (`app/layout.tsx`) só embrulha em `AppShell`
 * quando há sessão, e um visitante deste link nunca tem uma.
 */
export default async function PublicPerformanceReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ analyticsPreset?: string; analyticsStart?: string; analyticsEnd?: string }>;
}) {
  const { token } = await params;
  const clientId = await resolveClientIdFromShareToken(token);
  if (!clientId) notFound();

  const { analyticsPreset: presetParam, analyticsStart: startParam, analyticsEnd: endParam } = await searchParams;

  const supabase = createAdminClient();
  const today = todayDateString();
  const activePreset = (presetParam ?? "this_month") as AnalyticsPeriodPreset;
  const period = resolveAnalyticsPeriod(presetParam, today, { start: startParam, end: endParam });

  const data = await buildPerformanceReportData(supabase, clientId, period);
  const document = buildPerformanceReportDocument(data);

  return (
    <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
      <ReportHeader
        clientName={document.clientName}
        periodControl={
          <ReportPeriodControl
            basePath={`/r/${token}`}
            activePreset={activePreset}
            customStart={period.start}
            customEnd={period.end}
            today={today}
            view={GENERAL_REPORT_VIEW}
          />
        }
      />

      <ReportBody document={document} />
    </div>
  );
}
