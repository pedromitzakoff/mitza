import { notFound } from "next/navigation";
import { todayDateString } from "@/lib/today";
import { resolveAnalyticsPeriod, type AnalyticsPeriodPreset } from "@/lib/analytics";
import { buildPerformanceReportData } from "@/lib/performance-report/report-data";
import { buildPerformanceReportDocument } from "@/lib/performance-report/report-document";
import { resolveClientIdFromShareToken } from "@/lib/report-share-links";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReportPeriodControl } from "@/app/clients/[id]/relatorio/report-period-control";
import { ReportBody } from "@/app/clients/[id]/relatorio/report-body";

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
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-overview-text-primary">Relatório de Performance</h1>
        <ReportPeriodControl
          basePath={`/r/${token}`}
          activePreset={activePreset}
          customStart={period.start}
          customEnd={period.end}
          today={today}
        />
      </div>

      <ReportBody document={document} />
    </div>
  );
}
