import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { formatTimeOnly, formatTimelineDayLabel } from "@/lib/format";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { fetchAchievements, fetchClientAchievementsMonthSummary, type AchievementRow } from "@/lib/achievements-data";
import { familyLabelFor, ACHIEVEMENT_SCOPE_LABEL, CLIENT_FAMILY_LABEL, AGENCY_FAMILY_LABEL, PERSON_FAMILY_LABEL } from "@/lib/achievement-labels";
import type { AchievementScope } from "@/lib/achievement-types";
import { AchievementsFilterBar } from "./achievements-filter-bar";

/**
 * `/achievements` — Conquistas: "o que merece ser comemorado", quarto
 * pilar ao lado de Visão Geral/Operação/Timeline (Auditoria "Sistema de
 * Conquistas"). Só LÊ `operational_events` já persistidos
 * (`event_type = 'achievement_unlocked'`) — nunca recalcula performance na
 * renderização (salvaguarda de aprovação nº4); toda decisão já aconteceu
 * no cron (`achievement-engine.ts`). Mesmo modelo de acesso de sempre:
 * qualquer usuário autenticado vê a carteira/agência/equipe inteira.
 */
export default async function AchievementsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; client?: string; actor?: string; family?: string; page?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const params = await searchParams;
  const scope: AchievementScope = params.tab === "agency" ? "agency" : params.tab === "person" ? "person" : "client";
  const clientId = params.client ?? "todos";
  const actorId = params.actor ?? "todos";
  const familyId = params.family ?? "todos";
  const page = Math.max(0, Number(params.page) || 0);

  const supabase = await createSupabaseClient();
  const now = new Date();

  const [clients, teamMembers, { rows, hasMore }, monthSummary] = await Promise.all([
    requireQuery(
      supabase.from("clients").select("id, name").is("deleted_at", null).eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS).order("name"),
      "clients",
    ),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
    fetchAchievements(
      supabase,
      profile.organizationId,
      {
        scope,
        clientId: scope === "client" && clientId !== "todos" ? clientId : null,
        actorTeamMemberId: scope === "person" && actorId !== "todos" ? actorId : null,
        family: familyId !== "todos" ? familyId : null,
      },
      page,
    ),
    scope === "client"
      ? fetchClientAchievementsMonthSummary(supabase, profile.organizationId, monthRangeFor(now))
      : Promise.resolve(null),
  ]);

  const familyOptions = scope === "client" ? CLIENT_FAMILY_LABEL : scope === "agency" ? AGENCY_FAMILY_LABEL : PERSON_FAMILY_LABEL;

  const groups: { dayLabel: string; rows: AchievementRow[] }[] = [];
  for (const row of rows) {
    const dayLabel = formatTimelineDayLabel(row.occurredAt, now);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.dayLabel === dayLabel) lastGroup.rows.push(row);
    else groups.push({ dayLabel, rows: [row] });
  }

  function pageHref(overrides: { tab?: string; client?: string; actor?: string; family?: string; page?: number }) {
    const next = new URLSearchParams();
    const nextScope = overrides.tab ?? params.tab ?? "client";
    if (nextScope !== "client") next.set("tab", nextScope);

    const nextClient = overrides.client ?? clientId;
    if (nextScope === "client" && nextClient !== "todos") next.set("client", nextClient);

    const nextActor = overrides.actor ?? actorId;
    if (nextScope === "person" && nextActor !== "todos") next.set("actor", nextActor);

    const nextFamily = overrides.family ?? familyId;
    if (nextFamily !== "todos") next.set("family", nextFamily);

    const nextPage = overrides.page ?? page;
    if (nextPage > 0) next.set("page", String(nextPage));

    const query = next.toString();
    return query ? `/achievements?${query}` : "/achievements";
  }

  const hasAnyFilter = (scope === "client" && clientId !== "todos") || (scope === "person" && actorId !== "todos") || familyId !== "todos";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Conquistas</h1>
        <p className="text-sm text-muted-foreground">O que merece ser comemorado.</p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-2">
        {(["client", "agency", "person"] as const).map((tabScope) => (
          <Link
            key={tabScope}
            href={pageHref({ tab: tabScope, client: "todos", actor: "todos", family: "todos", page: 0 })}
            scroll={false}
            className={
              scope === tabScope
                ? "rounded-md bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand"
                : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {ACHIEVEMENT_SCOPE_LABEL[tabScope]}
          </Link>
        ))}
      </div>

      {monthSummary && monthSummary.total > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border px-3.5 py-2 text-sm text-overview-text-secondary">
          <span className="font-medium text-foreground">Este mês</span>
          <span>{monthSummary.total} conquistas</span>
          <span>{monthSummary.distinctClients} clientes</span>
          <span>{monthSummary.records} recordes</span>
          <span>{monthSummary.goalsReached} metas atingidas</span>
        </div>
      )}

      <AchievementsFilterBar
        scope={scope}
        clientId={clientId}
        actorId={actorId}
        familyId={familyId}
        clients={clients ?? []}
        teamMembers={teamMembers ?? []}
        familyOptions={familyOptions}
      />

      {groups.length > 0 ? (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.dayLabel}>
              <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">{group.dayLabel}</p>
              <ul className="flex flex-col gap-1">
                {group.rows.map((row) => (
                  <li key={row.id} className="rounded-lg border border-border px-3.5 py-2 text-sm">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-overview-text-muted">
                      🏆 {familyLabelFor(row.scope, row.family)}
                    </p>
                    <p className="mt-0.5 font-medium text-foreground">{row.headline}</p>
                    {row.detail && <p className="mt-0.5 text-overview-text-secondary">{row.detail}</p>}
                    <p className="mt-1 text-xs text-overview-text-muted">
                      {formatTimelineDayLabel(row.occurredAt, now)} · {formatTimeOnly(row.occurredAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>
          {hasAnyFilter ? "Nenhuma conquista encontrada com esse filtro." : "Nenhuma conquista registrada neste período."}
          {!hasAnyFilter && (
            <span className="mt-1 block text-xs text-overview-text-muted">
              Novos marcos aparecerão aqui conforme clientes, agência e equipe atingirem resultados relevantes.
            </span>
          )}
        </EmptyState>
      )}

      {(page > 0 || hasMore) && (
        <div className="flex items-center gap-2 text-sm">
          {page > 0 && (
            <Link href={pageHref({ page: page - 1 })} scroll={false} className="font-medium text-brand hover:underline">
              Mais recentes
            </Link>
          )}
          {hasMore && (
            <Link href={pageHref({ page: page + 1 })} scroll={false} className="font-medium text-brand hover:underline">
              Ver mais antigos
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function monthRangeFor(now: Date): { firstDay: string; lastDay: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { firstDay, lastDay };
}
