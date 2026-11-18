import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { resolveCurrentReportPeriods } from "@/lib/weekly-reports/report-periods";
import { countWeeklyReportsByStatus } from "@/lib/weekly-reports/report-list-view";
import type { WeeklyReportMetrics, WeeklyReportPeriodKind, WeeklyReportStatus } from "@/lib/weekly-reports/report-types";

export interface WeeklyReportListFilters {
  clientId: string;
  managerId: string;
}

export interface WeeklyReportListItem {
  id: string;
  clientId: string;
  clientName: string;
  managerId: string | null;
  managerName: string | null;
  periodKind: WeeklyReportPeriodKind;
  periodStart: string;
  periodEnd: string;
  status: WeeklyReportStatus;
  /** `null` enquanto `status === 'aguardando_dados'` — nenhum número foi
   * calculado ainda (nunca um `metrics` vazio tratado como zero). */
  metrics: WeeklyReportMetrics | null;
  nextStep: string | null;
  bodyText: string;
  textEditedAt: string | null;
  sentByName: string | null;
  sentAt: string | null;
  sentText: string | null;
}

/** `weekly_reports.metrics` chega como `{}` (default da coluna) enquanto
 * aguardando dados — `investment` é o único campo sempre presente num
 * snapshot real (`WeeklyReportMetrics`), então a guarda de tipo basta pra
 * nunca confundir "sem métricas ainda" com um snapshot de verdade. */
function parseMetrics(raw: Record<string, unknown>): WeeklyReportMetrics | null {
  return typeof raw.investment === "number" ? (raw as unknown as WeeklyReportMetrics) : null;
}

/**
 * Aba "Reports" — carga da tela (pedido, seção 4: "seleção de edição por
 * data, filtro por cliente e gestor e contador de progresso"). `selectedDate`
 * resolve, via a MESMA função pura do orquestrador (`resolveCurrentReportPeriods`),
 * quais 2 períodos (lote de segunda + lote de sexta) essa data pertence —
 * escolher uma data de uma semana passada mostra os reports daquela
 * semana, sem precisar de uma consulta/lógica de navegação paralela.
 *
 * `activeTab` decide o recorte final (igual `loadAlertList`,
 * `app/alerts/alerts-data.ts`) — `counts` reflete cliente/gestor já
 * filtrados, mas as 3 situações (nunca só a aba ativa), pro contador de
 * progresso bater com os filtros em uso.
 */
export async function loadWeeklyReportList(
  selectedDate: string,
  filters: WeeklyReportListFilters,
  activeTab: WeeklyReportStatus,
): Promise<{
  items: WeeklyReportListItem[];
  counts: Record<WeeklyReportStatus, number>;
  clients: { id: string; name: string }[];
  managers: { id: string; name: string }[];
  periodLabel: { periodStart: string; periodEnd: string }[];
}> {
  const supabase = await createSupabaseClient();
  const periods = resolveCurrentReportPeriods(selectedDate);
  const periodEnds = periods.map((p) => p.periodEnd);

  const [reportRows, eligibleClients, managers] = await Promise.all([
    requireQuery(
      supabase
        .from("weekly_reports")
        .select("id, client_id, period_kind, period_start, period_end, status, metrics, next_step, body_text, text_edited_at, sent_by, sent_at, sent_text")
        .in("period_end", periodEnds),
      "weekly_reports:list",
    ),
    requireQuery(
      supabase.from("clients").select("id, name, primary_manager_id").eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS).is("deleted_at", null).order("name"),
      "clients:weekly-reports-list",
    ),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members:weekly-reports-list"),
  ]);

  const clientById = new Map(eligibleClients.map((c) => [c.id, c]));
  const managerById = new Map(managers.map((m) => [m.id, m]));

  const allItems: WeeklyReportListItem[] = [];
  for (const row of reportRows) {
    const client = clientById.get(row.client_id);
    if (!client) continue; // cliente desativado/excluído depois da geração — nunca um card órfão.
    const manager = client.primary_manager_id ? managerById.get(client.primary_manager_id) ?? null : null;
    const sentByMember = row.sent_by ? managerById.get(row.sent_by) ?? null : null;

    allItems.push({
      id: row.id,
      clientId: row.client_id,
      clientName: client.name,
      managerId: client.primary_manager_id,
      managerName: manager?.name ?? null,
      periodKind: row.period_kind,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      status: row.status,
      metrics: parseMetrics(row.metrics),
      nextStep: row.next_step,
      bodyText: row.body_text,
      textEditedAt: row.text_edited_at,
      sentByName: sentByMember?.name ?? null,
      sentAt: row.sent_at,
      sentText: row.sent_text,
    });
  }

  // Opções de filtro: só cliente/gestor que de fato têm algum card nesta
  // janela (nunca uma opção que renderizaria uma lista vazia por engano).
  const clientIdsWithReports = new Set(allItems.map((item) => item.clientId));
  const clientsForFilter = eligibleClients.filter((c) => clientIdsWithReports.has(c.id)).map((c) => ({ id: c.id, name: c.name }));
  const managerIdsWithReports = new Set(allItems.map((item) => item.managerId).filter((id): id is string => Boolean(id)));
  const managersForFilter = managers.filter((m) => managerIdsWithReports.has(m.id)).map((m) => ({ id: m.id, name: m.name }));

  const filtered = allItems.filter(
    (item) => (!filters.clientId || item.clientId === filters.clientId) && (!filters.managerId || item.managerId === filters.managerId),
  );
  const counts = countWeeklyReportsByStatus(filtered);

  const items = filtered.filter((item) => item.status === activeTab).sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));

  return {
    items,
    counts,
    clients: clientsForFilter,
    managers: managersForFilter,
    periodLabel: periods.map((p) => ({ periodStart: p.periodStart, periodEnd: p.periodEnd })),
  };
}
