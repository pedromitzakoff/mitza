import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayDateString } from "@/lib/today";
import { addDays } from "@/lib/achievement-dates";
import {
  buildClientAchievementContext,
  fetchAgencyMetrics,
  fetchPersonMetrics,
  listEligibleClientsForAchievements,
  listEligibleTeamMembersForAchievements,
  listOrganizationIds,
} from "@/lib/achievement-metrics";
import { CLIENT_RULES } from "@/lib/achievement-client-rules";
import { AGENCY_RULES } from "@/lib/achievement-agency-rules";
import { PERSON_RULES } from "@/lib/achievement-person-rules";
import type { AchievementCandidate } from "@/lib/achievement-types";

/**
 * Orquestração do motor de Conquistas — a única função que liga leitura
 * (`achievement-metrics.ts`), avaliação (regras puras) e persistência
 * (`record_achievement_event`). Chamada 1x/dia pelo cron
 * `/api/cron/evaluate-achievements`, sempre com o client ADMIN (nunca
 * depende de sessão de usuário).
 *
 * Isolamento (salvaguarda de aprovação nº3 — "falha do motor não pode
 * afetar sync nem operação"): cada cliente/organização/pessoa é avaliado
 * dentro do seu próprio `try/catch` — um erro num cliente nunca aborta os
 * demais, e o motor inteiro roda numa rota própria, sem tocar nas rotas de
 * sincronização existentes.
 *
 * Reprocessamento (salvaguarda nº2): rodar esta função de novo pro mesmo
 * dia nunca duplica nada — cada candidato vira uma `idempotency_key`
 * determinística (`achievement:{scope}:{subjectId}:{type}:{windowKey}`),
 * e a RPC já faz `ON CONFLICT ... DO NOTHING`.
 */

export interface AchievementRunSummary {
  evaluatedOnDate: string;
  clientsEvaluated: number;
  clientsSkippedUntrustedSync: number;
  clientsSkippedNoOrganization: number;
  clientCandidates: number;
  clientInserted: number;
  organizationsEvaluated: number;
  agencyCandidates: number;
  agencyInserted: number;
  personEvaluated: number;
  personCandidates: number;
  personInserted: number;
  errors: string[];
}

function emptySummary(evaluatedOnDate: string): AchievementRunSummary {
  return {
    evaluatedOnDate,
    clientsEvaluated: 0,
    clientsSkippedUntrustedSync: 0,
    clientsSkippedNoOrganization: 0,
    clientCandidates: 0,
    clientInserted: 0,
    organizationsEvaluated: 0,
    agencyCandidates: 0,
    agencyInserted: 0,
    personEvaluated: 0,
    personCandidates: 0,
    personInserted: 0,
    errors: [],
  };
}

function subjectIdFor(candidate: AchievementCandidate, organizationId: string): string {
  if (candidate.scope === "client") return candidate.clientId ?? "unknown-client";
  if (candidate.scope === "person") return candidate.actorTeamMemberId ?? "unknown-person";
  return organizationId;
}

/** Persiste 1 candidato — devolve `true` só quando REALMENTE inseriu (um
 * `false` significa que a `idempotency_key` já existia, ou seja, essa
 * conquista já tinha sido registrada antes; nunca um erro). */
async function persistCandidate(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  candidate: AchievementCandidate,
): Promise<boolean> {
  const idempotencyKey = `achievement:${candidate.scope}:${subjectIdFor(candidate, organizationId)}:${candidate.type}:${candidate.windowKey}`;

  const { data, error } = await supabase.rpc("record_achievement_event", {
    p_organization_id: organizationId,
    p_client_id: candidate.clientId ?? null,
    p_actor_team_member_id: candidate.actorTeamMemberId ?? null,
    // Meio-dia no fuso fixo da agência (UTC-3, sem DST) — a conquista é um
    // marco do DIA (`occurredOnDate`), nunca de um instante; meio-dia evita
    // qualquer ambiguidade de fronteira ao converter de volta pra data
    // civil na leitura.
    p_occurred_at: `${candidate.occurredOnDate}T12:00:00-03:00`,
    p_idempotency_key: idempotencyKey,
    p_metadata: {
      achievement_type: candidate.type,
      scope: candidate.scope,
      family: candidate.family,
      severity: candidate.severity,
      client_name: candidate.clientName ?? null,
      headline: candidate.headline,
      detail: candidate.detail,
      metric: candidate.metric,
    },
  });

  if (error) throw new Error(`record_achievement_event falhou (${idempotencyKey}): ${error.message}`);
  return Boolean((data as { inserted?: boolean } | null)?.inserted);
}

export async function runAchievementEvaluation(now: Date = new Date()): Promise<AchievementRunSummary> {
  const supabase = createAdminClient();
  const yesterday = addDays(todayDateString(now), -1);
  const summary = emptySummary(yesterday);

  // Cliente
  const clients = await listEligibleClientsForAchievements(supabase);
  for (const client of clients) {
    try {
      if (!client.organizationId) {
        summary.clientsSkippedNoOrganization++;
        continue;
      }

      const { context, syncTrust } = await buildClientAchievementContext(supabase, client, yesterday);
      summary.clientsEvaluated++;

      if (!syncTrust.trusted) {
        summary.clientsSkippedUntrustedSync++;
        continue;
      }

      for (const rule of CLIENT_RULES) {
        const candidate = rule(context);
        if (!candidate) continue;
        summary.clientCandidates++;
        if (await persistCandidate(supabase, client.organizationId, candidate)) summary.clientInserted++;
      }
    } catch (err) {
      summary.errors.push(`cliente ${client.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Agência + Pessoa (por organização)
  const organizationIds = await listOrganizationIds(supabase);
  for (const organizationId of organizationIds) {
    summary.organizationsEvaluated++;

    try {
      const agencyContext = await fetchAgencyMetrics(supabase, organizationId, yesterday);
      for (const rule of AGENCY_RULES) {
        const candidate = rule(agencyContext);
        if (!candidate) continue;
        summary.agencyCandidates++;
        if (await persistCandidate(supabase, organizationId, candidate)) summary.agencyInserted++;
      }
    } catch (err) {
      summary.errors.push(`agência ${organizationId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const members = await listEligibleTeamMembersForAchievements(supabase, organizationId);
    for (const member of members) {
      try {
        const personContext = await fetchPersonMetrics(supabase, member, yesterday);
        summary.personEvaluated++;

        for (const rule of PERSON_RULES) {
          const candidate = rule(personContext);
          if (!candidate) continue;
          summary.personCandidates++;
          if (await persistCandidate(supabase, organizationId, candidate)) summary.personInserted++;
        }
      } catch (err) {
        summary.errors.push(`pessoa ${member.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return summary;
}
