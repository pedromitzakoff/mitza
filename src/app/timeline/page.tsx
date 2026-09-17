import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { formatTimeOnly, formatTimelineDayLabel } from "@/lib/format";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import {
  fetchAgencyTimeline,
  fetchAgencyTimelineEventById,
  resolveAgencyTimelineType,
  resolveAgencyTimelineFamily,
  type AgencyTimelineRow,
  type AgencyTimelineEventById,
} from "@/lib/agency-timeline";
import { formatEventReference } from "@/lib/event-reference";
import { TimelineFilterBar } from "./timeline-filter-bar";

/** UUID v4-ish, só pra nunca passar um `?highlight=` malformado direto pro
 * `.eq("id", ...)` do Postgres (que lançaria erro de tipo em vez de devolver
 * vazio) — mesmo cuidado que qualquer `.eq()` por uuid vindo de query string
 * não confiável precisa ter. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/timeline` — Timeline Geral da Agência (Auditoria + Etapa "Tríade da
 * Navegação Principal", evoluída na Etapa "Timeline 2.0"): responde "o que
 * está acontecendo na agência?", terceiro pilar ao lado de Visão Geral
 * ("como está a agência?") e Operação ("qual cliente precisa de atenção?").
 * Reaproveita 100% `operational_events` — nenhuma tabela, cron ou tracking
 * novo (ver `lib/agency-timeline.ts`). Mesmo modelo de acesso de sempre:
 * qualquer usuário autenticado vê a carteira inteira (RLS de
 * `operational_events` é só por organização), Gestor/Cliente/Tipo/Família
 * são recortes de conveniência, nunca uma permissão.
 *
 * Etapa "Timeline 2.0" (seção 2 do pedido, princípio central — AÇÃO HUMANA ≠
 * RESULTADO OBSERVADO): a página que antes só respondia "o que os gestores
 * fizeram" passa a também contar "o que aconteceu com a performance das
 * contas" — a antiga página separada "Conquistas" (`/achievements`) deixou
 * de ser um destino de produto; o motor que a alimentava
 * (`achievement-engine.ts`) continua rodando intocado, só a APRESENTAÇÃO
 * migrou pra cá (ver `lib/agency-timeline.ts`, família `"performance"`).
 * Filtro novo "Todos | Ações | Performance" (seção 7), ortogonal ao "Tipo"
 * de sempre. Cada linha carrega uma referência humana estável (`#EVT-XXXXXXXX`,
 * seção 11) e, quando o `metadata` já carregar uma relação (seção 12 —
 * nenhum detector escreve isso ainda nesta etapa, arquitetura pronta pra
 * quando escrever), um link "Ver #EVT-XXXXXXXX →" que abre o evento
 * referenciado via `?highlight=`, independente de página/filtro atual.
 */
export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; client?: string; type?: string; family?: string; page?: string; highlight?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const params = await searchParams;
  const actorId = params.actor ?? "todos";
  const clientId = params.client ?? "todos";
  const type = resolveAgencyTimelineType(params.type);
  const family = resolveAgencyTimelineFamily(params.family);
  const page = Math.max(0, Number(params.page) || 0);
  const highlightId = params.highlight && UUID_PATTERN.test(params.highlight) ? params.highlight : null;

  const supabase = await createSupabaseClient();

  const [actors, clients, { rows, hasMore }, highlightedEvent] = await Promise.all([
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    requireQuery(
      supabase.from("clients").select("id, name").is("deleted_at", null).eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS).order("name"),
      "clients",
    ),
    fetchAgencyTimeline(
      supabase,
      profile.organizationId,
      { actorId: actorId !== "todos" ? actorId : null, clientId: clientId !== "todos" ? clientId : null, type, family },
      page,
    ),
    highlightId ? fetchAgencyTimelineEventById(supabase, profile.organizationId, highlightId) : Promise.resolve(null),
  ]);

  const hasAnyFilter = actorId !== "todos" || clientId !== "todos" || type !== "todos" || family !== "todos";
  const now = new Date();

  // Agrupa por dia civil (mesma regra de fuso de `formatTimelineDayLabel`) —
  // um cabeçalho só por dia, nunca repetido a cada linha (mesmo padrão de
  // divisor já usado em `operation-triage-view.tsx`, agora por dia em vez
  // de por gravidade).
  const groups: { dayLabel: string; rows: AgencyTimelineRow[] }[] = [];
  for (const row of rows) {
    const dayLabel = formatTimelineDayLabel(row.occurredAt, now);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.dayLabel === dayLabel) lastGroup.rows.push(row);
    else groups.push({ dayLabel, rows: [row] });
  }

  function pageHref(overrides: { p?: number; family?: string; clearHighlight?: boolean }) {
    const next = new URLSearchParams();
    if (actorId !== "todos") next.set("actor", actorId);
    if (clientId !== "todos") next.set("client", clientId);
    if (type !== "todos") next.set("type", type);
    const nextFamily = overrides.family ?? family;
    if (nextFamily !== "todos") next.set("family", nextFamily);
    const nextPage = overrides.p ?? page;
    if (nextPage > 0) next.set("page", String(nextPage));
    if (highlightId && !overrides.clearHighlight) next.set("highlight", highlightId);
    const query = next.toString();
    return query ? `/timeline?${query}` : "/timeline";
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Timeline</h1>
        <p className="text-sm text-muted-foreground">O que está acontecendo na agência.</p>
      </div>

      {highlightedEvent && <HighlightedEventCallout event={highlightedEvent} clearHref={pageHref({ clearHighlight: true })} />}

      <TimelineFilterBar
        actorId={actorId}
        clientId={clientId}
        type={type}
        family={family}
        actors={actors ?? []}
        clients={clients ?? []}
      />

      {groups.length > 0 ? (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group.dayLabel}>
              <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">{group.dayLabel}</p>
              <ul className="flex flex-col">
                {group.rows.map((row) => (
                  <TimelineRow key={row.id} row={row} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>{hasAnyFilter ? "Nenhum evento encontrado com esse filtro." : "Nenhum evento registrado ainda."}</EmptyState>
      )}

      {(page > 0 || hasMore) && (
        <div className="flex items-center gap-2 text-sm">
          {page > 0 && (
            <Link href={pageHref({ p: page - 1 })} scroll={false} className="font-medium text-brand hover:underline">
              Mais recentes
            </Link>
          )}
          {hasMore && (
            <Link href={pageHref({ p: page + 1 })} scroll={false} className="font-medium text-brand hover:underline">
              Ver mais antigos
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** Etapa "Timeline 2.0" (seção 12) — evento referenciado por `?highlight=`,
 * mostrado ACIMA da lista principal, independente de em qual página/filtro
 * ele realmente estaria. Nunca afirma causalidade (seção 3): o próprio rótulo
 * é neutro ("Evento referenciado"), o link de volta some o parâmetro. */
function HighlightedEventCallout({ event, clearHref }: { event: AgencyTimelineEventById; clearHref: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-overview-border bg-overview-surface-subtle px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">Evento referenciado · {event.eventReference}</p>
        <Link href={clearHref} scroll={false} className="text-[11px] text-overview-text-muted hover:text-overview-text-secondary hover:underline">
          Fechar
        </Link>
      </div>
      <p className="text-sm font-medium text-overview-text-primary">
        {event.clientName ?? "Agência"} · {event.label}
      </p>
      {event.detail && <p className="text-sm text-overview-text-secondary">{event.detail}</p>}
    </div>
  );
}

/**
 * Uma linha da Timeline — divisor leve em vez de card independente com
 * borda (seção 9 do pedido: "isso gera muito espaço vertical e pouca
 * densidade de informação"). Cliente em maior destaque, gestor abaixo em
 * tom secundário, horário/referência como informação secundária ao lado do
 * cliente. `reviewPresentation` presente ⇒ hierarquia Diagnóstico/Ações/
 * Observação (seção 8); ausente ⇒ o par label/detail genérico de sempre.
 *
 * Etapa "Timeline 2.0" (seção 21 do pedido — diferenciar AÇÃO de PERFORMANCE
 * de forma discreta, "sem árvore de Natal de status coloridos"): uma
 * conquista (`family === "performance"`) ganha só um rótulo pequeno
 * "Performance · Positivo" em vez do nome do gestor (nunca uma ação
 * atribuível a uma pessoa) — mesma densidade visual de qualquer outra linha,
 * nenhum card/borda/cor de fundo novos.
 */
function TimelineRow({ row }: { row: AgencyTimelineRow }) {
  return (
    <li className="flex flex-col gap-0.5 border-b border-overview-border/60 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        {row.clientName ? (
          <span className="text-sm font-semibold text-overview-text-primary">{row.clientName}</span>
        ) : (
          <span className="text-sm font-semibold text-overview-text-primary">Agência</span>
        )}
        <span className="text-overview-text-muted" aria-hidden="true">
          ·
        </span>
        <span className="tabular-nums text-xs text-overview-text-muted">{formatTimeOnly(row.occurredAt)}</span>
        <span className="text-overview-text-muted" aria-hidden="true">
          ·
        </span>
        <span className="tabular-nums text-[11px] text-overview-text-muted">{row.eventReference}</span>
      </div>

      {row.family === "performance" ? (
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-overview-text-secondary">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${row.performanceTone === "atencao" ? "bg-overview-warning" : "bg-lime"}`}
            aria-hidden="true"
          />
          Performance · {row.performanceTone === "atencao" ? "Atenção" : "Positivo"}
        </p>
      ) : (
        <p className="text-xs text-overview-text-secondary">{row.actorName ?? "Sistema"}</p>
      )}

      {row.reviewPresentation ? (
        <div className="mt-1 flex flex-col gap-0.5">
          <p className="text-sm font-medium text-overview-text-primary">{row.reviewPresentation.headline}</p>
          {row.reviewPresentation.actionsLine && (
            <p className="text-sm text-overview-text-secondary">{row.reviewPresentation.actionsLine}</p>
          )}
          {row.reviewPresentation.notes && (
            <p className="mt-0.5 text-sm italic text-overview-text-secondary">{row.reviewPresentation.notes}</p>
          )}
        </div>
      ) : (
        <p className="mt-1 text-sm text-overview-text-primary">
          {row.label}
          {row.detail ? <span className="text-overview-text-secondary"> · {row.detail}</span> : null}
        </p>
      )}

      {row.relation && (
        <Link
          href={`/timeline?highlight=${row.relation.relatedEventId}`}
          scroll={false}
          className="mt-0.5 text-xs font-medium text-brand hover:underline"
        >
          Observado após {formatEventReference(row.relation.relatedEventId)} →
        </Link>
      )}
    </li>
  );
}
