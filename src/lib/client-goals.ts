import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, GoalResultSourceDb } from "@/lib/supabase/database.types";
import type { PerformanceGoal } from "@/lib/performance-goals";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * Identidade + configuração de UM objetivo de performance de um cliente
 * (Etapa "Múltiplos Objetivos"). Deliberadamente pequeno — nunca guarda meta
 * mensal (isso continua em `monthly_budget_changes.result_type`, ver
 * `resolveClientMonthlyGoals`, `lib/client-plan.ts`). `isPrimary` é só
 * preferência de exibição em espaço compacto — nunca decide cálculo de
 * Saúde/Dashboard/Report/Conquistas (ver `supabase/client-goals.sql`).
 */
export interface ClientGoal {
  id: string;
  clientId: string;
  resultType: PerformanceGoal;
  /** Array vazio = sem restrição de canal (todos que o cliente usa). */
  channels: TrafficChannel[];
  isPrimary: boolean;
  resultSource: GoalResultSourceDb;
}

type ClientGoalRow = Database["public"]["Tables"]["client_goals"]["Row"];

function mapClientGoalRow(row: ClientGoalRow): ClientGoal {
  return {
    id: row.id,
    clientId: row.client_id,
    resultType: row.result_type,
    channels: (row.channels ?? []) as TrafficChannel[],
    isPrimary: row.is_primary,
    resultSource: row.result_source,
  };
}

/** Todos os objetivos configurados de um cliente, ordenados com o principal
 * primeiro (mesmo critério de exibição que qualquer card compacto usaria) e
 * depois por `result_type` pra ordem estável. Nunca filtra por canal —
 * quem consome decide o que fazer com `channels`. */
export async function listClientGoals(supabase: SupabaseClient<Database>, clientId: string): Promise<ClientGoal[]> {
  const { data, error } = await supabase.from("client_goals").select("*").eq("client_id", clientId);
  if (error) throw new Error(`Falha ao buscar objetivos do cliente ${clientId}: ${error.message}`);
  return (data ?? [])
    .map(mapClientGoalRow)
    .sort((a, b) => (a.isPrimary === b.isPrimary ? a.resultType.localeCompare(b.resultType) : a.isPrimary ? -1 : 1));
}

/** Busca em lote pra listagens (ex.: Operação/Dashboard, quando migrados) —
 * nunca N+1 de `listClientGoals`. */
export async function listClientGoalsForClients(
  supabase: SupabaseClient<Database>,
  clientIds: string[],
): Promise<Map<string, ClientGoal[]>> {
  const map = new Map<string, ClientGoal[]>();
  if (clientIds.length === 0) return map;

  const { data, error } = await supabase.from("client_goals").select("*").in("client_id", clientIds);
  if (error) throw new Error(`Falha ao buscar objetivos em lote: ${error.message}`);

  for (const row of data ?? []) {
    const goal = mapClientGoalRow(row);
    const list = map.get(goal.clientId);
    if (list) list.push(goal);
    else map.set(goal.clientId, [goal]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.isPrimary === b.isPrimary ? a.resultType.localeCompare(b.resultType) : a.isPrimary ? -1 : 1));
  }
  return map;
}

/** Resumo pronto pro card compacto "Objetivos da conta" — meta mensal
 * vigente (soma simples entre canais do objetivo, só pra exibição; o
 * cálculo por canal "de verdade" é sempre `resolveClientMonthlyGoals`) e
 * contagem de campanhas vinculadas. Uma consulta por tipo de dado (nunca
 * N+1 por objetivo). */
export async function fetchGoalDisplaySummaries(
  supabase: SupabaseClient<Database>,
  clientId: string,
  goals: ClientGoal[],
  currentMonth: string,
): Promise<Map<PerformanceGoal, { resultType: PerformanceGoal; targetResultCount: number | null; campaignCount: number }>> {
  const map = new Map<PerformanceGoal, { resultType: PerformanceGoal; targetResultCount: number | null; campaignCount: number }>();
  if (goals.length === 0) return map;

  const [{ data: planRows, error: planError }, { data: assignmentRows, error: assignmentError }] = await Promise.all([
    supabase
      .from("monthly_budget_changes")
      .select("channel, result_type, month, changed_at, target_result_count")
      .eq("client_id", clientId)
      .lte("month", currentMonth)
      .in(
        "result_type",
        goals.map((g) => g.resultType),
      ),
    supabase.from("client_campaign_goal_assignments").select("result_type").eq("client_id", clientId),
  ]);

  if (planError) throw new Error(`Falha ao buscar metas dos objetivos de ${clientId}: ${planError.message}`);
  if (assignmentError) throw new Error(`Falha ao buscar campanhas vinculadas de ${clientId}: ${assignmentError.message}`);

  const campaignCountByGoal = new Map<PerformanceGoal, number>();
  for (const row of assignmentRows ?? []) {
    const goal = row.result_type as PerformanceGoal;
    campaignCountByGoal.set(goal, (campaignCountByGoal.get(goal) ?? 0) + 1);
  }

  for (const goal of goals) {
    // Vigente = mais recente por canal (mesma regra de resolveClientMonthlyPlan),
    // somado entre canais só pra este resumo compacto.
    const latestByChannel = new Map<string, { month: string; changedAt: string; targetResultCount: number | null }>();
    for (const row of planRows ?? []) {
      if (row.result_type !== goal.resultType) continue;
      const current = latestByChannel.get(row.channel);
      const candidate = { month: row.month, changedAt: row.changed_at, targetResultCount: row.target_result_count };
      if (!current || candidate.month > current.month || (candidate.month === current.month && candidate.changedAt > current.changedAt)) {
        latestByChannel.set(row.channel, candidate);
      }
    }

    const values = Array.from(latestByChannel.values())
      .map((v) => v.targetResultCount)
      .filter((v): v is number => v !== null);

    map.set(goal.resultType, {
      resultType: goal.resultType,
      targetResultCount: values.length > 0 ? values.reduce((sum, v) => sum + v, 0) : null,
      campaignCount: campaignCountByGoal.get(goal.resultType) ?? 0,
    });
  }

  return map;
}

/** O objetivo principal de um cliente, ou `null` se nenhum estiver marcado
 * — usado só por consumidores AINDA NÃO migrados pra múltiplos objetivos
 * (Operação/Saúde/Dashboard/Report/Conquistas, ver relatório da
 * implementação), como ponte explícita e documentada, nunca como
 * comportamento "de verdade" do domínio. */
export function resolvePrimaryGoal(goals: ClientGoal[]): ClientGoal | null {
  return goals.find((g) => g.isPrimary) ?? null;
}
