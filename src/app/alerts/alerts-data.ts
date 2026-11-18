import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import type { AlertPeriodKind, AlertReferenceSource, AlertSeverity, AlertStatus, AlertType } from "@/lib/alerts/alert-types";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * Aba "Alertas" (pedido, seção 1) — leitura/filtro da lista. "Gravidade"
 * tem um 4º valor de filtro além dos 3 do pedido: `"problemas"` (padrão) —
 * crítico + atenção juntos, SEM oportunidade. É exatamente o requisito
 * "melhorias de performance devem aparecer no filtro 'Oportunidades', sem
 * competir com os problemas na visualização inicial": oportunidade nunca
 * aparece misturada por padrão, só quando o gestor escolhe esse filtro
 * explicitamente.
 */
export type SeverityFilter = "problemas" | AlertSeverity;
export type StatusFilter = "todos" | AlertStatus;
export type AlertTypeFilter = "todos" | AlertType;

export interface AlertListFilters {
  clientId: string; // "" = todos
  severity: SeverityFilter;
  alertType: AlertTypeFilter;
  status: StatusFilter;
}

export interface AlertListItem {
  id: string;
  clientId: string;
  clientName: string;
  channel: TrafficChannel;
  alertType: AlertType;
  periodKind: AlertPeriodKind;
  severity: AlertSeverity;
  status: AlertStatus;
  periodStart: string;
  periodEnd: string;
  observedValue: number | null;
  referenceValue: number | null;
  diffPercent: number | null;
  referenceIsEstimate: boolean;
  referenceSource: AlertReferenceSource | null;
  explanation: string;
  firstDetectedAt: string;
  lastEvaluatedAt: string;
  followUpUntil: string | null;
  /** "Marcar como revisado" (pedido, seção 3: "registra que alguém
   * analisou... sem considerá-lo resolvido") nunca muda status/severidade
   * — sem isto, a ÚNICA confirmação da ação era um toast de alguns
   * segundos (achado real do usuário: "cliquei e nada aconteceu"). Não
   * nulo só quando o evento MAIS RECENTE do alerta é 'revisado' — uma
   * reavaliação automática posterior (evento 'avaliado'/'retomado_atencao'/
   * etc.) some com o selo de novo, pedindo revisão nova (estado correto:
   * "revisado" é sobre o estado de ONTEM/agora, não permanente). */
  lastReviewedAt: string | null;
  lastReviewedByName: string | null;
}

/** Ordem de prioridade da lista (pedido: "lista ordenada por gravidade e
 * relevância") — crítico primeiro, depois atenção, oportunidade por
 * último; dentro da mesma gravidade, "precisa de atenção" antes de
 * "acompanhamento" antes de "resolvido"; por fim, mais recente primeiro. */
const SEVERITY_ORDER: Record<AlertSeverity, number> = { critico: 0, atencao: 1, oportunidade: 2 };
const STATUS_ORDER: Record<AlertStatus, number> = { precisa_atencao: 0, acompanhamento: 1, resolvido: 2 };

export async function loadAlertList(filters: AlertListFilters): Promise<{
  items: AlertListItem[];
  clients: { id: string; name: string }[];
  attentionCount: number;
}> {
  const supabase = await createSupabaseClient();

  let query = supabase
    .from("alerts")
    .select(
      "id, client_id, channel, alert_type, period_kind, severity, status, period_start, period_end, observed_value, reference_value, diff_percent, reference_is_estimate, reference_source, explanation, first_detected_at, last_evaluated_at, follow_up_until, clients(name)",
    );

  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  if (filters.alertType !== "todos") query = query.eq("alert_type", filters.alertType);
  if (filters.status !== "todos") query = query.eq("status", filters.status);

  if (filters.severity === "problemas") query = query.in("severity", ["critico", "atencao"]);
  else query = query.eq("severity", filters.severity);

  // Contador do nav (seção 1 do pedido) — sempre a contagem REAL de
  // "precisa de atenção", nunca escopada pelos filtros da tela atual, e
  // nunca conta oportunidade (não é um problema pendente). `head: true`
  // devolve só `count` (`data` vem `null`) — por isso nunca passa por
  // `requireQuery` (feito pra resultados em linha, não contagem).
  const [alertRows, clients, attentionCountResult] = await Promise.all([
    requireQuery(query, "alerts:list"),
    requireQuery(supabase.from("clients").select("id, name").is("deleted_at", null).order("name"), "clients:alerts-filter"),
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("status", "precisa_atencao").in("severity", ["critico", "atencao"]),
  ]);
  if (attentionCountResult.error) throw new Error(`[alerts:attention-count] ${attentionCountResult.error.message}`);

  // "Revisado" só é um selo visível enquanto for o evento MAIS RECENTE de
  // cada alerta — busca todo o histórico relevante de uma vez (nunca uma
  // query por linha) e fica só com o 1º eventual de cada `alert_id`
  // (ordenado desc, então o 1º encontrado é sempre o mais recente).
  const alertIds = alertRows.map((row) => row.id);
  const latestEventByAlertId = new Map<string, { eventType: string; createdAt: string; actorName: string | null }>();
  if (alertIds.length > 0) {
    const eventRows = await requireQuery(
      supabase
        .from("alert_events")
        .select("alert_id, event_type, created_at, profiles(name)")
        .in("alert_id", alertIds)
        .order("created_at", { ascending: false }),
      "alert_events:latest-per-alert",
    );
    for (const row of eventRows) {
      if (latestEventByAlertId.has(row.alert_id)) continue;
      latestEventByAlertId.set(row.alert_id, {
        eventType: row.event_type,
        createdAt: row.created_at,
        actorName: (row.profiles as { name: string } | null)?.name ?? null,
      });
    }
  }

  const items: AlertListItem[] = alertRows
    .map((row): AlertListItem => {
      const latestEvent = latestEventByAlertId.get(row.id);
      const isReviewed = latestEvent?.eventType === "revisado";
      return {
        id: row.id,
        clientId: row.client_id,
        clientName: (row.clients as { name: string } | null)?.name ?? "Cliente desconhecido",
        channel: row.channel,
        alertType: row.alert_type,
        periodKind: row.period_kind,
        severity: row.severity,
        status: row.status,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        observedValue: row.observed_value,
        referenceValue: row.reference_value,
        diffPercent: row.diff_percent,
        referenceIsEstimate: row.reference_is_estimate,
        referenceSource: row.reference_source,
        explanation: row.explanation,
        firstDetectedAt: row.first_detected_at,
        lastEvaluatedAt: row.last_evaluated_at,
        followUpUntil: row.follow_up_until,
        lastReviewedAt: isReviewed ? latestEvent!.createdAt : null,
        lastReviewedByName: isReviewed ? latestEvent!.actorName : null,
      };
    })
    .sort((a, b) => {
      if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      return b.lastEvaluatedAt.localeCompare(a.lastEvaluatedAt);
    });

  return { items, clients, attentionCount: attentionCountResult.count ?? 0 };
}

/** Versão leve só do contador — usada pela Sidebar (renderizada em toda
 * navegação, nunca deveria carregar a lista inteira de alertas só pra
 * mostrar um número no menu). Mesma contagem exata de `loadAlertList`. */
export async function countAlertsNeedingAttention(): Promise<number> {
  const supabase = await createSupabaseClient();
  const { count, error } = await supabase
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .eq("status", "precisa_atencao")
    .in("severity", ["critico", "atencao"]);
  if (error) throw new Error(`[alerts:attention-count] ${error.message}`);
  return count ?? 0;
}
