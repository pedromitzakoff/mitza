import { EmptyState } from "@/components/ui/empty-state";
import type { ReportViewData } from "../reports/report-data";
import { ClientReportView } from "../reports/report-view";
import { ClientReportsView } from "./client-reports-view";
import type { ClientReportSummary } from "./client-report-data";

/**
 * Seção "Ações" do hub de Analytics — fusão dos dois conceitos que antes
 * viviam em áreas separadas (pedido explícito do usuário): a antiga aba
 * "Relatórios" (pendências com responsável agência/cliente/terceiro, linha
 * do tempo de eventos curados, fechar/reabrir o mês — `ClientReportView`,
 * inalterado) e o histórico do módulo `client_reports` (relatório de
 * WhatsApp/PDF enviado ao cliente — `ClientReportsView`, inalterado). O
 * `client_reports` deixou de ser área própria da plataforma: aqui ele
 * aparece só como histórico, e a ação de gerar um novo relatório vive no
 * cabeçalho do hub ("Gerar relatório"), não duplicada aqui.
 *
 * Nenhuma lógica nova — ambos os componentes são exatamente os mesmos já
 * validados, só reposicionados dentro do hub em vez de abas próprias.
 */
export function AnalyticsActionsSection({
  clientId,
  month,
  reportData,
  isAdmin,
  responsibleOptions,
  today,
  reportHistory,
  newReportHref,
  buildReportDetailHref,
}: {
  clientId: string;
  month: string | undefined;
  reportData: ReportViewData | null;
  isAdmin: boolean;
  responsibleOptions: { id: string; name: string }[];
  today: Date;
  reportHistory: ClientReportSummary[];
  newReportHref: string;
  buildReportDetailHref: (reportId: string) => string;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pendências e linha do tempo</h2>
        {reportData ? (
          <ClientReportView
            clientId={clientId}
            month={month}
            data={reportData}
            isAdmin={isAdmin}
            responsibleOptions={responsibleOptions}
            today={today}
          />
        ) : (
          <EmptyState>Não foi possível carregar o relatório deste cliente.</EmptyState>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Relatório enviado ao cliente</h2>
        <ClientReportsView history={reportHistory} newReportHref={newReportHref} buildReportHref={buildReportDetailHref} />
      </section>
    </div>
  );
}
