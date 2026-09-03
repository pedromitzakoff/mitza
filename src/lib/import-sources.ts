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

/** Minúsculo + sem acento — o mesmo nome de campanha aparece no Stract ora
 * acentuado ("MALÍCIA02"), ora não ("Malicia 02"), variação do provedor
 * externo que a MITZA nunca deve deixar quebrar o filtro. */
function normalizeForCampaignMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Filtra linhas por um trecho (contém, sem diferenciar maiúscula/minúscula
 * nem acento) no nome da campanha — nunca depende do provedor externo
 * (Stract) aplicar o filtro certo na extração; a MITZA garante isso por
 * conta própria. Só é chamada quando `campaign_name_column`/
 * `campaign_name_filter` estiverem configurados em `import_sources`; fonte
 * sem os dois preenchidos lê todas as linhas da conta, exatamente como antes
 * desta capacidade existir.
 */
export function filterRowsByCampaignName(rows: RawSourceRow[], campaignNameColumn: string, filterText: string): RawSourceRow[] {
  const needle = normalizeForCampaignMatch(filterText);
  return rows.filter((row) => {
    const raw = row[campaignNameColumn];
    const value = typeof raw === "string" ? raw : String(raw ?? "");
    return normalizeForCampaignMatch(value).includes(needle);
  });
}

/**
 * Exclui linhas por um trecho (contém, sem diferenciar maiúscula/minúscula
 * nem acento) no nome da campanha — o inverso de `filterRowsByCampaignName`,
 * pra quando a conta mistura campanhas de outra finalidade (ex.: RH/
 * recrutamento) que não têm nenhum texto em comum com as campanhas
 * legítimas, então "incluir só quem contém X" não serve; "excluir quem
 * contém X" resolve. Independente do filtro de inclusão — uma fonte pode
 * usar os dois, um só, ou nenhum. Só é chamada quando
 * `campaign_name_column`/`campaign_name_exclude` estiverem configurados em
 * `import_sources`.
 */
export function excludeRowsByCampaignName(rows: RawSourceRow[], campaignNameColumn: string, excludeText: string): RawSourceRow[] {
  const needle = normalizeForCampaignMatch(excludeText);
  return rows.filter((row) => {
    const raw = row[campaignNameColumn];
    const value = typeof raw === "string" ? raw : String(raw ?? "");
    return !normalizeForCampaignMatch(value).includes(needle);
  });
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
  /** Faturamento do mesmo dia/objetivo — `null` quando não houver
   * `value_column` configurado (leads/seguidores, ou vendas sem valor de
   * conversão mapeado). Nunca fabricado. */
  revenue: number | null;
  source: "import";
  provider: "stract";
  source_updated_at: string;
}

/**
 * Combina a agregação diária de VÁRIAS colunas de origem que alimentam o
 * MESMO objetivo — ex.: um cliente de leads que roda campanha de formulário
 * (`actions_lead`) e campanha de WhatsApp (`actions_onsite_conversion_
 * messaging_conversation_started_7d`) ao mesmo tempo: no Meta/Stract são
 * métricas diferentes, mas na MITZA é tudo lead, somado no mesmo dia.
 * `invalidRowCount` também é somado — uma linha inválida em qualquer coluna
 * ainda deve impedir que a execução seja reportada como sucesso pleno.
 */
export function combineAggregatedDailyValues(aggregates: AggregatedDailyValue[][]): AggregatedDailyValue[] {
  const byDate = new Map<string, { value: number; invalidRowCount: number }>();

  for (const aggregate of aggregates) {
    for (const row of aggregate) {
      const entry = byDate.get(row.date) ?? { value: 0, invalidRowCount: 0 };
      entry.value += row.value;
      entry.invalidRowCount += row.invalidRowCount;
      byDate.set(row.date, entry);
    }
  }

  return Array.from(byDate.entries())
    .map(([date, { value, invalidRowCount }]) => ({ date, value, invalidRowCount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Monta as linhas prontas pro upsert em `daily_performance` —
 * `result_count` sempre inteiro (Postgres exige `integer`, resultado nunca
 * tem fração). `revenueByDate` é opcional (agregação separada de um
 * `value_column`, quando configurado) — dia sem entrada no mapa vira
 * `revenue: null`, nunca `0` fabricado. */
export function buildDailyPerformanceUpsertRows(
  clientId: string,
  channel: TrafficChannel,
  goal: PerformanceGoal,
  aggregated: AggregatedDailyValue[],
  sourceUpdatedAt: string,
  revenueByDate?: Map<string, number> | null,
): DailyPerformanceUpsertRow[] {
  return aggregated.map((row) => ({
    client_id: clientId,
    date: row.date,
    channel,
    result_type: goal,
    result_count: Math.round(row.value),
    revenue: revenueByDate?.get(row.date) ?? null,
    source: "import",
    provider: "stract",
    source_updated_at: sourceUpdatedAt,
  }));
}

function toStringColumnValue(raw: unknown): string {
  return typeof raw === "string" ? raw : String(raw ?? "");
}

/**
 * Núcleo puro do Módulo de Criativos (Creative Analytics — arquitetura
 * aprovada pelo usuário: identidade do criativo é SEMPRE `creative_name`
 * (= `ad_name` do Meta), nunca `ad_id`/`creative_id`/`video_id`/`image_hash`
 * — esses ids do Meta não são estáveis entre edições/reuploads. Agrupa por
 * `(date, campaignName, creativeName)`, análogo a `aggregateDailyColumn` mas
 * com uma chave composta (essa é a granularidade de armazenamento de
 * `ad_creative_daily_metrics`; consolidação por criativo sozinho — somando
 * todas as campanhas/dias — acontece só em tempo de consulta, nunca aqui).
 *
 * Linha sem `creativeNameColumn` preenchido é ignorada (sem nome de
 * anúncio não há identidade possível). Colunas opcionais (`permalinkColumn`/
 * `previewImageColumn`/`impressionsColumn`/`reachColumn`/`clicksColumn`)
 * ausentes na fonte simplesmente resultam em campos `null` no agregado —
 * nunca um valor fabricado — pra sustentar a degradação graciosa exigida (a
 * UI mostra só o que existe).
 */
export interface AggregateAdCreativeRowsColumns {
  dateColumn: string;
  campaignNameColumn: string;
  creativeNameColumn: string;
  permalinkColumn?: string | null;
  previewImageColumn?: string | null;
  /** Tentada SÓ quando `previewImageColumn` vier vazia/null naquela linha —
   * nunca sobrescreve um valor que a coluna primária já trouxe. Existe pra
   * fontes onde a imagem de capa vem em colunas diferentes conforme o tipo
   * de criativo (ex.: imagem estática numa coluna, thumbnail de vídeo em
   * outra, nunca as duas preenchidas na mesma linha). */
  previewImageFallbackColumn?: string | null;
  spendColumn: string;
  impressionsColumn?: string | null;
  reachColumn?: string | null;
  clicksColumn?: string | null;
}

export interface AggregatedAdCreativeRow {
  date: string;
  campaignName: string;
  creativeName: string;
  /** Permalink da PRIMEIRA linha vista pra essa combinação de
   * data+campanha+criativo — nunca sobrescrito depois (regra do usuário: a
   * miniatura é fixada na primeira aparição, sem cache de imagem/vídeo). */
  creativePermalinkUrl: string | null;
  previewImageUrl: string | null;
  spend: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  invalidRowCount: number;
}

export function aggregateAdCreativeDailyRows(
  rows: RawSourceRow[],
  columns: AggregateAdCreativeRowsColumns,
): AggregatedAdCreativeRow[] {
  const {
    dateColumn,
    campaignNameColumn,
    creativeNameColumn,
    permalinkColumn,
    previewImageColumn,
    previewImageFallbackColumn,
    spendColumn,
    impressionsColumn,
    reachColumn,
    clicksColumn,
  } = columns;

  const groups = new Map<string, AggregatedAdCreativeRow>();

  for (const row of rows) {
    const rawDate = row[dateColumn];
    if (typeof rawDate !== "string" || rawDate.length === 0) continue;

    const creativeName = toStringColumnValue(row[creativeNameColumn]);
    if (creativeName.length === 0) continue;

    const campaignName = toStringColumnValue(row[campaignNameColumn]);

    const key = `${rawDate} ${campaignName} ${creativeName}`;
    const group = groups.get(key) ?? {
      date: rawDate,
      campaignName,
      creativeName,
      creativePermalinkUrl: null,
      previewImageUrl: null,
      spend: 0,
      impressions: null,
      reach: null,
      clicks: null,
      invalidRowCount: 0,
    };

    if (!group.creativePermalinkUrl && permalinkColumn) {
      const rawPermalink = row[permalinkColumn];
      if (typeof rawPermalink === "string" && rawPermalink.length > 0) {
        group.creativePermalinkUrl = rawPermalink;
      }
    }

    if (!group.previewImageUrl) {
      const rawPreviewImage = previewImageColumn ? row[previewImageColumn] : undefined;
      if (typeof rawPreviewImage === "string" && rawPreviewImage.length > 0) {
        group.previewImageUrl = rawPreviewImage;
      } else if (previewImageFallbackColumn) {
        const rawFallback = row[previewImageFallbackColumn];
        if (typeof rawFallback === "string" && rawFallback.length > 0) {
          group.previewImageUrl = rawFallback;
        }
      }
    }

    const spendValue = parseSourceNumericValue(row[spendColumn]);
    if (spendValue.kind === "ok") group.spend += spendValue.value;
    if (spendValue.kind === "invalid") group.invalidRowCount += 1;

    if (impressionsColumn) {
      const value = parseSourceNumericValue(row[impressionsColumn]);
      if (value.kind === "ok") group.impressions = (group.impressions ?? 0) + value.value;
      if (value.kind === "invalid") group.invalidRowCount += 1;
    }
    if (reachColumn) {
      const value = parseSourceNumericValue(row[reachColumn]);
      if (value.kind === "ok") group.reach = (group.reach ?? 0) + value.value;
      if (value.kind === "invalid") group.invalidRowCount += 1;
    }
    if (clicksColumn) {
      const value = parseSourceNumericValue(row[clicksColumn]);
      if (value.kind === "ok") group.clicks = (group.clicks ?? 0) + value.value;
      if (value.kind === "invalid") group.invalidRowCount += 1;
    }

    groups.set(key, group);
  }

  return Array.from(groups.values()).sort(
    (a, b) => a.date.localeCompare(b.date) || a.campaignName.localeCompare(b.campaignName) || a.creativeName.localeCompare(b.creativeName),
  );
}

export interface AggregatedAdCreativeGroupValue {
  date: string;
  campaignName: string;
  creativeName: string;
  value: number;
  invalidRowCount: number;
}

/**
 * Soma uma coluna por `(date, campaignName, creativeName)` — mesma
 * granularidade de `aggregateAdCreativeDailyRows`, usada pra resolver
 * `result_column`/`value_column` de `metric_mappings` por criativo (em vez
 * de por dia inteiro do cliente, como `aggregateDailyColumn` faz pra
 * `daily_performance`). Reaproveitada pra somar múltiplas colunas do mesmo
 * objetivo via `combineAdCreativeGroupValues`, no mesmo espírito de
 * `combineAggregatedDailyValues`.
 */
export function aggregateColumnByAdCreativeGroup(
  rows: RawSourceRow[],
  dateColumn: string,
  campaignNameColumn: string,
  creativeNameColumn: string,
  valueColumn: string,
): AggregatedAdCreativeGroupValue[] {
  const groups = new Map<string, AggregatedAdCreativeGroupValue>();

  for (const row of rows) {
    const rawDate = row[dateColumn];
    if (typeof rawDate !== "string" || rawDate.length === 0) continue;

    const creativeName = toStringColumnValue(row[creativeNameColumn]);
    if (creativeName.length === 0) continue;

    const campaignName = toStringColumnValue(row[campaignNameColumn]);
    const key = `${rawDate} ${campaignName} ${creativeName}`;
    const group = groups.get(key) ?? { date: rawDate, campaignName, creativeName, value: 0, invalidRowCount: 0 };

    const parsed = parseSourceNumericValue(row[valueColumn]);
    if (parsed.kind === "ok") group.value += parsed.value;
    if (parsed.kind === "invalid") group.invalidRowCount += 1;

    groups.set(key, group);
  }

  return Array.from(groups.values());
}

export function combineAdCreativeGroupValues(aggregates: AggregatedAdCreativeGroupValue[][]): AggregatedAdCreativeGroupValue[] {
  const groups = new Map<string, AggregatedAdCreativeGroupValue>();

  for (const aggregate of aggregates) {
    for (const row of aggregate) {
      const key = `${row.date} ${row.campaignName} ${row.creativeName}`;
      const group = groups.get(key) ?? { date: row.date, campaignName: row.campaignName, creativeName: row.creativeName, value: 0, invalidRowCount: 0 };
      group.value += row.value;
      group.invalidRowCount += row.invalidRowCount;
      groups.set(key, group);
    }
  }

  return Array.from(groups.values());
}

export interface AdCreativeDailyMetricsUpsertRow {
  client_id: string;
  import_source_id: string;
  date: string;
  campaign_name: string;
  creative_name: string;
  creative_permalink_url: string | null;
  preview_image_url: string | null;
  spend: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  result_type: PerformanceGoal | null;
  result_count: number | null;
  revenue: number | null;
}

/**
 * Monta as linhas prontas pro upsert em `ad_creative_daily_metrics` — chave
 * `(import_source_id, date, campaign_name, creative_name)`, nunca `ad_id`.
 * `resultByGroup`/`revenueByGroup` são opcionais (só quando a fonte tiver
 * `metric_mappings` ativo pro objetivo, reaproveitando a mesma resolução já
 * usada por `daily_performance` — nunca uma segunda lógica de mapeamento) e
 * são resolvidos pela MESMA chave composta do agregado, então cada
 * campanha+criativo recebe só o resultado que efetivamente teve naquele dia.
 */
export function buildAdCreativeDailyMetricsUpsertRows(
  clientId: string,
  importSourceId: string,
  aggregated: AggregatedAdCreativeRow[],
  options?: {
    resultType?: PerformanceGoal | null;
    resultByGroup?: Map<string, number> | null;
    revenueByGroup?: Map<string, number> | null;
  },
): AdCreativeDailyMetricsUpsertRow[] {
  return aggregated.map((row) => {
    const key = `${row.date} ${row.campaignName} ${row.creativeName}`;
    const resultCount = options?.resultByGroup?.get(key);
    return {
      client_id: clientId,
      import_source_id: importSourceId,
      date: row.date,
      campaign_name: row.campaignName,
      creative_name: row.creativeName,
      creative_permalink_url: row.creativePermalinkUrl,
      preview_image_url: row.previewImageUrl,
      spend: row.spend,
      impressions: row.impressions,
      reach: row.reach,
      clicks: row.clicks,
      result_type: resultCount !== undefined ? (options?.resultType ?? null) : null,
      result_count: resultCount !== undefined ? Math.round(resultCount) : null,
      revenue: options?.revenueByGroup?.get(key) ?? null,
    };
  });
}

/**
 * Núcleo puro da camada de CAMPANHA (`campaign_daily_metrics`) — achado da
 * auditoria da integração Google Ads: a antiga seção "Campanhas" não era
 * independente, reaproveitava `ad_creative_daily_metrics` (Meta-only, exige
 * `ad_name_column`) só agrupando por campanha em vez de criativo. Esta
 * camada agrega por `(date, campaignName)` — SEM `creativeName` — pra nunca
 * depender de `ad_name_column` estar configurado. Disparada sempre que
 * `campaign_name_column` existir, independente de Criativos.
 */
export interface AggregateCampaignRowsColumns {
  dateColumn: string;
  campaignNameColumn: string;
  spendColumn: string;
  impressionsColumn?: string | null;
  reachColumn?: string | null;
  clicksColumn?: string | null;
  /** Etapa "Múltiplos Objetivos": coluna com o ID ESTÁVEL da campanha na
   * plataforma (nunca o nome) — opcional, só presente quando
   * `import_sources.campaign_id_column` estiver configurado pra esta fonte.
   * Sem ela, `campaignId` sai sempre `null` (campanha não fica classificável
   * por objetivo, mas continua aparecendo normalmente em Campanhas/Criativos
   * — nenhuma mudança de comportamento existente). */
  campaignIdColumn?: string | null;
}

export interface AggregatedCampaignRow {
  date: string;
  campaignName: string;
  /** `null` quando a fonte não tem `campaignIdColumn` configurado, ou a
   * linha não trouxe valor pra ela. Nunca derivado do nome. */
  campaignId: string | null;
  spend: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  invalidRowCount: number;
}

export function aggregateCampaignDailyRows(rows: RawSourceRow[], columns: AggregateCampaignRowsColumns): AggregatedCampaignRow[] {
  const { dateColumn, campaignNameColumn, spendColumn, impressionsColumn, reachColumn, clicksColumn, campaignIdColumn } = columns;

  const groups = new Map<string, AggregatedCampaignRow>();

  for (const row of rows) {
    const rawDate = row[dateColumn];
    if (typeof rawDate !== "string" || rawDate.length === 0) continue;

    const campaignName = toStringColumnValue(row[campaignNameColumn]);
    const key = `${rawDate} ${campaignName}`;
    const group = groups.get(key) ?? {
      date: rawDate,
      campaignName,
      campaignId: null,
      spend: 0,
      impressions: null,
      reach: null,
      clicks: null,
      invalidRowCount: 0,
    };

    // O ID não varia por linha dentro da mesma campanha/dia — só precisa
    // capturar uma vez; nunca sobrescreve um valor já capturado por um
    // valor vazio de uma linha subsequente.
    if (campaignIdColumn && !group.campaignId) {
      const rawId = toStringColumnValue(row[campaignIdColumn]);
      if (rawId.length > 0) group.campaignId = rawId;
    }

    const spendValue = parseSourceNumericValue(row[spendColumn]);
    if (spendValue.kind === "ok") group.spend += spendValue.value;
    if (spendValue.kind === "invalid") group.invalidRowCount += 1;

    if (impressionsColumn) {
      const value = parseSourceNumericValue(row[impressionsColumn]);
      if (value.kind === "ok") group.impressions = (group.impressions ?? 0) + value.value;
      if (value.kind === "invalid") group.invalidRowCount += 1;
    }
    if (reachColumn) {
      const value = parseSourceNumericValue(row[reachColumn]);
      if (value.kind === "ok") group.reach = (group.reach ?? 0) + value.value;
      if (value.kind === "invalid") group.invalidRowCount += 1;
    }
    if (clicksColumn) {
      const value = parseSourceNumericValue(row[clicksColumn]);
      if (value.kind === "ok") group.clicks = (group.clicks ?? 0) + value.value;
      if (value.kind === "invalid") group.invalidRowCount += 1;
    }

    groups.set(key, group);
  }

  return Array.from(groups.values()).sort((a, b) => a.date.localeCompare(b.date) || a.campaignName.localeCompare(b.campaignName));
}

export interface AggregatedCampaignGroupValue {
  date: string;
  campaignName: string;
  value: number;
  invalidRowCount: number;
}

/** Soma uma coluna por `(date, campaignName)` — irmã de
 * `aggregateColumnByAdCreativeGroup`, mas na granularidade de campanha
 * (sem `creativeName`). Usada pra resolver `result_column`/`value_column` de
 * `metric_mappings` por campanha. */
export function aggregateColumnByCampaignGroup(
  rows: RawSourceRow[],
  dateColumn: string,
  campaignNameColumn: string,
  valueColumn: string,
): AggregatedCampaignGroupValue[] {
  const groups = new Map<string, AggregatedCampaignGroupValue>();

  for (const row of rows) {
    const rawDate = row[dateColumn];
    if (typeof rawDate !== "string" || rawDate.length === 0) continue;

    const campaignName = toStringColumnValue(row[campaignNameColumn]);
    const key = `${rawDate} ${campaignName}`;
    const group = groups.get(key) ?? { date: rawDate, campaignName, value: 0, invalidRowCount: 0 };

    const parsed = parseSourceNumericValue(row[valueColumn]);
    if (parsed.kind === "ok") group.value += parsed.value;
    if (parsed.kind === "invalid") group.invalidRowCount += 1;

    groups.set(key, group);
  }

  return Array.from(groups.values());
}

export function combineCampaignGroupValues(aggregates: AggregatedCampaignGroupValue[][]): AggregatedCampaignGroupValue[] {
  const groups = new Map<string, AggregatedCampaignGroupValue>();

  for (const aggregate of aggregates) {
    for (const row of aggregate) {
      const key = `${row.date} ${row.campaignName}`;
      const group = groups.get(key) ?? { date: row.date, campaignName: row.campaignName, value: 0, invalidRowCount: 0 };
      group.value += row.value;
      group.invalidRowCount += row.invalidRowCount;
      groups.set(key, group);
    }
  }

  return Array.from(groups.values());
}

/**
 * Núcleo puro da camada de AD SET (`ad_set_daily_metrics`, "Públicos") —
 * achado da inspeção somente leitura de uma fonte real (Ateliê): o grão de
 * origem já é dia×campanha×ad set×anúncio (`insights_adset_name` chega na
 * MESMA linha que alimenta campanha/criativo hoje). Esta camada agrega por
 * `(date, campaignName, adSetName)` — SEM `creativeName` — somando TODAS as
 * linhas de anúncio daquele ad set naquele dia, exatamente como
 * `aggregateCampaignDailyRows` soma por campanha sem guardar criativo. Só
 * disparada quando `ad_set_name_column` E `campaign_name_column` existirem
 * (campanha é obrigatória na tabela, mesma exigência de ad_creative_daily_metrics).
 * Sem `ad_set_id` — hoje só existe o nome no Stract, nunca fabricado.
 */
export interface AggregateAdSetRowsColumns {
  dateColumn: string;
  campaignNameColumn: string;
  adSetNameColumn: string;
  spendColumn: string;
  impressionsColumn?: string | null;
  reachColumn?: string | null;
  clicksColumn?: string | null;
}

export interface AggregatedAdSetRow {
  date: string;
  campaignName: string;
  adSetName: string;
  spend: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  invalidRowCount: number;
}

export function aggregateAdSetDailyRows(rows: RawSourceRow[], columns: AggregateAdSetRowsColumns): AggregatedAdSetRow[] {
  const { dateColumn, campaignNameColumn, adSetNameColumn, spendColumn, impressionsColumn, reachColumn, clicksColumn } = columns;

  const groups = new Map<string, AggregatedAdSetRow>();

  for (const row of rows) {
    const rawDate = row[dateColumn];
    if (typeof rawDate !== "string" || rawDate.length === 0) continue;

    const campaignName = toStringColumnValue(row[campaignNameColumn]);
    const adSetName = toStringColumnValue(row[adSetNameColumn]);
    const key = `${rawDate} ${campaignName} ${adSetName}`;
    const group = groups.get(key) ?? {
      date: rawDate,
      campaignName,
      adSetName,
      spend: 0,
      impressions: null,
      reach: null,
      clicks: null,
      invalidRowCount: 0,
    };

    const spendValue = parseSourceNumericValue(row[spendColumn]);
    if (spendValue.kind === "ok") group.spend += spendValue.value;
    if (spendValue.kind === "invalid") group.invalidRowCount += 1;

    if (impressionsColumn) {
      const value = parseSourceNumericValue(row[impressionsColumn]);
      if (value.kind === "ok") group.impressions = (group.impressions ?? 0) + value.value;
      if (value.kind === "invalid") group.invalidRowCount += 1;
    }
    if (reachColumn) {
      const value = parseSourceNumericValue(row[reachColumn]);
      if (value.kind === "ok") group.reach = (group.reach ?? 0) + value.value;
      if (value.kind === "invalid") group.invalidRowCount += 1;
    }
    if (clicksColumn) {
      const value = parseSourceNumericValue(row[clicksColumn]);
      if (value.kind === "ok") group.clicks = (group.clicks ?? 0) + value.value;
      if (value.kind === "invalid") group.invalidRowCount += 1;
    }

    groups.set(key, group);
  }

  return Array.from(groups.values()).sort(
    (a, b) => a.date.localeCompare(b.date) || a.campaignName.localeCompare(b.campaignName) || a.adSetName.localeCompare(b.adSetName),
  );
}

export interface AggregatedAdSetGroupValue {
  date: string;
  campaignName: string;
  adSetName: string;
  value: number;
  invalidRowCount: number;
}

/** Soma uma coluna por `(date, campaignName, adSetName)` — irmã de
 * `aggregateColumnByCampaignGroup`/`aggregateColumnByAdCreativeGroup`, usada
 * pra resolver `result_column`/`value_column` de `metric_mappings` no grão
 * de ad set. */
export function aggregateColumnByAdSetGroup(
  rows: RawSourceRow[],
  dateColumn: string,
  campaignNameColumn: string,
  adSetNameColumn: string,
  valueColumn: string,
): AggregatedAdSetGroupValue[] {
  const groups = new Map<string, AggregatedAdSetGroupValue>();

  for (const row of rows) {
    const rawDate = row[dateColumn];
    if (typeof rawDate !== "string" || rawDate.length === 0) continue;

    const campaignName = toStringColumnValue(row[campaignNameColumn]);
    const adSetName = toStringColumnValue(row[adSetNameColumn]);
    const key = `${rawDate} ${campaignName} ${adSetName}`;
    const group = groups.get(key) ?? { date: rawDate, campaignName, adSetName, value: 0, invalidRowCount: 0 };

    const parsed = parseSourceNumericValue(row[valueColumn]);
    if (parsed.kind === "ok") group.value += parsed.value;
    if (parsed.kind === "invalid") group.invalidRowCount += 1;

    groups.set(key, group);
  }

  return Array.from(groups.values());
}

export function combineAdSetGroupValues(aggregates: AggregatedAdSetGroupValue[][]): AggregatedAdSetGroupValue[] {
  const groups = new Map<string, AggregatedAdSetGroupValue>();

  for (const aggregate of aggregates) {
    for (const row of aggregate) {
      const key = `${row.date} ${row.campaignName} ${row.adSetName}`;
      const group = groups.get(key) ?? { date: row.date, campaignName: row.campaignName, adSetName: row.adSetName, value: 0, invalidRowCount: 0 };
      group.value += row.value;
      group.invalidRowCount += row.invalidRowCount;
      groups.set(key, group);
    }
  }

  return Array.from(groups.values());
}

export interface AdSetDailyMetricsUpsertRow {
  client_id: string;
  import_source_id: string;
  channel: TrafficChannel;
  date: string;
  campaign_name: string;
  ad_set_name: string;
  spend: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  result_type: PerformanceGoal | null;
  result_count: number | null;
  revenue: number | null;
}

/**
 * Monta as linhas prontas pro upsert em `ad_set_daily_metrics` — chave
 * `(import_source_id, date, channel, campaign_name, ad_set_name)`. `channel`
 * nunca inferido, sempre o mesmo de `import_sources.channel` da fonte.
 */
export function buildAdSetDailyMetricsUpsertRows(
  clientId: string,
  importSourceId: string,
  channel: TrafficChannel,
  aggregated: AggregatedAdSetRow[],
  options?: {
    resultType?: PerformanceGoal | null;
    resultByGroup?: Map<string, number> | null;
    revenueByGroup?: Map<string, number> | null;
  },
): AdSetDailyMetricsUpsertRow[] {
  return aggregated.map((row) => {
    const key = `${row.date} ${row.campaignName} ${row.adSetName}`;
    const resultCount = options?.resultByGroup?.get(key);
    return {
      client_id: clientId,
      import_source_id: importSourceId,
      channel,
      date: row.date,
      campaign_name: row.campaignName,
      ad_set_name: row.adSetName,
      spend: row.spend,
      impressions: row.impressions,
      reach: row.reach,
      clicks: row.clicks,
      result_type: resultCount !== undefined ? (options?.resultType ?? null) : null,
      result_count: resultCount !== undefined ? Math.round(resultCount) : null,
      revenue: options?.revenueByGroup?.get(key) ?? null,
    };
  });
}

export interface CampaignDailyMetricsUpsertRow {
  client_id: string;
  import_source_id: string;
  channel: TrafficChannel;
  date: string;
  campaign_name: string;
  campaign_id: string | null;
  spend: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  result_type: PerformanceGoal | null;
  result_count: number | null;
  revenue: number | null;
}

/**
 * Monta as linhas prontas pro upsert em `campaign_daily_metrics` — chave
 * `(import_source_id, date, channel, campaign_name)`. `channel` nunca
 * inferido, sempre o mesmo de `import_sources.channel` da fonte.
 */
export function buildCampaignDailyMetricsUpsertRows(
  clientId: string,
  importSourceId: string,
  channel: TrafficChannel,
  aggregated: AggregatedCampaignRow[],
  options?: {
    resultType?: PerformanceGoal | null;
    resultByGroup?: Map<string, number> | null;
    revenueByGroup?: Map<string, number> | null;
  },
): CampaignDailyMetricsUpsertRow[] {
  return aggregated.map((row) => {
    const key = `${row.date} ${row.campaignName}`;
    const resultCount = options?.resultByGroup?.get(key);
    return {
      client_id: clientId,
      import_source_id: importSourceId,
      channel,
      date: row.date,
      campaign_name: row.campaignName,
      campaign_id: row.campaignId,
      spend: row.spend,
      impressions: row.impressions,
      reach: row.reach,
      clicks: row.clicks,
      result_type: resultCount !== undefined ? (options?.resultType ?? null) : null,
      result_count: resultCount !== undefined ? Math.round(resultCount) : null,
      revenue: options?.revenueByGroup?.get(key) ?? null,
    };
  });
}
