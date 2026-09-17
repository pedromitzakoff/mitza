import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Etapa "Equipe — Fase 2: Histórico Temporal de Responsabilidade" — camada
 * de leitura de `client_manager_assignments` (`supabase/client-manager-assignments.sql`).
 * Única fonte de verdade pra responder "quem era responsável por este
 * cliente NUMA DATA" — `clients.primary_manager_id` continua a fonte do
 * responsável ATUAL (nunca duplicada aqui: a tabela é sempre derivada dele,
 * via trigger, nunca escrita por código de aplicação).
 *
 * Meio-aberto por convenção: um período cobre `[startedAt, endedAt)` —
 * `endedAt === null` significa "ainda aberto" (o gestor ATUAL). No instante
 * exato de uma troca, o período antigo termina e o novo começa no MESMO
 * timestamp — por isso toda comparação usa `<` estrito no limite superior
 * (nunca `<=`), garantindo que aquele instante pertence só ao período NOVO.
 *
 * Backfill (ver o `.sql`): todo cliente com gestor no momento do deploy
 * desta etapa ganhou 1 período aberto com `startedAt` = instante do
 * deploy — NUNCA uma data anterior inventada. Perguntar por uma data
 * ANTES do deploy sempre devolve `null`/lista vazia pra esse cliente, nunca
 * um palpite.
 */

export interface ClientManagerAssignmentPeriod {
  id: string;
  clientId: string;
  managerId: string | null;
  startedAt: string;
  endedAt: string | null;
}

function toPeriod(row: { id: string; client_id: string; manager_id: string | null; started_at: string; ended_at: string | null }): ClientManagerAssignmentPeriod {
  return {
    id: row.id,
    clientId: row.client_id,
    managerId: row.manager_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

/** Toda a linha do tempo de UM cliente, do primeiro período ao mais
 * recente — "durante quais períodos {gestor} foi responsável pelo cliente
 * X?" filtra o resultado por `managerId` depois de buscar. */
export async function fetchAssignmentPeriodsForClient(supabase: Supabase, clientId: string): Promise<ClientManagerAssignmentPeriod[]> {
  const rows = await requireQuery(
    supabase
      .from("client_manager_assignments")
      .select("id, client_id, manager_id, started_at, ended_at")
      .eq("client_id", clientId)
      .order("started_at", { ascending: true }),
    "client_manager_assignments:by-client",
  );
  return rows.map(toPeriod);
}

/** Toda a linha do tempo de UM gestor, através de TODOS os clientes que já
 * teve — base pra "quais clientes estavam com {gestor} em {período}?"/"qual
 * era a carteira dele numa data?". */
export async function fetchAssignmentPeriodsForManager(supabase: Supabase, managerId: string): Promise<ClientManagerAssignmentPeriod[]> {
  const rows = await requireQuery(
    supabase
      .from("client_manager_assignments")
      .select("id, client_id, manager_id, started_at, ended_at")
      .eq("manager_id", managerId)
      .order("started_at", { ascending: true }),
    "client_manager_assignments:by-manager",
  );
  return rows.map(toPeriod);
}

/** `true` se `atIso` cai dentro de `[period.startedAt, period.endedAt)` —
 * função pura, testável sem Supabase. `endedAt === null` = período ainda
 * aberto, cobre qualquer `atIso` a partir de `startedAt` (inclusive "no
 * futuro", já que não há fim conhecido). */
export function isPeriodActiveAt(period: ClientManagerAssignmentPeriod, atIso: string): boolean {
  if (atIso < period.startedAt) return false;
  return period.endedAt === null || atIso < period.endedAt;
}

/** `true` se o período tem QUALQUER interseção com `[rangeStartIso,
 * rangeEndIso)` — usado pra "quais clientes estavam com {gestor} durante
 * {mês}?" (overlap, não "o mês inteiro"; mesmo espírito de "sprint que
 * atravessa mês" já usado em outras partes da plataforma). */
export function periodOverlapsRange(period: ClientManagerAssignmentPeriod, rangeStartIso: string, rangeEndIso: string): boolean {
  const endsAfterRangeStarts = period.endedAt === null || period.endedAt > rangeStartIso;
  const startsBeforeRangeEnds = period.startedAt < rangeEndIso;
  return endsAfterRangeStarts && startsBeforeRangeEnds;
}

/** O período ativo numa lista (já ordenada ou não) numa data — no máximo 1
 * resultado por construção (a tabela nunca tem 2 períodos abertos pro
 * mesmo cliente, e períodos fechados de um mesmo cliente nunca se
 * sobrepõem — ver `client-manager-assignments.sql`). `undefined` = nenhum
 * período cobre essa data (cliente sem gestor naquele momento, ou a data é
 * anterior a qualquer dado confiável). */
export function findActivePeriodAt(periods: ClientManagerAssignmentPeriod[], atIso: string): ClientManagerAssignmentPeriod | undefined {
  return periods.find((period) => isPeriodActiveAt(period, atIso));
}

/**
 * "Quem era responsável pelo cliente X em determinada data?" — `null` =
 * ninguém (cliente sem gestor naquele momento, incluindo antes do deploy
 * desta etapa, quando não existe dado confiável nenhum).
 */
export async function resolveClientManagerAt(supabase: Supabase, clientId: string, atIso: string): Promise<string | null> {
  const periods = await fetchAssignmentPeriodsForClient(supabase, clientId);
  return findActivePeriodAt(periods, atIso)?.managerId ?? null;
}

/** "Qual era a carteira de {gestor} numa data específica?" — lista de
 * `clientId`, sem duplicados (um gestor nunca tem 2 períodos abertos pro
 * MESMO cliente ao mesmo tempo, mas a lista final ainda passa por `Set`
 * por robustez). */
export async function resolveManagerPortfolioAt(supabase: Supabase, managerId: string, atIso: string): Promise<string[]> {
  const periods = await fetchAssignmentPeriodsForManager(supabase, managerId);
  const clientIds = periods.filter((period) => isPeriodActiveAt(period, atIso)).map((period) => period.clientId);
  return Array.from(new Set(clientIds));
}

/** "Quais clientes estavam com {gestor} durante {intervalo}?" (ex.: um mês
 * inteiro) — overlap, não posse do intervalo inteiro (ver `periodOverlapsRange`). */
export async function resolveManagerPortfolioDuringRange(
  supabase: Supabase,
  managerId: string,
  rangeStartIso: string,
  rangeEndIso: string,
): Promise<string[]> {
  const periods = await fetchAssignmentPeriodsForManager(supabase, managerId);
  const clientIds = periods.filter((period) => periodOverlapsRange(period, rangeStartIso, rangeEndIso)).map((period) => period.clientId);
  return Array.from(new Set(clientIds));
}
