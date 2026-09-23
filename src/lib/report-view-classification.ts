/**
 * Núcleo puro da Etapa "Separar o Relatório por finalidade das campanhas"
 * — sem Supabase, sem saber de onde vêm as linhas. Ver
 * `supabase/campaign-report-classifications.sql` pro porquê desta tabela
 * ser independente de `client_goals`/`client_campaign_goal_assignments`/
 * `PerformanceGoal`.
 *
 * Duas visões do Relatório, nunca uma terceira:
 *   - "principal" (leads/sales) — o Relatório de sempre, só que campanhas
 *     classificadas numa finalidade SECUNDÁRIA saem daqui.
 *   - "secundario" (awareness/reach/followers/profile_visits/traffic) —
 *     cada campanha com a métrica compatível com sua própria finalidade,
 *     nunca uma contagem de "resultado" fabricada (auditoria: nenhuma
 *     dessas finalidades tem contagem por campanha capturada hoje — só
 *     spend/impressions/reach/clicks, já existentes em todas as linhas).
 *
 * Campanha sem classificação NUNCA some: fica de fora de "secundario" e
 * continua em "principal", identificável (ver `report-document.ts`,
 * badge "Não classificada") — nunca escondida, nunca adivinhada.
 */

export type ReportCampaignPurpose = "leads" | "sales" | "awareness" | "reach" | "followers" | "profile_visits" | "traffic";
export type ReportView = "principal" | "secundario";

export interface ReportPurposeConfig {
  id: ReportCampaignPurpose;
  view: ReportView;
  label: string;
  /** Métrica de resultado mostrada pra campanhas desta finalidade dentro da
   * visão "secundario" — `null` pras duas finalidades de "principal", que
   * usam o resultado real de sempre (`resultType`/`resultCount`/`cpa`). */
  secondaryMetric: "impressions" | "reach" | "clicks" | null;
}

export const REPORT_PURPOSE_CONFIG: Record<ReportCampaignPurpose, ReportPurposeConfig> = {
  leads: { id: "leads", view: "principal", label: "Leads", secondaryMetric: null },
  sales: { id: "sales", view: "principal", label: "Vendas", secondaryMetric: null },
  awareness: { id: "awareness", view: "secundario", label: "Reconhecimento", secondaryMetric: "impressions" },
  reach: { id: "reach", view: "secundario", label: "Alcance", secondaryMetric: "reach" },
  // Seguidores: sem métrica de resultado por campanha (ver auditoria —
  // ganho de seguidores só existe no nível de conta, nunca atribuído a uma
  // campanha específica) — mostra só investimento, nunca um número
  // inventado.
  followers: { id: "followers", view: "secundario", label: "Seguidores", secondaryMetric: null },
  // Visitas ao perfil: Meta não expõe, na integração via Stract, uma coluna
  // própria dessa métrica hoje — cliques é o proxy mais próximo já
  // capturado; sinalizado como proxy em `REPORT_PURPOSE_PROXY_NOTE`, nunca
  // apresentado como se fosse exato.
  profile_visits: { id: "profile_visits", view: "secundario", label: "Visitas ao perfil", secondaryMetric: "clicks" },
  traffic: { id: "traffic", view: "secundario", label: "Tráfego", secondaryMetric: "clicks" },
};

export const REPORT_PURPOSE_OPTIONS: { value: ReportCampaignPurpose; label: string }[] = (
  Object.values(REPORT_PURPOSE_CONFIG) as ReportPurposeConfig[]
).map((c) => ({ value: c.id, label: c.label }));

/** Nota de proxy — só "Visitas ao perfil" usa uma métrica que não é
 * exatamente o que o nome diz (ver comentário da config acima). */
export const REPORT_PROFILE_VISITS_PROXY_NOTE =
  "Cliques usado como aproximação — a integração ainda não captura \"visitas ao perfil\" como métrica própria.";

/** Seguidores não tem métrica de resultado por campanha atribuível. */
export const REPORT_FOLLOWERS_NO_METRIC_NOTE =
  "Ganho de seguidores não é atribuível por campanha — só investimento é mostrado aqui.";

export function resolveReportView(purpose: ReportCampaignPurpose): ReportView {
  return REPORT_PURPOSE_CONFIG[purpose].view;
}

export interface CampaignReportClassification {
  campaignId: string;
  purpose: ReportCampaignPurpose;
}

/** campaignId -> finalidade, direto da tabela (já filtrada por cliente +
 * canal "meta" por quem chama — Relatório é Meta-only, ver report-data.ts). */
export function buildPurposeByCampaignId(classifications: CampaignReportClassification[]): Map<string, ReportCampaignPurpose> {
  return new Map(classifications.map((c) => [c.campaignId, c.purpose]));
}

/**
 * Deriva um lookup por NOME de campanha a partir da classificação (por id)
 * + as linhas de `campaign_daily_metrics` do período (única granularidade
 * que carrega id e nome ao mesmo tempo) — Públicos/Criativos/
 * Posicionamentos só têm `campaignName`, nunca `campaignId` (auditoria),
 * então a ponte entre eles e a classificação só pode ser pelo nome.
 *
 * Quando dois `campaignId` diferentes resolvem pro MESMO nome com
 * finalidades DIFERENTES no período (campanha excluída e recriada com o
 * mesmo nome, por exemplo), o nome vira `"ambiguous"` — nunca escolhemos
 * uma das duas arbitrariamente; quem consome isso trata `"ambiguous"` como
 * "não filtrável com segurança", nunca como uma finalidade real.
 */
export function buildPurposeByCampaignName(
  purposeByCampaignId: Map<string, ReportCampaignPurpose>,
  campaignRows: { campaignId: string | null; campaignName: string }[],
): Map<string, ReportCampaignPurpose | "ambiguous"> {
  const byName = new Map<string, ReportCampaignPurpose | "ambiguous">();

  for (const row of campaignRows) {
    if (!row.campaignId) continue;
    const purpose = purposeByCampaignId.get(row.campaignId);
    if (!purpose) continue;
    const existing = byName.get(row.campaignName);
    if (existing === undefined) {
      byName.set(row.campaignName, purpose);
    } else if (existing !== purpose) {
      byName.set(row.campaignName, "ambiguous");
    }
  }

  return byName;
}

/** `true` só quando o nome resolve, sem ambiguidade, pra uma finalidade
 * SECUNDÁRIA — usado tanto pra excluir da visão "principal" quanto pra
 * incluir na visão "secundario" (mesma checagem, nunca duas réguas
 * diferentes pras duas visões). */
export function isConfidentlySecondaryByName(purposeByName: Map<string, ReportCampaignPurpose | "ambiguous">, campaignName: string): boolean {
  const purpose = purposeByName.get(campaignName);
  return purpose !== undefined && purpose !== "ambiguous" && resolveReportView(purpose) === "secundario";
}
