import type { PerformanceGoal } from "./performance-goals";
import type { TrafficChannel } from "./traffic-channels";

/**
 * Núcleo puro do Import Service (integração Stract → Supabase → MITZA,
 * arquitetura aprovada após 3 rodadas de revisão — ver DECISIONS.md). Nunca
 * conhece Supabase/fetch — só recebe linhas já lidas da tabela de origem e
 * devolve valores agregados/validados. Nomes de coluna do Stract (spend
 * column, result column etc.) chegam sempre como parâmetro, vindos de
 * `import_sources`/`metric_mappings` — nunca hardcoded aqui.
 */

/** Uma linha bruta lida da tabela de origem — schema dinâmico (varia
 * conforme as métricas escolhidas na extração), por isso um dicionário, não
 * uma interface fixa. */
export type RawSourceRow = Record<string, unknown>;

export type ParsedSourceValue =
  | { kind: "ok"; value: number }
  /** Nulo/vazio — tratado como 0 pelo chamador SOMENTE porque, neste
   * contexto (spend/resultado diário de Ads Insights), ausência de valor é
   * um zero real ("sem gasto"/"sem resultado nesse dia"), nunca um dado
   * quebrado. */
  | { kind: "empty" }
  /** Não numérico ou negativo — nunca vira 0 silenciosamente; o chamador
   * deve contar como linha inválida e nunca reportar a execução como
   * sucesso quando isso acontece. */
  | { kind: "invalid"; raw: unknown };

export function parseSourceNumericValue(raw: unknown): ParsedSourceValue {
  if (raw === null || raw === undefined || raw === "") return { kind: "empty" };
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return { kind: "invalid", raw };
  if (value < 0) return { kind: "invalid", raw };
  return { kind: "ok", value };
}

export interface AggregatedDailyValue {
  date: string;
  value: number;
  /** Quantas linhas daquele dia foram ignoradas por valor inválido — > 0
   * nunca deve deixar a execução ser reportada como sucesso pleno. */
  invalidRowCount: number;
}

/**
 * Soma uma coluna por dia (`SUM(valueColumn) GROUP BY dateColumn`) — nunca
 * assume 1 linha = 1 dia: o Stract pode gerar várias linhas por dia
 * dependendo das dimensões escolhidas na extração. Linha sem data utilizável
 * é ignorada (não é o foco de invalidRowCount — isso é sobre valor, não
 * sobre ausência de chave de agrupamento).
 */
export function aggregateDailyColumn(rows: RawSourceRow[], dateColumn: string, valueColumn: string): AggregatedDailyValue[] {
  const byDate = new Map<string, { value: number; invalidRowCount: number }>();

  for (const row of rows) {
    const rawDate = row[dateColumn];
    if (typeof rawDate !== "string" || rawDate.length === 0) continue;

    const parsed = parseSourceNumericValue(row[valueColumn]);
    const entry = byDate.get(rawDate) ?? { value: 0, invalidRowCount: 0 };
    if (parsed.kind === "ok") entry.value += parsed.value;
    if (parsed.kind === "invalid") entry.invalidRowCount += 1;
    byDate.set(rawDate, entry);
  }

  return Array.from(byDate.entries())
    .map(([date, { value, invalidRowCount }]) => ({ date, value, invalidRowCount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface AccountIdValidationResult {
  /** `false` sempre que ao menos uma linha divergir — o chamador nunca deve
   * importar dados de uma fonte com `valid: false` (ponto 7 da arquitetura:
   * nunca inferir o cliente pelo nome da tabela quando o account_id não bate). */
  valid: boolean;
  mismatchCount: number;
  distinctValuesFound: string[];
}

/**
 * Confirma que a coluna de conta da tabela de origem bate com o
 * `external_account_id` configurado — mesmo já sabendo qual conta esperar,
 * o Import Service nunca confia cegamente: se a tabela de origem mudou de
 * identidade silenciosamente (ex.: reconfiguração no Stract), isso precisa
 * travar a importação, nunca ser ignorado.
 */
export function validateAccountIdColumn(
  rows: RawSourceRow[],
  accountIdColumn: string,
  expectedAccountId: string,
): AccountIdValidationResult {
  let mismatchCount = 0;
  const distinctValuesFound = new Set<string>();

  for (const row of rows) {
    const raw = row[accountIdColumn];
    const value = typeof raw === "string" ? raw : String(raw ?? "");
    distinctValuesFound.add(value);
    if (value !== expectedAccountId) mismatchCount += 1;
  }

  return { valid: mismatchCount === 0, mismatchCount, distinctValuesFound: Array.from(distinctValuesFound) };
}

export interface DailySpendUpsertRow {
  client_id: string;
  date: string;
  channel: TrafficChannel;
  spend: number;
  synced_at: string;
}

/** Monta as linhas prontas pro upsert em `daily_spend` — mesma chave
 * `(client_id, date, channel)` que a sync nativa do Meta já usa hoje, então
 * o upsert é idempotente por construção. */
export function buildDailySpendUpsertRows(
  clientId: string,
  channel: TrafficChannel,
  aggregated: AggregatedDailyValue[],
  syncedAt: string,
): DailySpendUpsertRow[] {
  return aggregated.map((row) => ({ client_id: clientId, date: row.date, channel, spend: row.value, synced_at: syncedAt }));
}

export interface DailyPerformanceUpsertRow {
  client_id: string;
  date: string;
  channel: TrafficChannel;
  result_type: PerformanceGoal;
  result_count: number;
  source: "import";
  provider: "stract";
  source_updated_at: string;
}

/** Monta as linhas prontas pro upsert em `daily_performance` —
 * `result_count` sempre inteiro (Postgres exige `integer`, resultado nunca
 * tem fração). */
export function buildDailyPerformanceUpsertRows(
  clientId: string,
  channel: TrafficChannel,
  goal: PerformanceGoal,
  aggregated: AggregatedDailyValue[],
  sourceUpdatedAt: string,
): DailyPerformanceUpsertRow[] {
  return aggregated.map((row) => ({
    client_id: clientId,
    date: row.date,
    channel,
    result_type: goal,
    result_count: Math.round(row.value),
    source: "import",
    provider: "stract",
    source_updated_at: sourceUpdatedAt,
  }));
}
