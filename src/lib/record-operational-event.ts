import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  OperationalEntityType,
  OperationalEventSource,
  OperationalEventType,
} from "@/lib/supabase/database.types";
import type { CurrentProfile } from "@/lib/auth";

/**
 * Serviço central de registro (Etapa 56, seção 6 do pedido) — único ponto
 * que grava em `operational_events`. Nenhum componente/action deve montar o
 * insert manualmente: sempre passar por aqui, pra manter a validação de
 * `event_type` (via `OperationalEventType`, nunca string solta) e a
 * resolução do ator num só lugar.
 *
 * O servidor sempre resolve `actor`/`organizationId` a partir da sessão
 * autenticada (nunca aceitos de input do navegador) — quem chama esta
 * função só decide O QUÊ aconteceu (event_type/entity/metadata), nunca QUEM
 * fez nem em que organização, pra deixar impossível forjar isso por engano.
 */
export interface OperationalEventActor {
  /** team_members.id de quem está logado — pode ser null só pra eventos
   * futuros gerados pelo sistema (source = "system"), nunca pra ações
   * humanas. */
  teamMemberId: string | null;
  authUserId: string | null;
  organizationId: string;
}

export function actorFromProfile(profile: CurrentProfile): OperationalEventActor {
  return { teamMemberId: profile.id, authUserId: profile.authUserId, organizationId: profile.organizationId };
}

export interface RecordOperationalEventInput {
  eventType: OperationalEventType;
  entityType: OperationalEntityType;
  entityId: string;
  clientId?: string | null;
  sprintId?: string | null;
  /** Momento de negócio do acontecimento — default: agora. Nunca assumir
   * que é igual a `recorded_at` (o banco grava os dois separadamente). */
  occurredAt?: string;
  expectedAt?: string | null;
  completedAt?: string | null;
  wasOnTime?: boolean | null;
  delaySeconds?: number | null;
  source?: OperationalEventSource;
  correlationId?: string | null;
  /** Convenção do projeto pra evitar duplicata por duplo clique/retry:
   * `${event_type}:${entity_id}:${versão}` — ver unique index parcial em
   * `operational_events_idempotency_key_unique`. Omitir quando o evento não
   * tiver risco relevante de duplicação. */
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordOperationalEvent(
  supabase: SupabaseClient<Database>,
  actor: OperationalEventActor,
  input: RecordOperationalEventInput,
): Promise<void> {
  const { error } = await supabase.from("operational_events").insert({
    organization_id: actor.organizationId,
    event_type: input.eventType,
    actor_team_member_id: actor.teamMemberId,
    actor_auth_user_id: actor.authUserId,
    client_id: input.clientId ?? null,
    sprint_id: input.sprintId ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId,
    occurred_at: input.occurredAt,
    expected_at: input.expectedAt ?? null,
    completed_at: input.completedAt ?? null,
    was_on_time: input.wasOnTime ?? null,
    delay_seconds: input.delaySeconds ?? null,
    source: input.source ?? "server",
    correlation_id: input.correlationId ?? null,
    idempotency_key: input.idempotencyKey ?? null,
    metadata: input.metadata ?? {},
  });

  // Um evento é telemetria, nunca deve derrubar a ação principal: se a
  // mutação de domínio já aconteceu, ela continua valendo mesmo que o
  // registro do evento falhe (ex.: conflito de idempotency_key num retry
  // legítimo). Só logamos no servidor — nunca expor isso ao usuário.
  if (error) {
    console.error(`[operational_events] falha ao registrar "${input.eventType}":`, error.message);
  }
}
