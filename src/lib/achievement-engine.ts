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
import { AGENCY_RULES, type AgencyAchievementContext } from "@/lib/achievement-agency-rules";
import { PERSON_RULES, type PersonAchievementContext } from "@/lib/achievement-person-rules";
import type { AchievementCandidate } from "@/lib/achievement-types";

/**
 * Orquestração do motor de Conquistas — a única função que liga leitura
 * (`achievement-metrics.ts`), avaliação (regras puras) e persistência
 * (`record_achievement_event`). `evaluateAchievementsForDate` é o núcleo,
 * parametrizado por uma data de avaliação explícita — nunca depende
 * internamente de "ontem" (Etapa "Backfill 30 dias": `evaluateAchievements({
 * evaluationDate })` em vez do motor decidir a data sozinho). Duas portas
 * de entrada:
 *
 * - `runAchievementEvaluation` — cron diário (`/api/cron/evaluate-achievements`),
 *   sempre "ontem". Nenhuma mudança de comportamento nesta etapa.
 * - `scripts/backfill-achievements.ts` — execução manual explícita, chama
 *   `evaluateAchievementsForDate` uma vez por dia dos últimos 30 dias
 *   fechados, em ordem cronológica. MESMAS regras, MESMA função — nenhuma
 *   segunda versão.
 *
 * Isolamento (salvaguarda de aprovação nº3 — "falha do motor não pode
 * afetar sync nem operação"): cada cliente/organização/pessoa é avaliado
 * dentro do seu próprio `try/catch` — um erro num cliente nunca aborta os
 * demais, e o motor inteiro roda numa rota própria, sem tocar nas rotas de
 * sincronização existentes.
 *
 * Reprocessamento (salvaguarda nº2): rodar esta função de novo pra mesma
 * data nunca duplica nada — cada candidato vira uma `idempotency_key`
 * determinística (`achievement:{scope}:{subjectId}:{type}:{windowKey}`),
 * e a RPC já faz `ON CONFLICT ... DO NOTHING`. Isso vale igualmente pro
 * backfill: rodar os mesmos 30 dias de novo (ou dez vezes) produz
 * exatamente os mesmos eventos, nunca duplicados.
 */

export interface CreatedAchievementSummary {
  occurredOnDate: string;
  scope: AchievementCandidate["scope"];
  type: string;
  headline: string;
}

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
  /** Só as que foram REALMENTE inseridas nesta execução (não as que já
   * existiam por idempotência) — pra auditoria/validação manual. */
  createdAchievements: CreatedAchievementSummary[];
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
    createdAchievements: [],
  };
}

function subjectIdFor(candidate: AchievementCandidate, organizationId: string): string {
  if (candidate.scope === "client") return candidate.clientId ?? "unknown-client";
  if (candidate.scope === "person") return candidate.actorTeamMemberId ?? "unknown-person";
  return organizationId;
}

/** Exportada só pra teste (`scripts/test-achievement-backfill.ts`) — prova
 * de determinismo sem precisar de banco: o mesmo candidato sempre produz a
 * mesma chave, é essa determinística que garante reprocessar (rerun
 * manual, backfill rodado duas vezes) nunca duplicar (a garantia real —
 * `ON CONFLICT ... DO NOTHING` — é no banco, mesmo padrão já usado por
 * `complete_task_and_record_event`). */
export function buildIdempotencyKey(candidate: AchievementCandidate, organizationId: string): string {
  return `achievement:${candidate.scope}:${subjectIdFor(candidate, organizationId)}:${candidate.type}:${candidate.windowKey}`;
}

/** Persiste 1 candidato — devolve `true` só quando REALMENTE inseriu (um
 * `false` significa que a `idempotency_key` já existia, ou seja, essa
 * conquista já tinha sido registrada antes; nunca um erro). */
async function persistCandidate(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  candidate: AchievementCandidate,
): Promise<boolean> {
  const idempotencyKey = buildIdempotencyKey(candidate, organizationId);

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
      source: candidate.source ?? null,
    },
  });

  if (error) throw new Error(`record_achievement_event falhou (${idempotencyKey}): ${error.message}`);
  return Boolean((data as { inserted?: boolean } | null)?.inserted);
}

export interface EvaluateAchievementsOptions {
  /** Regras de Agência a rodar — `AGENCY_RULES` (todas) por padrão. O
   * backfill passa `AGENCY_BACKFILL_SAFE_RULES` (exclui as que dependem de
   * estado sem histórico — ver `achievement-agency-rules.ts`). Mesmas
   * funções em ambos os casos, nunca uma segunda implementação. */
  agencyRules?: ((ctx: AgencyAchievementContext) => AchievementCandidate | null)[];
  personRules?: ((ctx: PersonAchievementContext) => AchievementCandidate | null)[];
}

/** Núcleo do motor — avalia TODOS os clientes/organizações/pessoas pra UMA
 * data explícita (`evaluationDate`). Chamado 1x pelo cron diário (sempre
 * "ontem") e 30x pelo backfill (uma vez por dia da janela, em ordem
 * cronológica) — sem diferença de comportamento entre os dois, exceto o
 * subconjunto de regras de Agência quando `options.agencyRules` é passado. */
export async function evaluateAchievementsForDate(
  supabase: SupabaseClient<Database>,
  evaluationDate: string,
  options: EvaluateAchievementsOptions = {},
): Promise<AchievementRunSummary> {
  const agencyRules = options.agencyRules ?? AGENCY_RULES;
  const personRules = options.personRules ?? PERSON_RULES;
  const summary = emptySummary(evaluationDate);

  function recordCreated(candidate: AchievementCandidate) {
    summary.createdAchievements.push({
      occurredOnDate: candidate.occurredOnDate,
      scope: candidate.scope,
      type: candidate.type,
      headline: candidate.headline,
    });
  }

  // Cliente
  const clients = await listEligibleClientsForAchievements(supabase);
  for (const client of clients) {
    try {
      if (!client.organizationId) {
        summary.clientsSkippedNoOrganization++;
        continue;
      }

      const { context, syncTrust } = await buildClientAchievementContext(supabase, client, evaluationDate);
      summary.clientsEvaluated++;

      if (!syncTrust.trusted) {
        summary.clientsSkippedUntrustedSync++;
        continue;
      }

      for (const rule of CLIENT_RULES) {
        const candidate = rule(context);
        if (!candidate) continue;
        // Etapa "Conquistas Auditáveis": `source` (proveniência/sincronização)
        // é capturado uma única vez por cliente (`buildClientAchievementContext`),
        // nunca por regra individual — anexado aqui, no único lugar que já
        // tem acesso a `context.sourceInfo` E a todo candidato do cliente.
        candidate.source = context.sourceInfo ?? undefined;
        summary.clientCandidates++;
        if (await persistCandidate(supabase, client.organizationId, candidate)) {
          summary.clientInserted++;
          recordCreated(candidate);
        }
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
      const agencyContext = await fetchAgencyMetrics(supabase, organizationId, evaluationDate);
      for (const rule of agencyRules) {
        const candidate = rule(agencyContext);
        if (!candidate) continue;
        summary.agencyCandidates++;
        if (await persistCandidate(supabase, organizationId, candidate)) {
          summary.agencyInserted++;
          recordCreated(candidate);
        }
      }
    } catch (err) {
      summary.errors.push(`agência ${organizationId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const members = await listEligibleTeamMembersForAchievements(supabase, organizationId);
    for (const member of members) {
      try {
        const personContext = await fetchPersonMetrics(supabase, member, evaluationDate);
        summary.personEvaluated++;

        for (const rule of personRules) {
          const candidate = rule(personContext);
          if (!candidate) continue;
          summary.personCandidates++;
          if (await persistCandidate(supabase, organizationId, candidate)) {
            summary.personInserted++;
            recordCreated(candidate);
          }
        }
      } catch (err) {
        summary.errors.push(`pessoa ${member.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return summary;
}

/** Cron diário — sempre avalia só o dia fechado mais recente (ontem, fuso
 * da agência). Nunca varre retroativamente (baseline serve só de
 * comparação dentro de cada regra, ver `achievement-client-rules.ts`). */
export async function runAchievementEvaluation(now: Date = new Date()): Promise<AchievementRunSummary> {
  const supabase = createAdminClient();
  const yesterday = addDays(todayDateString(now), -1);
  return evaluateAchievementsForDate(supabase, yesterday);
}
