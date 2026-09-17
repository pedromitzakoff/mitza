import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { formatTimelineDayLabel } from "@/lib/format";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { fetchAchievements, fetchClientAchievementsMonthSummary, type AchievementRow } from "@/lib/achievements-data";
import { ACHIEVEMENT_SCOPE_LABEL, CLIENT_FAMILY_LABEL, AGENCY_FAMILY_LABEL, PERSON_FAMILY_LABEL } from "@/lib/achievement-labels";
import type { AchievementLevel, AchievementScope } from "@/lib/achievement-types";

/** Etapa "Conquistas por Granularidade" — mesmo padrão de fallback seguro
 * já usado por `resolveOperationChannel`/`resolveAgencyTimelineType`: valor
 * ausente/inválido cai em `"todos"`, nunca um nível "chutado". Exportado só
 * pra teste. */
export function resolveAchievementLevel(paramValue: string | undefined): AchievementLevel | "todos" {
  return paramValue === "account" || paramValue === "campaign" || paramValue === "ad_set" || paramValue === "creative" ? paramValue : "todos";
}

/** Etapa "Filtros de Gestor/Objetivo" — mesmo padrão de
 * `resolveOperationGoal` (`operation/page.tsx`): valor ausente/inválido cai
 * em `"todos"`, nunca um objetivo "chutado". Valores aceitos são exatamente
 * os de `PerformanceGoal` (`lib/performance-goals.ts`) — a mesma fonte
 * canônica que `clients.performance_goal` já usa, nunca uma classificação
 * de objetivo nova/paralela. Exportado só pra teste. */
export function resolveAchievementGoal(paramValue: string | undefined): PerformanceGoal | "todos" {
  return paramValue === "leads" || paramValue === "sales" || paramValue === "followers" ? paramValue : "todos";
}
import { AchievementsFilterBar } from "./achievements-filter-bar";
import { AchievementsFeed } from "./achievements-feed";

/**
 * `/achievements` — Conquistas: "o que merece ser comemorado", quarto
 * pilar ao lado de Visão Geral/Operação/Timeline (Auditoria "Sistema de
 * Conquistas"). Só LÊ `operational_events` já persistidos
 * (`event_type = 'achievement_unlocked'`) — nunca recalcula performance na
 * renderização (salvaguarda de aprovação nº4); toda decisão já aconteceu
 * no cron (`achievement-engine.ts`). Mesmo modelo de acesso de sempre:
 * qualquer usuário autenticado vê a carteira/agência/equipe inteira.
 *
 * Etapa "Timeline 2.0": esta página deixou de ter uma entrada própria na
 * navegação (removida de `sidebar.tsx`) — os acontecimentos positivos que
 * ela mostra agora também aparecem em `/timeline` (família "Performance",
 * ver `lib/agency-timeline.ts`), sem precisar de um pilar de produto
 * próprio. Esta página em si (com seus filtros de Gestor/Objetivo/Tipo/
 * Nível, mais granulares que a Timeline) continua funcionando pra quem
 * acessar a rota diretamente — decisão deliberada de não substituir por um
 * redirect nesta etapa: fazer isso com segurança exigiria migrar toda a
 * suíte de testes estrutural desta página (`test-achievements-filters.ts`/
 * `test-achievements-granularity.ts`) numa mudança maior, deixada pra uma
 * etapa de limpeza futura (ver relatório da etapa).
 */
export default async function AchievementsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; client?: string; manager?: string; goal?: string; actor?: string; family?: string; level?: string; page?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const params = await searchParams;
  const scope: AchievementScope = params.tab === "agency" ? "agency" : params.tab === "person" ? "person" : "client";
  const clientId = params.client ?? "todos";
  // Gestor/Objetivo só existem na aba Cliente (Agência/Pessoa não têm
  // relação com `clients` — mesmo raciocínio já aplicado a `levelId`
  // abaixo): fora dela, ficam travados em "todos", nunca filtrando por
  // engano um escopo que não tem cliente nenhum.
  const managerId = scope === "client" ? (params.manager ?? "todos") : "todos";
  const goalId = scope === "client" ? resolveAchievementGoal(params.goal) : "todos";
  const actorId = params.actor ?? "todos";
  const familyId = params.family ?? "todos";
  const levelId = scope === "client" ? resolveAchievementLevel(params.level) : "todos";
  const page = Math.max(0, Number(params.page) || 0);

  const supabase = await createSupabaseClient();
  const now = new Date();

  const clientFilters = {
    clientId: scope === "client" && clientId !== "todos" ? clientId : null,
    managerId: managerId !== "todos" ? managerId : null,
    goal: goalId !== "todos" ? goalId : null,
    family: familyId !== "todos" ? familyId : null,
    level: levelId !== "todos" ? levelId : null,
  };

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
        actorTeamMemberId: scope === "person" && actorId !== "todos" ? actorId : null,
        ...clientFilters,
      },
      page,
    ),
    scope === "client"
      ? fetchClientAchievementsMonthSummary(supabase, profile.organizationId, monthRangeFor(now), clientFilters)
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

  function pageHref(overrides: {
    tab?: string;
    client?: string;
    manager?: string;
    goal?: string;
    actor?: string;
    family?: string;
    level?: string;
    page?: number;
  }) {
    const next = new URLSearchParams();
    const nextScope = overrides.tab ?? params.tab ?? "client";
    if (nextScope !== "client") next.set("tab", nextScope);

    const nextClient = overrides.client ?? clientId;
    if (nextScope === "client" && nextClient !== "todos") next.set("client", nextClient);

    const nextManager = overrides.manager ?? managerId;
    if (nextScope === "client" && nextManager !== "todos") next.set("manager", nextManager);

    const nextGoal = overrides.goal ?? goalId;
    if (nextScope === "client" && nextGoal !== "todos") next.set("goal", nextGoal);

    const nextActor = overrides.actor ?? actorId;
    if (nextScope === "person" && nextActor !== "todos") next.set("actor", nextActor);

    const nextFamily = overrides.family ?? familyId;
    if (nextFamily !== "todos") next.set("family", nextFamily);

    const nextLevel = overrides.level ?? levelId;
    if (nextScope === "client" && nextLevel !== "todos") next.set("level", nextLevel);

    const nextPage = overrides.page ?? page;
    if (nextPage > 0) next.set("page", String(nextPage));

    const query = next.toString();
    return query ? `/achievements?${query}` : "/achievements";
  }

  const hasAnyFilter =
    (scope === "client" && (clientId !== "todos" || managerId !== "todos" || goalId !== "todos" || levelId !== "todos")) ||
    (scope === "person" && actorId !== "todos") ||
    familyId !== "todos";

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
            href={pageHref({ tab: tabScope, client: "todos", manager: "todos", goal: "todos", actor: "todos", family: "todos", level: "todos", page: 0 })}
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
        managerId={managerId}
        goalId={goalId}
        actorId={actorId}
        familyId={familyId}
        levelId={levelId}
        clients={clients ?? []}
        teamMembers={teamMembers ?? []}
        familyOptions={familyOptions}
      />

      {groups.length > 0 ? (
        <AchievementsFeed groups={groups} now={now} />
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
