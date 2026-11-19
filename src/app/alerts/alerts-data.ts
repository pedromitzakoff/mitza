import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { compareAlertsByPriority, countAlertsByStatus } from "@/lib/alerts/alert-list-view";
import type { AlertPeriodKind, AlertReferenceSource, AlertSeverity, AlertStatus, AlertType } from "@/lib/alerts/alert-types";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * Aba "Alertas" (pedido, seção 1 da melhoria visual) — leitura/filtro.
 * "Situação" VIROU abas (`AlertsTabs`), não mais um filtro de `<select>`
 * — `AlertListFilters` agora só tem cliente/gravidade/tipo; a aba ativa é
 * um parâmetro separado de `loadAlertList`, nunca misturado aqui.
 *
 * "Gravidade" tem um 4º valor de filtro além dos 3 do pedido original:
 * `"problemas"` (padrão) — crítico + atenção juntos, SEM oportunidade. É
 * exatamente o requisito "melhorias de performance devem aparecer no
 * filtro 'Oportunidades', sem competir com os problemas na visualização
 * inicial": oportunidade nunca aparece misturada por padrão, só quando o
 * gestor escolhe esse filtro explicitamente.
 */
export type SeverityFilter = "problemas" | AlertSeverity;
export type AlertTypeFilter = "todos" | AlertType;

export interface AlertListFilters {
  clientId: string; // "" = todos
  severity: SeverityFilter;
  alertType: AlertTypeFilter;
}

export interface AlertListItem {
  id: string;
  /** Pedido do usuário ("um número do código do alerta que cada um tem
   * um") — sequencial, atribuído uma vez na criação da linha
   * (`alerts.display_number`, `generated always as identity`), nunca
   * recalculado a partir da posição na lista (que mudaria a cada filtro/
   * ordenação — exatamente o que o pedido quer evitar). */
  displayNumber: number;
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
  /** Desvio em reais, com sinal (`observado - referência`) — pedido:
   * "destaque... a diferença em reais e percentual". Extraído de
   * `detail.diffReais` (gravado por `detectSpendPaceAlert`); `null` num
   * alerta antigo gravado antes dessa chave existir, nunca recalculado
   * aqui (card trata como "sem desvio conhecido", não como erro). */
  diffReais: number | null;
  referenceIsEstimate: boolean;
  referenceSource: AlertReferenceSource | null;
  /** Acumulado do mês (até a data avaliada) e o previsto até essa mesma
   * data (pedido, seção 2: "mostre também o acumulado do mês versus o
   * previsto até a mesma data, quando houver dados confiáveis"). Extraído
   * de `detail.monthActual`/`detail.monthExpectedToDate` (gravados pela
   * orquestração, `evaluate-spend-pace.ts`) — `monthExpectedToDate: null`
   * = sem orçamento mensal configurado pra este canal/mês (nunca
   * fabricado); um alerta antigo sem essas chaves também cai em `null`. */
  monthActual: number | null;
  monthExpectedToDate: number | null;
  /** Só "balance_depletion" (`detail.daysRemaining`/`detail.currency`,
   * gravados por `detectBalanceDepletionAlert`) — `null` pra qualquer
   * outro tipo de alerta, nunca um valor fabricado. */
  balanceDaysRemaining: number | null;
  balanceCurrency: string | null;
  explanation: string;
  firstDetectedAt: string;
  lastEvaluatedAt: string;
  followUpUntil: string | null;
  /** Achado do usuário ("o texto que eu escrevo... onde que eu leio
   * depois?") — a observação do evento MAIS RECENTE deste alerta (sempre
   * a de "Acompanhar amanhã"/"Resolver manualmente", já que só essas 2
   * ações gravam nota; um evento automático sem nota — ex. resolução
   * automática por normalização — corretamente mostra `null`, nunca uma
   * nota antiga que não reflete mais o estado atual). */
  latestNote: string | null;
  latestNoteByName: string | null;
  latestNoteAt: string | null;
}

export async function loadAlertList(
  filters: AlertListFilters,
  /** Aba ativa (pedido: "abas com contagem... Precisa de atenção por
   * padrão") — decide só QUAIS itens entram em `items` (pro card-list da
   * tela), nunca afeta `counts` (que é sempre as 3 situações, com os
   * MESMOS filtros de cliente/gravidade/tipo, pra alimentar o número de
   * cada aba mesmo quando ela não está ativa). */
  activeTab: AlertStatus,
): Promise<{
  items: AlertListItem[];
  counts: Record<AlertStatus, number>;
  clients: { id: string; name: string }[];
  attentionCount: number;
}> {
  const supabase = await createSupabaseClient();

  // Nunca filtra por `status` aqui (seção 1: "situação" virou aba, não
  // filtro de busca) — busca as 3 situações de uma vez, com os MESMOS
  // filtros de cliente/gravidade/tipo, pra `counts` refletir as 3 abas.
  //
  // `period_kind = "full_day"` (pedido do usuário: "eu quero um alerta
  // sempre sobre ontem então, já que hoje o dia ainda está acontecendo") —
  // o monitor "hoje em andamento" (`in_progress`) foi desativado
  // (`evaluate-spend-pace.ts` não o gera mais), mas linhas antigas podem
  // continuar no banco; este filtro garante que elas somem do painel
  // imediatamente, sem precisar de uma migration de limpeza.
  let query = supabase
    .from("alerts")
    .select(
      "id, display_number, client_id, channel, alert_type, period_kind, severity, status, period_start, period_end, observed_value, reference_value, diff_percent, reference_is_estimate, reference_source, detail, explanation, first_detected_at, last_evaluated_at, follow_up_until, clients(name)",
    )
    .eq("period_kind", "full_day");

  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  if (filters.alertType !== "todos") query = query.eq("alert_type", filters.alertType);

  if (filters.severity === "problemas") query = query.in("severity", ["critico", "atencao"]);
  else query = query.eq("severity", filters.severity);

  // Contador do nav (seção 1 do pedido original) — sempre a contagem REAL
  // de "precisa de atenção" da AGÊNCIA INTEIRA, nunca escopada pelos
  // filtros da tela atual (diferente de `counts`, que É escopado pelos
  // filtros), e nunca conta oportunidade (não é um problema pendente).
  // `head: true` devolve só `count` (`data` vem `null`) — por isso nunca
  // passa por `requireQuery` (feito pra resultados em linha, não contagem).
  const [alertRows, clients, attentionCountResult] = await Promise.all([
    requireQuery(query, "alerts:list"),
    requireQuery(supabase.from("clients").select("id, name").is("deleted_at", null).order("name"), "clients:alerts-filter"),
    supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("status", "precisa_atencao")
      .eq("period_kind", "full_day")
      .in("severity", ["critico", "atencao"]),
  ]);
  if (attentionCountResult.error) throw new Error(`[alerts:attention-count] ${attentionCountResult.error.message}`);

  // A observação mostrada no card é sempre a do evento MAIS RECENTE de
  // cada alerta — busca todo o histórico relevante de uma vez (nunca uma
  // query por linha) e fica só com o 1º eventual de cada `alert_id`
  // (ordenado desc, então o 1º encontrado é sempre o mais recente). Como
  // só "Acompanhar amanhã"/"Resolver manualmente" gravam `note`, o evento
  // mais recente SER um desses dois é exatamente o que faz `status` valer
  // 'acompanhamento'/'resolvido' (manual) agora — nunca uma nota antiga
  // de uma ocorrência já superada.
  const alertIds = alertRows.map((row) => row.id);
  const latestEventByAlertId = new Map<string, { note: string | null; createdAt: string; actorName: string | null }>();
  if (alertIds.length > 0) {
    const eventRows = await requireQuery(
      supabase
        .from("alert_events")
        .select("alert_id, note, created_at, profiles(name)")
        .in("alert_id", alertIds)
        .order("created_at", { ascending: false }),
      "alert_events:latest-per-alert",
    );
    for (const row of eventRows) {
      if (latestEventByAlertId.has(row.alert_id)) continue;
      latestEventByAlertId.set(row.alert_id, {
        note: row.note,
        createdAt: row.created_at,
        actorName: (row.profiles as { name: string } | null)?.name ?? null,
      });
    }
  }

  const allItems: AlertListItem[] = alertRows
    .map((row): AlertListItem => {
      const latestEvent = latestEventByAlertId.get(row.id);
      const hasNote = Boolean(latestEvent?.note);
      // `detail` é um jsonb livre (seção 2 da melhoria visual) — alertas
      // antigos, gravados antes dessas 3 chaves existirem, simplesmente
      // não as têm; lido como `null`/`undefined` ali vira `null` aqui,
      // nunca um erro (ver comentário no `AlertListItem`).
      const detail = row.detail as Record<string, unknown>;
      const diffReais = typeof detail.diffReais === "number" ? detail.diffReais : null;
      const monthActual = typeof detail.monthActual === "number" ? detail.monthActual : null;
      const monthExpectedToDate = typeof detail.monthExpectedToDate === "number" ? detail.monthExpectedToDate : null;
      const balanceDaysRemaining = typeof detail.daysRemaining === "number" ? detail.daysRemaining : null;
      const balanceCurrency = typeof detail.currency === "string" ? detail.currency : null;
      return {
        id: row.id,
        displayNumber: row.display_number,
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
        diffReais,
        referenceIsEstimate: row.reference_is_estimate,
        referenceSource: row.reference_source,
        monthActual,
        monthExpectedToDate,
        balanceDaysRemaining,
        balanceCurrency,
        explanation: row.explanation,
        firstDetectedAt: row.first_detected_at,
        lastEvaluatedAt: row.last_evaluated_at,
        followUpUntil: row.follow_up_until,
        latestNote: hasNote ? latestEvent!.note : null,
        latestNoteByName: hasNote ? latestEvent!.actorName : null,
        latestNoteAt: hasNote ? latestEvent!.createdAt : null,
      };
    })
    .sort(compareAlertsByPriority);

  const counts = countAlertsByStatus(allItems);
  const items = allItems.filter((item) => item.status === activeTab);

  return { items, counts, clients, attentionCount: attentionCountResult.count ?? 0 };
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
    .eq("period_kind", "full_day")
    .in("severity", ["critico", "atencao"]);
  if (error) throw new Error(`[alerts:attention-count] ${error.message}`);
  return count ?? 0;
}
