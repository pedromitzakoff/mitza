import { formatShortDate } from "@/lib/format";
import type { MonthlyReportStatus } from "@/lib/supabase/database.types";

/**
 * Núcleo puro do painel operacional `/reports` (Etapa "Separação Relatório
 * Operacional × Documento de Performance") — nenhuma regra de transição de
 * status mora aqui (essas continuam 100% em `report-actions.ts`,
 * `updateReportStatusAction`/`finalizeReportAction`/`reopenReportAction`,
 * reutilizadas sem alteração). Este arquivo só resolve HREFs e formata o que
 * já foi decidido em outro lugar — apresentação, nunca regra de negócio.
 */

/**
 * "Abrir relatório" — sempre a página NATIVA do Relatório de Performance
 * (`/clients/[id]/relatorio`, Etapa "Relatório Nativo"), nunca o endpoint
 * de PDF nem uma segunda implementação de Campanhas/Criativos.
 * `analyticsPreset=custom` é obrigatório: sem ele, `resolveAnalyticsPeriod`
 * (lib/analytics.ts) ignora `analyticsStart`/`analyticsEnd` e cai no mês
 * corrente por padrão — o período exato selecionado em `/reports` só chega
 * ao relatório se o preset for explicitamente "custom".
 */
export function buildPerformanceReportHref(clientId: string, monthRange: { firstDay: string; lastDay: string }): string {
  const params = new URLSearchParams({
    analyticsPreset: "custom",
    analyticsStart: monthRange.firstDay,
    analyticsEnd: monthRange.lastDay,
  });
  return `/clients/${clientId}/relatorio?${params.toString()}`;
}

/** Aposentadoria de `/reports/[clientId]` (Etapa "Separação..."): nunca
 * 404 — sempre volta pra `/reports`, preservando mês e cliente quando
 * disponíveis (o próprio `/reports` já sabe ignorar um `client` inválido/
 * inacessível com segurança, mesmo critério de sempre). */
export function buildReportsRedirectHref(clientId: string, month: string | undefined): string {
  const params = new URLSearchParams();
  if (month) params.set("month", month);
  params.set("client", clientId);
  return `/reports?${params.toString()}`;
}

export interface MonthlyReportRow {
  status: MonthlyReportStatus;
  updated_at: string | null;
  finalized_at: string | null;
  finalized_by_profile: { name: string } | { name: string }[] | null;
}

export interface ResolvedMonthlyReportRow {
  status: MonthlyReportStatus;
  /** "—" quando o cliente nunca teve nenhuma linha de relatório neste mês
   * (nunca uma data fabricada). */
  updatedAtLabel: string;
  /** `null` fora do status "finalizado" — só existe pra alimentar o texto
   * "Finalizado · DD/MM · Nome". Nome só aparece quando o join já trouxe
   * (`finalized_by_profile`); sem isso, mostra só a data. */
  finalizedLabel: string | null;
}

function finalizedByName(profile: MonthlyReportRow["finalized_by_profile"]): string | null {
  if (!profile) return null;
  const row = Array.isArray(profile) ? profile[0] : profile;
  return row?.name ?? null;
}

/** Resolve as 3 informações de exibição da coluna Status/Atualizado — nunca
 * decide se um status é válido nem faz nenhuma transição (isso é
 * `report-actions.ts`). Cliente sem nenhuma linha em `monthly_reports` pro
 * mês (nunca abriu o relatório ainda) é o mesmo "nao_iniciado" que
 * `getOrCreateReport` cria sob demanda — nunca um estado novo. */
export function resolveMonthlyReportRow(row: MonthlyReportRow | undefined): ResolvedMonthlyReportRow {
  if (!row) {
    return { status: "nao_iniciado", updatedAtLabel: "—", finalizedLabel: null };
  }

  const updatedAtLabel = row.updated_at ? formatShortDate(row.updated_at.slice(0, 10)) : "—";

  let finalizedLabel: string | null = null;
  if (row.status === "finalizado") {
    const dateLabel = row.finalized_at ? formatShortDate(row.finalized_at.slice(0, 10)) : null;
    const name = finalizedByName(row.finalized_by_profile);
    finalizedLabel = [dateLabel, name].filter((part): part is string => Boolean(part)).join(" · ") || null;
  }

  return { status: row.status, updatedAtLabel, finalizedLabel };
}
