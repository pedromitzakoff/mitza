import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { formatTimeOnly, formatTimelineDayLabel } from "@/lib/format";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { fetchAgencyTimeline, resolveAgencyTimelineType, type AgencyTimelineRow } from "@/lib/agency-timeline";
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
 * restrito por carteira atribuída), Gestor/Cliente/Tipo são recortes de
 * conveniência, nunca uma permissão. Comentários e sincronização ficaram
 * de fora desta v1 (decisão explícita — nenhum dos dois entra em
 * `operational_events` hoje).
 *
 * Etapa "Histórico de Decisões Operacionais": além do filtro novo por Tipo
 * (Todos/Otimizações/Reports/Outros), o layout de cada linha deixou de ser
 * um card grande com borda pra cada evento — agora é uma lista editorial,
 * agrupada por dia (como já era), com divisores leves em vez de cartões
 * independentes (seção 9 do pedido: "precisa funcionar bem com dezenas de
 * eventos por dia"). Revisões de conta (`account_review_recorded`) ganham
 * hierarquia própria (Diagnóstico → Ações → Observação, via
 * `row.reviewPresentation`) em vez do rótulo genérico "Analisou a conta"
 * repetindo o resultado da revisão — ver `lib/agency-timeline.ts`.
 */
export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; client?: string; type?: string; page?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const params = await searchParams;
  const actorId = params.actor ?? "todos";
  const clientId = params.client ?? "todos";
  const type = resolveAgencyTimelineType(params.type);
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
      { actorId: actorId !== "todos" ? actorId : null, clientId: clientId !== "todos" ? clientId : null, type },
      page,
    ),
  ]);

  const hasAnyFilter = actorId !== "todos" || clientId !== "todos" || type !== "todos";
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
    if (type !== "todos") next.set("type", type);
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

      <TimelineFilterBar actorId={actorId} clientId={clientId} type={type} actors={actors ?? []} clients={clients ?? []} />

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

/**
 * Uma linha da Timeline — divisor leve em vez de card independente com
 * borda (seção 9 do pedido: "isso gera muito espaço vertical e pouca
 * densidade de informação"). Cliente em maior destaque, gestor abaixo em
 * tom secundário, horário como informação secundária ao lado do cliente
 * (nunca a primeira coisa lida na linha). `reviewPresentation` presente ⇒
 * hierarquia Diagnóstico/Ações/Observação (seção 8); ausente ⇒ o par
 * label/detail genérico de sempre (reports, tarefas, orçamento, etc. —
 * nenhum desses tipos muda nesta etapa).
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
      </div>

      <p className="text-xs text-overview-text-secondary">{row.actorName ?? "Sistema"}</p>

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
    </li>
  );
}
