import type { createClient as createSupabaseClient } from "./supabase/server";
import type { PerformanceRecordRow, PerformanceSource } from "./performance";
import type { PerformanceGoalDb, TrafficChannelDb, PerformanceSourceDb } from "./supabase/database.types";
import { requireQuery } from "./require-query";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/** `daily_performance.channel` já usa os mesmos literais de `PerformanceSource`
 * pra meta/google — mapeamento direto, sem cálculo. Canais fora do escopo da
 * primeira versão da integração (tiktok/linkedin/other) caem em "manual" só
 * como fallback defensivo (nunca deveria acontecer hoje: a primeira versão
 * só suporta provider=stract/channel=meta) — nunca usado pra decidir nada,
 * só pro texto de "última atualização" não quebrar caso isso mude antes de
 * `PerformanceSource` ser ampliado. */
export function channelToPerformanceSource(channel: TrafficChannelDb): PerformanceSource {
  if (channel === "meta" || channel === "google") return channel;
  return "manual";
}

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
    .select("channel, result_type, result_count, revenue, source, source_updated_at")
    .eq("sprint_id", sprintId);

  return (data ?? []).map((r) => ({
    channel: r.channel,
    resultType: r.result_type,
    resultCount: r.result_count,
    revenue: r.revenue,
    source: r.source,
    sourceUpdatedAt: r.source_updated_at,
  }));
}

/**
 * Registros de `daily_performance` de UM cliente que se sobrepõem a um
 * período — fonte usada SÓ para clientes com `import_sources.enabled = true`
 * (integração Stract, arquitetura aprovada em DECISIONS.md). Devolve o
 * MESMO formato `PerformanceRecordRow` que `getPerformanceRecordsForPeriod`
 * devolve pra `performance_records` — o núcleo de cálculo (`lib/performance.ts`)
 * nunca precisa saber de qual das duas tabelas os dados vieram. Quem chama
 * decide qual das duas funções usar (nunca as duas juntas pro mesmo cliente
 * — ver `client-operational-state-data.ts`).
 */
export async function getDailyPerformanceForPeriod(
  supabase: Supabase,
  clientId: string,
  period: { firstDay: string; lastDay: string },
): Promise<PerformanceRecordRow[]> {
  const { data } = await supabase
    .from("daily_performance")
    .select("channel, result_type, result_count, revenue, source_updated_at")
    .eq("client_id", clientId)
    .gte("date", period.firstDay)
    .lte("date", period.lastDay);

  return (data ?? []).map((r) => ({
    channel: r.channel,
    resultType: r.result_type,
    resultCount: r.result_count,
    revenue: r.revenue,
    source: channelToPerformanceSource(r.channel),
    sourceUpdatedAt: r.source_updated_at,
  }));
}

export interface DailyPerformanceRow {
  date: string;
  channel: TrafficChannelDb;
  resultType: PerformanceGoalDb;
  resultCount: number;
  revenue: number | null;
}

/**
 * Igual a `getDailyPerformanceForPeriod`, mas preservando `date` — usada
 * pelo Analytics (Etapa Analytics MVP) pra construir o gráfico de evolução
 * diária, que precisa da granularidade por dia (`getDailyPerformanceForPeriod`
 * já agrega e descarta essa coluna, pensada só pra alimentar
 * `computePerformanceSummary`). Mesma tabela, mesma fonte (só clientes com
 * `import_sources.enabled = true`) — nunca uma segunda consulta concorrente
 * a `daily_performance` pro mesmo período.
 */
export async function getDailyPerformanceRowsForPeriod(
  supabase: Supabase,
  clientId: string,
  period: { firstDay: string; lastDay: string },
): Promise<DailyPerformanceRow[]> {
  const { data } = await supabase
    .from("daily_performance")
    .select("date, channel, result_type, result_count, revenue")
    .eq("client_id", clientId)
    .gte("date", period.firstDay)
    .lte("date", period.lastDay);

  return (data ?? []).map((r) => ({
    date: r.date,
    channel: r.channel,
    resultType: r.result_type,
    resultCount: r.result_count,
    revenue: r.revenue,
  }));
}

export interface DailySpendRow {
  date: string;
  channel: TrafficChannelDb;
  spend: number;
}

/**
 * Linhas de `daily_spend` de UM cliente num período arbitrário, COM canal —
 * usada pra qualquer leitura que precise tanto do total investido quanto do
 * investimento por canal no mesmo período (Etapa Integração Instagram:
 * `resolvePerformanceSummaryForGoal` precisa do investimento só de Meta Ads
 * pra "followers", separado do consolidado). Reaproveitada por
 * Reports (`client-report-data.ts`) e Analytics (`analytics-data.ts`) —
 * nenhuma das duas telas deve montar esta consulta por conta própria.
 */
export async function getDailySpendRowsForPeriod(
  supabase: Supabase,
  clientId: string,
  period: { firstDay: string; lastDay: string },
): Promise<DailySpendRow[]> {
  const { data } = await supabase
    .from("daily_spend")
    .select("date, channel, spend")
    .eq("client_id", clientId)
    .gte("date", period.firstDay)
    .lte("date", period.lastDay);

  return data ?? [];
}

/** Clientes (dentre os passados) com integração automática ativa — usado
 * pra decidir, por cliente, se a leitura de performance vem de
 * `daily_performance` (Stract) ou `performance_records` (manual), nunca as
 * duas somadas. */
export async function getClientIdsWithActiveImportSource(supabase: Supabase, clientIds: string[]): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set();

  const { data } = await supabase.from("import_sources").select("client_id").eq("enabled", true).in("client_id", clientIds);

  return new Set((data ?? []).map((row) => row.client_id));
}

/** Canais com PELO MENOS uma `import_sources.enabled = true` de UM cliente —
 * Integração Google Ads (seletor de plataforma): decide se a visão "Google
 * Ads" mostra dado real ou o estado "ainda não conectado". Nunca inferido
 * de `daily_spend`/`daily_performance` (uma fonte pode existir sem ter
 * sincronizado nada ainda) — a fonte de verdade é sempre `import_sources`. */
export async function getActiveImportSourceChannelsForClient(supabase: Supabase, clientId: string): Promise<Set<TrafficChannelDb>> {
  const { data } = await supabase.from("import_sources").select("channel").eq("client_id", clientId).eq("enabled", true);
  return new Set((data ?? []).map((row) => row.channel));
}

/** IDs de todas as fontes `enabled = true` de UM cliente — usado pelo botão
 * "Sincronizar agora" da página do cliente (Etapa "Sincronização manual via
 * UI"), pra saber quais `import_source_id`s passar pro Import Service sem o
 * gestor precisar saber esse id de cor (antes só dava pra disparar via
 * curl/Postman). Um cliente pode ter mais de uma fonte ativa (ex.: Meta Ads
 * + Instagram) — o botão sincroniza todas de uma vez. */
export async function getEnabledImportSourceIdsForClient(supabase: Supabase, clientId: string): Promise<string[]> {
  const { data } = await supabase.from("import_sources").select("id").eq("client_id", clientId).eq("enabled", true);
  return (data ?? []).map((row) => row.id);
}

/** `"error"` = a última execução falhou de verdade (tabela de origem
 * ilegível, `external_account_id` divergente etc.). `"no_data"` = a última
 * releitura COMPLETA rodou sem erro, mas a fonte voltou com zero linhas —
 * sinal de que a conexão pode ter parado de enviar dado (ver
 * `lib/stract-sync.ts`). Só considera fontes `enabled = true` (uma fonte
 * desligada deliberadamente nunca deve gerar aviso). */
export async function getImportSourceHealthIssue(
  supabase: Supabase,
  clientId: string,
): Promise<{ status: "error" | "no_data" } | null> {
  const { data } = await supabase
    .from("import_sources")
    .select("status")
    .eq("client_id", clientId)
    .eq("enabled", true)
    .in("status", ["error", "no_data"])
    .limit(1)
    .maybeSingle();

  return data ? { status: data.status as "error" | "no_data" } : null;
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
    .select("channel, result_type, result_count, revenue, source, source_updated_at")
    .in("sprint_id", sprintIds);

  return (data ?? []).map((r) => ({
    channel: r.channel,
    resultType: r.result_type,
    resultCount: r.result_count,
    revenue: r.revenue,
    source: r.source,
    sourceUpdatedAt: r.source_updated_at,
  }));
}

export interface RawPerformanceRow {
  client_id: string;
  sprint_id: string | null;
  channel: TrafficChannelDb;
  result_type: PerformanceGoalDb;
  result_count: number;
  /** Populado quando vier de `daily_performance` de um cliente com
   * `value_column` configurado, OU de `performance_records` (manual) quando
   * o gestor informou a receita — `null` em qualquer outro caso (nunca
   * fabricada/estimada). */
  revenue: number | null;
  source: PerformanceSourceDb;
  source_updated_at: string;
}

/**
 * Substituto DROP-IN de uma consulta direta a `performance_records` filtrada
 * por uma lista de sprints — mesmo formato de linha (`client_id, sprint_id,
 * channel, result_type, result_count, source, source_updated_at`), pra
 * `page.tsx`/`sprints/page.tsx`/`clients/[id]/page.tsx` trocarem a consulta
 * sem mudar nada do que consome o resultado depois.
 *
 * Decide, por cliente, entre `performance_records` (manual) e
 * `daily_performance` (Stract, via `import_sources.enabled`) — nunca as duas
 * juntas pro mesmo cliente. Pra clientes com integração ativa, cada linha de
 * `daily_performance` dentro do período de UMA sprint específica é atribuída
 * a essa sprint (sprints de um mesmo cliente nunca se sobrepõem, então essa
 * atribuição por intervalo de datas é sempre inequívoca).
 */
export async function resolvePerformanceRowsForSprints(
  supabase: Supabase,
  sprints: { id: string; client_id: string; start_date: string; end_date: string }[],
): Promise<RawPerformanceRow[]> {
  if (sprints.length === 0) return [];

  const clientIds = Array.from(new Set(sprints.map((s) => s.client_id)));
  const activeImportClientIds = await getClientIdsWithActiveImportSource(supabase, clientIds);

  const manualSprintIds = sprints.filter((s) => !activeImportClientIds.has(s.client_id)).map((s) => s.id);
  const importSprints = sprints.filter((s) => activeImportClientIds.has(s.client_id));
  const importClientIds = Array.from(new Set(importSprints.map((s) => s.client_id)));

  const [manualRows, dailyPerformanceRows] = await Promise.all([
    manualSprintIds.length > 0
      ? requireQuery(
          supabase
            .from("performance_records")
            .select("client_id, sprint_id, channel, result_type, result_count, revenue, source, source_updated_at")
            .in("sprint_id", manualSprintIds),
          "performance_records:resolved",
        )
      : Promise.resolve([]),
    importSprints.length > 0
      ? requireQuery(
          supabase
            .from("daily_performance")
            .select("client_id, date, channel, result_type, result_count, revenue, source_updated_at")
            .in("client_id", importClientIds)
            .gte(
              "date",
              importSprints.reduce((min, s) => (s.start_date < min ? s.start_date : min), importSprints[0].start_date),
            )
            .lte(
              "date",
              importSprints.reduce((max, s) => (s.end_date > max ? s.end_date : max), importSprints[0].end_date),
            ),
          "daily_performance:resolved",
        )
      : Promise.resolve([]),
  ]);

  const importRows: RawPerformanceRow[] = [];
  for (const sprint of importSprints) {
    for (const row of dailyPerformanceRows) {
      if (row.client_id !== sprint.client_id) continue;
      if (row.date < sprint.start_date || row.date > sprint.end_date) continue;
      importRows.push({
        client_id: row.client_id,
        sprint_id: sprint.id,
        channel: row.channel,
        result_type: row.result_type,
        result_count: row.result_count,
        revenue: row.revenue,
        source: channelToPerformanceSource(row.channel),
        source_updated_at: row.source_updated_at,
      });
    }
  }

  return [...manualRows, ...importRows];
}
