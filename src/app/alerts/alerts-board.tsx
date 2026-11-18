import { EmptyState } from "@/components/ui/empty-state";
import { ALERT_STATUS_BADGE_CLASSES, ALERT_STATUS_COLUMN_ORDER, ALERT_STATUS_LABEL } from "@/lib/alerts/alert-labels";
import { AlertCard } from "@/app/alerts/alert-card";
import type { AlertListItem, StatusFilter } from "@/app/alerts/alerts-data";
import type { AlertStatus } from "@/lib/alerts/alert-types";

/**
 * Kanban de "Alertas" (pedido do usuário, depois de ver a lista única —
 * "e se ficasse um formato Kanban? com colunas de como está cada alerta?").
 * As 3 colunas são as 3 situações REAIS (`AlertStatus`) — nunca uma 4ª
 * coluna "Revisado": revisar nunca muda a situação de um alerta (pedido
 * original, seção 3: "sem considerá-lo resolvido"), então vira uma 4ª
 * coluna faria um alerta crítico revisado desaparecer de "Precisa de
 * atenção" sem estar resolvido de verdade — o selo "✓ Revisado" continua
 * dentro do card (`AlertCard`), em qualquer coluna.
 *
 * Quando o filtro "Situação" já restringe a UMA situação específica, só
 * essa coluna existe em `items` — mostra ela sozinha, largura cheia (nunca
 * 2 colunas fantasmas vazias ao lado). Com o filtro em "todas" (padrão),
 * as 3 colunas aparecem sempre, mesmo vazias (estrutura do quadro visível
 * de propósito, nunca pulando uma coluna por falta de alerta nela).
 *
 * Mobile (pedido explícito: "se der pra ser kanban tbm"): 3 colunas não
 * cabem lado a lado numa tela estreita — rolagem horizontal com
 * scroll-snap nativo (sem JS) é o padrão já usado por apps de Kanban em
 * mobile (Trello etc.), com uma fileira de abas de atalho acima pra pular
 * direto pra uma coluna sem precisar arrastar o dedo pelas 3. Acima de
 * `md`, vira o quadro de 3 colunas lado a lado de sempre (sem scroll
 * horizontal, sem a fileira de abas).
 */
export function AlertsBoard({ items, statusFilter }: { items: AlertListItem[]; statusFilter: StatusFilter }) {
  const visibleStatuses: AlertStatus[] = statusFilter === "todos" ? ALERT_STATUS_COLUMN_ORDER : [statusFilter];

  const itemsByStatus = new Map<AlertStatus, AlertListItem[]>();
  for (const status of visibleStatuses) itemsByStatus.set(status, []);
  for (const item of items) {
    const list = itemsByStatus.get(item.status);
    if (list) list.push(item);
  }

  const singleColumn = visibleStatuses.length === 1;

  return (
    <div className="flex flex-col gap-2">
      {!singleColumn && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 md:hidden">
          {visibleStatuses.map((status) => (
            <a
              key={status}
              href={`#board-col-${status}`}
              className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${ALERT_STATUS_BADGE_CLASSES[status]}`}
            >
              {ALERT_STATUS_LABEL[status]} · {itemsByStatus.get(status)?.length ?? 0}
            </a>
          ))}
        </div>
      )}

      <div className={`flex gap-4 ${singleColumn ? "" : "snap-x snap-mandatory overflow-x-auto md:snap-none md:overflow-visible"}`}>
        {visibleStatuses.map((status) => {
          const columnItems = itemsByStatus.get(status) ?? [];
          return (
            <div
              key={status}
              id={`board-col-${status}`}
              className={singleColumn ? "w-full min-w-0" : "min-w-[85%] shrink-0 snap-center scroll-mt-2 sm:min-w-[22rem] md:min-w-0 md:flex-1 md:shrink"}
            >
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-overview-text-primary">{ALERT_STATUS_LABEL[status]}</h2>
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${ALERT_STATUS_BADGE_CLASSES[status]}`}>{columnItems.length}</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {columnItems.length === 0 ? (
                  <EmptyState className="bg-card p-3">Nenhum alerta aqui.</EmptyState>
                ) : (
                  columnItems.map((alert) => <AlertCard key={alert.id} alert={alert} hideStatusBadge />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
