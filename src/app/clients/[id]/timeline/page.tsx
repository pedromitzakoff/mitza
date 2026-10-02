import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { formatTimeOnly, formatTimelineDayLabel } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import {
  fetchClientTimelinePage,
  resolveClientTimelineCategory,
  CLIENT_TIMELINE_CATEGORY_OPTIONS,
  CLIENT_TIMELINE_CATEGORY_LABEL,
  type ClientTimelineRow,
  type ClientTimelineCategory,
} from "@/lib/client-timeline";
import { WorkspaceContainer } from "../../workspace-container";

/**
 * `/clients/[id]/timeline` — Etapa "MEGA FACELIFT — Fase 6: Timeline".
 * Primeira versão funcional do módulo (a Fase 1 só validava a rota) —
 * "o que aconteceu com este cliente?", a memória do Growth. Reaproveita
 * 100% `fetchAgencyEvents`/`operational_events` (ver `lib/client-timeline.ts`
 * — nenhuma segunda arquitetura de histórico), com a MESMA linguagem visual
 * (linha vertical discreta, divisor em vez de card) já provada em `/timeline`
 * (Timeline da Agência).
 *
 * Sem contexto LOCAL próprio (sem `?month=`) — um evento é um fato do
 * PASSADO, nunca escopado a um mês em exibição (mesma decisão já tomada pro
 * drawer "Informações da conta" e pro módulo Dados).
 */
export default async function ClientTimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ category?: string; page?: string }>;
}) {
  const { id } = await params;
  const { category: categoryParam, page: pageParam } = await searchParams;

  const profile = await getCurrentProfile();
  if (!profile) return null;

  const category = resolveClientTimelineCategory(categoryParam);
  const page = Math.max(0, Number(pageParam) || 0);

  const supabase = await createSupabaseClient();

  const { data: client } = await supabase.from("clients").select("id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!client) notFound();

  const { rows, hasMore } = await fetchClientTimelinePage(supabase, profile.organizationId, id, category, page);

  const now = new Date();
  const groups: { dayLabel: string; rows: ClientTimelineRow[] }[] = [];
  for (const row of rows) {
    const dayLabel = formatTimelineDayLabel(row.occurredAt, now);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.dayLabel === dayLabel) lastGroup.rows.push(row);
    else groups.push({ dayLabel, rows: [row] });
  }

  function pageHref(overrides: { category?: ClientTimelineCategory; page?: number }) {
    const nextCategory = overrides.category ?? category;
    const nextPage = overrides.page ?? (overrides.category ? 0 : page);
    const params = new URLSearchParams();
    if (nextCategory !== "todos") params.set("category", nextCategory);
    if (nextPage > 0) params.set("page", String(nextPage));
    const query = params.toString();
    return `/clients/${id}/timeline${query ? `?${query}` : ""}`;
  }

  return (
    <WorkspaceContainer>
      <div>
        <h1 className="text-lg font-semibold text-overview-text-primary">Timeline</h1>
        <p className="mt-0.5 text-sm text-overview-text-secondary">Histórico das decisões e ações de Growth deste cliente.</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1" role="group" aria-label="Filtrar por categoria">
        {CLIENT_TIMELINE_CATEGORY_OPTIONS.map((option) => (
          <Link
            key={option}
            href={pageHref({ category: option })}
            scroll={false}
            aria-pressed={category === option}
            className={
              category === option
                ? "rounded-md bg-brand px-3 py-1 text-sm font-medium text-white"
                : "rounded-md px-3 py-1 text-sm text-overview-text-secondary hover:text-overview-text-primary"
            }
          >
            {CLIENT_TIMELINE_CATEGORY_LABEL[option]}
          </Link>
        ))}
      </div>

      {groups.length > 0 ? (
        <div className="mt-4 flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group.dayLabel}>
              <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">{group.dayLabel}</p>
              <ul className="flex flex-col">
                {group.rows.map((row) => (
                  <ClientTimelineEventRow key={row.id} row={row} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4">
          <EmptyState>
            {category === "todos" ? "Nenhum evento registrado para este cliente ainda." : "Nenhum evento nesta categoria."}
          </EmptyState>
        </div>
      )}

      {(page > 0 || hasMore) && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          {page > 0 && (
            <Link href={pageHref({ page: page - 1 })} scroll={false} className="font-medium text-brand hover:underline">
              Mais recentes
            </Link>
          )}
          {hasMore && (
            <Link href={pageHref({ page: page + 1 })} scroll={false} className="font-medium text-brand hover:underline">
              Carregar mais
            </Link>
          )}
        </div>
      )}
    </WorkspaceContainer>
  );
}

const CATEGORY_DOT_CLASS: Record<ClientTimelineRow["category"], string> = {
  planejamento: "bg-brand",
  operacao: "bg-overview-text-muted",
  demandas: "bg-lime",
  performance: "bg-overview-success",
  conta: "bg-overview-text-muted",
};

/** Uma linha da Timeline do cliente — mesmo divisor discreto de `/timeline`
 * (Agência), nunca um card independente com borda (seção 20 do pedido:
 * "não quero uma sequência de cards gigantes"). `reviewPresentation`
 * presente ⇒ hierarquia Diagnóstico/Ações/Observação (mesma de sempre);
 * ausente ⇒ par label/detail genérico. */
function ClientTimelineEventRow({ row }: { row: ClientTimelineRow }) {
  return (
    <li className="flex flex-col gap-0.5 border-b border-overview-border/60 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_DOT_CLASS[row.category]}`} aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-wide text-overview-text-muted">{CLIENT_TIMELINE_CATEGORY_LABEL[row.category]}</span>
        <span className="text-overview-text-muted" aria-hidden="true">
          ·
        </span>
        <span className="tabular-nums text-xs text-overview-text-muted">{formatTimeOnly(row.occurredAt)}</span>
      </div>

      {row.category === "performance" ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-overview-text-secondary">
          {row.performanceTone === "atencao" ? "Atenção" : "Positivo"}
        </p>
      ) : (
        row.actorName && <p className="mt-0.5 text-xs text-overview-text-secondary">{row.actorName}</p>
      )}

      {row.reviewPresentation ? (
        <div className="mt-1 flex flex-col gap-0.5">
          <p className="text-sm font-medium text-overview-text-primary">{row.reviewPresentation.headline}</p>
          {row.reviewPresentation.actionsLine && <p className="text-sm text-overview-text-secondary">{row.reviewPresentation.actionsLine}</p>}
          {row.reviewPresentation.notes && <p className="mt-0.5 text-sm italic text-overview-text-secondary">{row.reviewPresentation.notes}</p>}
        </div>
      ) : (
        <p className="mt-1 text-sm text-overview-text-primary">
          {row.label}
          {row.detail ? <span className="text-overview-text-secondary"> · {row.detail}</span> : null}
        </p>
      )}

      {row.link && (
        <Link href={row.link.href} className="mt-0.5 text-xs font-medium text-brand hover:underline">
          {row.link.label}
        </Link>
      )}
    </li>
  );
}
