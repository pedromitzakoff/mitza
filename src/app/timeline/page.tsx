import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { formatTimeOnly, formatTimelineDayLabel } from "@/lib/format";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { fetchAgencyTimeline, type AgencyTimelineRow } from "@/lib/agency-timeline";
import { TimelineFilterBar } from "./timeline-filter-bar";

/**
 * `/timeline` — Timeline Geral da Agência (Auditoria + Etapa "Tríade da
 * Navegação Principal"): responde "o que aconteceu na operação da agência
 * hoje/nesta semana?", terceiro pilar ao lado de Visão Geral ("como está a
 * agência?") e Operação ("qual cliente precisa de atenção?"). Reaproveita
 * 100% `operational_events` — nenhuma tabela, cron ou tracking novo (ver
 * `lib/agency-timeline.ts`). Mesmo modelo de acesso de sempre: qualquer
 * usuário autenticado vê a carteira inteira (RLS de `operational_events` é
 * só por organização, igual a `clients`/Dashboard/Sprints/Operação — nunca
 * restrito por carteira atribuída), Gestor/Cliente são recortes de
 * conveniência, nunca uma permissão. Comentários e sincronização ficaram
 * de fora desta v1 (decisão explícita — nenhum dos dois entra em
 * `operational_events` hoje).
 */
export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; client?: string; page?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const params = await searchParams;
  const actorId = params.actor ?? "todos";
  const clientId = params.client ?? "todos";
  const page = Math.max(0, Number(params.page) || 0);

  const supabase = await createSupabaseClient();

  const [actors, clients, { rows, hasMore }] = await Promise.all([
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    requireQuery(
      supabase.from("clients").select("id, name").is("deleted_at", null).eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS).order("name"),
      "clients",
    ),
    fetchAgencyTimeline(
      supabase,
      profile.organizationId,
      { actorId: actorId !== "todos" ? actorId : null, clientId: clientId !== "todos" ? clientId : null },
      page,
    ),
  ]);

  const hasAnyFilter = actorId !== "todos" || clientId !== "todos";
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

  function pageHref(p: number) {
    const next = new URLSearchParams();
    if (actorId !== "todos") next.set("actor", actorId);
    if (clientId !== "todos") next.set("client", clientId);
    if (p > 0) next.set("page", String(p));
    const query = next.toString();
    return query ? `/timeline?${query}` : "/timeline";
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Timeline</h1>
        <p className="text-sm text-muted-foreground">O que aconteceu na operação da agência.</p>
      </div>

      <TimelineFilterBar actorId={actorId} clientId={clientId} actors={actors ?? []} clients={clients ?? []} />

      {groups.length > 0 ? (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.dayLabel}>
              <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">{group.dayLabel}</p>
              <ul className="flex flex-col gap-1">
                {group.rows.map((row) => (
                  <li key={row.id} className="rounded-lg border border-border px-3.5 py-2 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="shrink-0 tabular-nums text-overview-text-muted">{formatTimeOnly(row.occurredAt)}</span>
                      <span className="font-medium text-foreground">{row.actorName ?? "Sistema"}</span>
                      {row.clientName && (
                        <>
                          <span className="text-overview-text-muted">·</span>
                          <span className="text-foreground">{row.clientName}</span>
                        </>
                      )}
                    </div>
                    <p className="mt-0.5 text-overview-text-secondary">
                      {row.label}
                      {row.detail ? ` · ${row.detail}` : ""}
                    </p>
                  </li>
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
            <Link href={pageHref(page - 1)} scroll={false} className="font-medium text-brand hover:underline">
              Mais recentes
            </Link>
          )}
          {hasMore && (
            <Link href={pageHref(page + 1)} scroll={false} className="font-medium text-brand hover:underline">
              Ver mais antigos
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
