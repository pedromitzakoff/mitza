import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { todayDateString } from "@/lib/today";
import { resolveAnalyticsPeriod, type AnalyticsPeriodPreset } from "@/lib/analytics";
import { buildPerformanceReportData } from "@/lib/performance-report/report-data";
import { buildPerformanceReportDocument } from "@/lib/performance-report/report-document";
import { getReportShareLinkStatus } from "@/lib/report-share-links";
import { fetchClientFunnels, listCampaignsForFunnelClassification } from "@/lib/client-funnels-data";
import { defaultReportPeriod } from "@/lib/client-reports";
import { fetchClientReportDetail } from "../../client-report-data";
import { ClientReportWizard } from "../../client-report-wizard";
import { FunnelsSection } from "../../funnels-section";
import { Section } from "../../section";
import { ReportPeriodControl } from "./report-period-control";
import { buildReportPdfHref } from "./report-period-nav";
import { ReportBody } from "./report-body";
import { ReportHeader } from "./report-header";
import { CopyReportLinkButton } from "./copy-report-link-button";
import { ReportFunnelSelector } from "./report-funnel-selector";

/**
 * Etapa "Relatório Nativo": "Cliente → Relatório → relatório" — esta rota É
 * o Relatório de Performance, sempre carregado com dados (padrão: mês
 * atual, sem nenhuma ação prévia), nunca mais uma tela intermediária de
 * seleção de período que só depois abre um HTML separado. O período
 * personalizado/preset em exibição é 100% derivado da URL
 * (`analyticsPreset`/`analyticsStart`/`analyticsEnd`, resolvidos por
 * `resolveAnalyticsPeriod` — mesma função de sempre, nenhuma segunda
 * semântica de data) — refresh/back/forward sempre reproduzem exatamente o
 * mesmo período.
 *
 * Reaproveita 100% a Camada 1/2 já existente (`buildPerformanceReportData`
 * → `buildPerformanceReportDocument`) — a MESMA que alimenta o PDF (rota
 * `/api/clients/[id]/performance-report`, ver `renderers/pdf-renderer.ts`):
 * nenhum cálculo de investimento/CPA/ROAS/resultado é refeito aqui, os
 * componentes desta página só apresentam o `PerformanceReportDocument` já
 * pronto. Uma única consulta a cada troca de período (Server Component
 * refaz o fetch só quando a URL muda); sorting e "ver todos" das tabelas
 * são estado 100% client-side sobre as linhas já buscadas, nunca um
 * refetch.
 */
export default async function ClientPerformanceReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    analyticsPreset?: string;
    analyticsStart?: string;
    analyticsEnd?: string;
    view?: string;
    clientReport?: string;
    reportRecurringTaskId?: string;
    reportPeriodStart?: string;
    reportPeriodEnd?: string;
  }>;
}) {
  const { id } = await params;
  const {
    analyticsPreset: presetParam,
    analyticsStart: startParam,
    analyticsEnd: endParam,
    view: viewParam,
    clientReport: clientReportParam,
    reportRecurringTaskId,
    reportPeriodStart: reportPeriodStartParam,
    reportPeriodEnd: reportPeriodEndParam,
  } = await searchParams;
  const profile = await getCurrentProfile();
  const isAdmin = profile?.role === "admin";
  const supabase = await createSupabaseClient();

  // Mesmo critério de RLS + 404 silencioso de `clients/[id]/page.tsx` — só a
  // existência é confirmada aqui; todo o resto do dado vem de
  // `buildPerformanceReportData`, que já reaproveita seu próprio acesso a
  // `clients` (Camada 1, inalterada).
  const { data: client, error } = await supabase.from("clients").select("id, name").eq("id", id).is("deleted_at", null).single();
  if (error) console.error(`[ClientPerformanceReportPage] falha ao buscar cliente ${id}:`, error);
  if (!client) notFound();

  const today = todayDateString();
  const activePreset = (presetParam ?? "this_month") as AnalyticsPeriodPreset;
  const period = resolveAnalyticsPeriod(presetParam, today, { start: startParam, end: endParam });

  // `buildPerformanceReportData` já carrega os funis do cliente pra resolver
  // `viewParam` (um id de funil desativado/removido cai em "geral" sem
  // quebrar) — nenhuma segunda consulta de funis aqui.
  const data = await buildPerformanceReportData(supabase, id, period, viewParam);
  const document = buildPerformanceReportDocument(data);
  const view = document.view;

  const pdfHref = buildReportPdfHref(client.id, activePreset, { start: period.start, end: period.end });

  // Etapa "Copiar link do cliente no Relatório": mesma infra do link
  // público de sempre (`lib/report-share-links.ts`) — nenhuma segunda fonte
  // de status; `getReportShareLinkStatus` não é admin-only em si (só
  // geração/revogação são), então qualquer gestor com acesso a este
  // relatório também vê/copia um link já ativo.
  const reportShareLinkStatus = await getReportShareLinkStatus(id);

  const basePath = `/clients/${client.id}/relatorio`;
  const returnTo = basePath;

  // Funis (Etapa "MITZA — Reformulação Estrutural", decisão 5 do usuário:
  // "Funis fica em Configurações? NÃO — fica em Performance, é
  // principalmente uma dimensão estratégica de leitura de performance").
  // Independente do período selecionado no Relatório (cadastro/classificação
  // do cliente, não um recorte de data) — mesma consulta de sempre.
  const [clientFunnels, funnelClassificationCampaigns] = await Promise.all([
    fetchClientFunnels(supabase, id),
    listCampaignsForFunnelClassification(supabase, id, today),
  ]);

  // Assistente de Relatório ("Reportar cliente", decisão 5: fica em
  // Performance — "transforma os dados/resultados em comunicação para o
  // cliente"). Entrada só pelo drawer de recorrência em Operação/`/sprints`
  // (`?clientReport=new&reportRecurringTaskId=...`) — nenhum botão solto
  // aqui ainda (mesmo comportamento de sempre, só a rota mudou).
  const isNewClientReport = clientReportParam === "new";
  const clientReportDetail = clientReportParam && !isNewClientReport ? await fetchClientReportDetail(supabase, id, clientReportParam) : null;
  const suggestedReportPeriod =
    reportPeriodStartParam && reportPeriodEndParam ? { start: reportPeriodStartParam, end: reportPeriodEndParam } : defaultReportPeriod(today);

  return (
    <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
      {/* Identidade visual do Relatório de Performance aprovada anteriormente
          (paleta fixa creme/areia/grafite/branco/verde-limão) — preservada
          tal como no HTML/PDF, só sem os elementos exclusivos de documento
          (hero/marca/nav sticky/impressão): dentro da aplicação, o cabeçalho
          abaixo já cumpre esse papel. Corpo compartilhado com `/r/[token]`
          (Etapa "Link Externo V1") via `ReportBody`, nunca duplicado. */}
      <ReportHeader
        clientName={client.name}
        backHref={`/clients/${client.id}`}
        pdfHref={pdfHref}
        clearsMobileMenuButton
        periodControl={
          <ReportPeriodControl basePath={basePath} activePreset={activePreset} customStart={period.start} customEnd={period.end} today={today} view={view} />
        }
        copyLinkControl={<CopyReportLinkButton clientId={client.id} initialUrl={reportShareLinkStatus.url} />}
      />

      <ReportBody
        document={document}
        topControls={
          document.activeFunnels.length > 0 ? (
            <ReportFunnelSelector basePath={basePath} activePreset={activePreset} period={period} view={view} funnels={document.activeFunnels} />
          ) : undefined
        }
      />

      <Section title="Funis">
        <FunnelsSection clientId={id} returnTo={returnTo} funnels={clientFunnels} campaigns={funnelClassificationCampaigns} isAdmin={isAdmin} />
      </Section>

      {isNewClientReport && (
        <ClientReportWizard
          clientId={id}
          clientName={client.name}
          closeHref={returnTo}
          initialPeriodStart={suggestedReportPeriod.start}
          initialPeriodEnd={suggestedReportPeriod.end}
          recurringTaskId={reportRecurringTaskId ?? null}
        />
      )}

      {clientReportDetail && (
        <ClientReportWizard
          clientId={id}
          clientName={client.name}
          closeHref={returnTo}
          reportId={clientReportDetail.id}
          initialPeriodStart={clientReportDetail.periodStart}
          initialPeriodEnd={clientReportDetail.periodEnd}
          initialMetrics={clientReportDetail.metrics}
          initialObservations={clientReportDetail.observations}
          initialStatus={clientReportDetail.status}
          initialSentAt={clientReportDetail.sentAt}
          initialSentByName={clientReportDetail.sentByName}
        />
      )}
    </div>
  );
}
