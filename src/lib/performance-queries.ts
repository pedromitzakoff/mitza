import type { createClient as createSupabaseClient } from "./supabase/server";
import type { PerformanceRecordRow } from "./performance";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Funções de consulta reutilizáveis pra PERFORMANCE (Etapa 71, seção 33) —
 * preparadas pra Relatórios (que ainda não ganha nenhuma tela nova nesta
 * etapa), mas já usáveis por qualquer tela futura sem duplicar a busca.
 * Nunca fazem cálculo (isso é sempre `lib/performance.ts`) — só resolvem
 * "quais linhas de `performance_records` correspondem a este escopo".
 */

/** Registros de UMA sprint específica. */
export async function getPerformanceRecordsForSprint(
  supabase: Supabase,
  sprintId: string,
): Promise<PerformanceRecordRow[]> {
  const { data } = await supabase
    .from("performance_records")
    .select("channel, result_type, result_count, source, source_updated_at")
    .eq("sprint_id", sprintId);

  return (data ?? []).map((r) => ({
    channel: r.channel,
    resultType: r.result_type,
    resultCount: r.result_count,
    source: r.source,
    sourceUpdatedAt: r.source_updated_at,
  }));
}

/**
 * Registros de todas as sprints de UM cliente que se sobrepõem a um período
 * (mês, tipicamente) — resolve as sprints do período primeiro (mesma regra
 * de sobreposição usada em toda a agregação financeira: `start_date <=
 * lastDay && end_date >= firstDay`), depois busca os registros dessas
 * sprints. Nunca aceita um lançamento manual "de período" direto — a
 * granularidade de armazenamento continua sempre por sprint (ver migration).
 */
export async function getPerformanceRecordsForPeriod(
  supabase: Supabase,
  clientId: string,
  period: { firstDay: string; lastDay: string },
): Promise<PerformanceRecordRow[]> {
  const { data: sprints } = await supabase
    .from("sprints")
    .select("id")
    .eq("client_id", clientId)
    .lte("start_date", period.lastDay)
    .gte("end_date", period.firstDay);

  const sprintIds = (sprints ?? []).map((s) => s.id);
  if (sprintIds.length === 0) return [];

  const { data } = await supabase
    .from("performance_records")
    .select("channel, result_type, result_count, source, source_updated_at")
    .in("sprint_id", sprintIds);

  return (data ?? []).map((r) => ({
    channel: r.channel,
    resultType: r.result_type,
    resultCount: r.result_count,
    source: r.source,
    sourceUpdatedAt: r.source_updated_at,
  }));
}
