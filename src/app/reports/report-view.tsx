import { formatShortDate } from "@/lib/format";
import { monthRangeFromParam, shiftMonthParam } from "@/lib/sprint-financials";
import {
  MONTHLY_REPORT_STATUS_BADGE_CLASSES,
  MONTHLY_REPORT_STATUS_LABEL,
} from "@/lib/monthly-reports";
import { contractStatusBannerText } from "@/lib/client-fields";
import { SectionHeader } from "@/components/workspace/section-header";
import { SubmitButton } from "@/app/submit-button";
import { VisaoGeralChannelSwitch } from "@/app/clients/visao-geral-channel-switch";
import { MonthlyKpiSummary } from "@/app/clients/monthly-kpi-summary";
import type { ReportViewData } from "./report-data";
import { ReportCampaignsList } from "./report-campaigns";
import { ReportCreativesList } from "./report-creatives";
import { finalizeReportAction, reopenReportAction, updateReportStatusAction } from "./report-actions";

/**
 * Etapa "Relatório de Performance das Campanhas" → "Três níveis de
 * análise": o Relatório deixa de ser um relatório de acompanhamento
 * interno da agência (Performance/Execução da agência/Acontecimentos e
 * decisões/Análise do gestor/Pendências/Próximos passos/Comportamento por
 * sprint, além dos KPIs customizados e do resumo executivo em texto livre
 * do antigo Bloco 1 — todos removidos desta tela) e passa a responder só o
 * que um relatório de mídia responde, em leitura progressiva: Resumo do
 * período → Campanhas → Criativos — sempre respeitando o objetivo
 * estruturado do cliente (`performance_goal`) e nunca misturando Meta com
 * Google.
 *
 * "Públicos" (o nível do meio da arquitetura pedida) NÃO existe aqui —
 * auditoria confirmou que a fonte de dados não tem nenhuma dimensão de ad
 * set/audiência hoje (só campanha e criativo); ver resumo entregue ao
 * usuário nesta etapa.
 *
 * "Status do relatório" (não iniciado/em andamento/pronto para revisão/
 * finalizado) É MANTIDO — não é execução operacional, é workflow de
 * aprovação, e a lista `/reports` (todos os clientes) depende do status
 * pra sua própria coluna/contagem (`src/app/reports/page.tsx`). As tabelas/
 * Server Actions dos blocos removidos (KPIs, timeline, pendências) não
 * foram apagadas — só pararam de ter um chamador nesta tela; nenhuma tem
 * outro consumidor hoje, mas remover de verdade é uma limpeza separada,
 * fora do escopo desta rodada ("não apagar regras/tabelas/dados").
 */
export function ClientReportView({
  clientId,
  month,
  data,
  isAdmin,
  error,
  today,
}: {
  clientId: string;
  month: string | undefined;
  data: ReportViewData;
  isAdmin: boolean;
  error?: string;
  today: Date;
}) {
  const isReadOnly = data.status === "finalizado";
  const contractBannerText = contractStatusBannerText(data.clientContractStatus);

  // `baseHref` sempre com `?month=` explícito (mesmo pro mês corrente) —
  // `VisaoGeralChannelSwitch` só sabe ANEXAR `&metricsChannel=`, nunca
  // inicia a querystring sozinho (mesmo contrato já usado pela Visão Geral
  // do cliente, `metricsChannelBaseHref` em `clients/[id]/page.tsx`).
  const monthRange = monthRangeFromParam(month, today);
  const channelBaseHref = `/reports/${clientId}?month=${shiftMonthParam(monthRange, 0)}`;

  return (
    <>
      {contractBannerText && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {contractBannerText} A página continua acessível apenas para consulta de histórico.
        </p>
      )}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      {data.status === "finalizado" && (
        <p className="mt-2 text-xs text-overview-text-secondary">
          Finalizado por {data.finalizedByName ?? "—"} em {data.finalizedAt ? formatShortDate(data.finalizedAt.slice(0, 10)) : "—"} —
          o resumo, as campanhas e os criativos abaixo continuam ao vivo (histórico de mídia de um mês encerrado não muda).
        </p>
      )}

      <div className="mt-5">
        <VisaoGeralChannelSwitch baseHref={channelBaseHref} active={data.channelScope} options={data.channelScopeOptions} />
      </div>

      <div className="mt-4">
        <SectionHeader title="Resumo do período" accent />
        <div className="mt-3">
          <MonthlyKpiSummary
            monthActual={data.scopedInvestment}
            performanceGoal={data.performanceGoal}
            performanceSummary={data.performanceSummary}
            targetCostPerResult={data.targetCostPerResult}
            configureObjectiveHref={`/clients/${clientId}/edit`}
          />
        </div>
      </div>

      <div className="mt-8 border-t border-overview-border pt-6">
        <SectionHeader title={`Campanhas · ${data.campaigns.length}`} accent />
        <div className="mt-3">
          <ReportCampaignsList summaries={data.campaigns} channelScope={data.channelScope} />
        </div>
      </div>

      {/* "Públicos" (conjunto de anúncios/audiência) NÃO existe nesta
          rodada — auditoria não encontrou nenhuma dimensão de ad
          set/audiência na fonte de dados (só `campaign_daily_metrics` e
          `ad_creative_daily_metrics`, nenhuma das duas tem essa coluna).
          Renderizar uma seção vazia/fabricada violaria o pedido explícito
          de nunca inventar informação que a fonte não suporta — ver
          resumo entregue ao usuário. */}

      <div className="mt-8 border-t border-overview-border pt-6">
        <SectionHeader title={data.channelScope === "google" ? "Criativos" : `Criativos · ${data.creatives.length}`} accent />
        <div className="mt-3">
          <ReportCreativesList summaries={data.creatives} channelScope={data.channelScope} />
        </div>
      </div>

      <div className="mt-8 border-t border-overview-border pt-6">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Status do relatório</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${MONTHLY_REPORT_STATUS_BADGE_CLASSES[data.status]}`}>
            {MONTHLY_REPORT_STATUS_LABEL[data.status]}
          </span>

          {!isReadOnly && (
            <form action={updateReportStatusAction.bind(null, clientId, data.monthStart)} className="flex items-center gap-2">
              <select
                name="status"
                defaultValue={data.status}
                className="rounded-md border border-overview-border bg-overview-surface px-2 py-1 text-sm text-overview-text-primary"
              >
                <option value="nao_iniciado">Não iniciado</option>
                <option value="em_andamento">Em andamento</option>
                <option value="pronto_revisao">Pronto para revisão</option>
              </select>
              <SubmitButton
                className="rounded-md border border-overview-border px-2 py-1 text-xs font-medium text-overview-text-primary hover:bg-overview-surface-hover"
                pendingChildren="Salvando..."
              >
                Salvar
              </SubmitButton>
            </form>
          )}

          {isAdmin && data.status === "pronto_revisao" && (
            <form action={finalizeReportAction.bind(null, clientId, data.monthStart)}>
              <SubmitButton className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover" pendingChildren="Finalizando...">
                Finalizar relatório
              </SubmitButton>
            </form>
          )}

          {isAdmin && data.status === "finalizado" && (
            <form action={reopenReportAction.bind(null, clientId, data.monthStart)}>
              <SubmitButton
                className="rounded-md border border-overview-border px-3 py-1.5 text-xs font-medium text-overview-text-primary hover:bg-overview-surface-hover"
                pendingChildren="Reabrindo..."
              >
                Reabrir relatório
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
