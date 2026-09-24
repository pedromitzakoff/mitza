import type { RawSourceRow } from "@/lib/import-sources";

/**
 * Núcleo puro da ingestão n8n + API oficial da Meta (Etapa "Gestão de Funis
 * Estratégicos por Cliente" — decisão do usuário: extração via n8n, MITZA
 * continua Supabase + modelo interno). Contrato de payload documentado em
 * `docs/N8N_META_INGESTION_GUIDE.md` — este arquivo é a ÚNICA implementação
 * dele (o endpoint HTTP, `app/api/n8n/meta-insights/route.ts`, só chama
 * estas funções, nunca reimplementa validação/flatten).
 *
 * Sem Supabase aqui — validação e conversão pra `RawSourceRow` (o mesmo tipo
 * que `lib/import-sources.ts` já consome de qualquer fonte) são 100%
 * testáveis isoladamente, sem mockar rede/banco.
 */

/** Nomes de campo FIXOS que este módulo sempre usa ao converter pra
 * `RawSourceRow` — diferente do Stract (onde o nome de coluna é configurável
 * porque a extração varia), aqui o contrato é nosso: sempre os mesmos nomes,
 * documentados, nunca lidos de `import_sources.*_column` (essas colunas são
 * `null` pra `provider = 'meta_api'`, ver `supabase/meta-api-import-source.sql`). */
export const META_API_COLUMNS = {
  date: "date",
  campaignId: "campaign_id",
  campaignName: "campaign_name",
  adSetId: "ad_set_id",
  adSetName: "ad_set_name",
  adId: "ad_id",
  adName: "ad_name",
  platformPosition: "platform_position",
  spend: "spend",
  impressions: "impressions",
  reach: "reach",
  clicks: "clicks",
} as const;

/** Prefixo das chaves achatadas pra `actions`/`actionValues` — usado tanto
 * aqui (`flattenMetaApiRowToRawSourceRow`) quanto na configuração de
 * `metric_mappings.result_column`/`value_column` pra fontes `meta_api`
 * (ex.: `result_column = "actions.lead"`). Nunca uma segunda convenção. */
export const META_API_ACTIONS_PREFIX = "actions.";
export const META_API_ACTION_VALUES_PREFIX = "actionValues.";

export interface MetaApiIngestRow {
  /** YYYY-MM-DD. */
  date: string;
  /** ID estável da campanha na Meta — sempre obrigatório (nunca opcional
   * nesta pipeline; diferente do Stract, onde `campaign_id_column` é
   * opcional e raramente configurado). */
  campaignId: string;
  /** Só exibição/sugestão — nunca a chave de classificação. */
  campaignName: string;
  adSetId?: string;
  adSetName?: string;
  adId?: string;
  adName?: string;
  platformPosition?: string;
  /** Investimento do dia, sempre >= 0. */
  spend: number;
  impressions?: number;
  reach?: number;
  clicks?: number;
  /** `action_type` (nomenclatura da Meta Insights API, ex.: "lead",
   * "purchase", "onsite_conversion.lead_grouped") -> contagem do dia. A
   * MITZA decide, via `metric_mappings`, quais `action_type` somam pra qual
   * objetivo (leads/vendas/seguidores) — o n8n nunca decide isso, só
   * repassa o breakdown bruto que a Meta devolveu (nenhuma regra de negócio
   * de relatório replicada no workflow). */
  actions?: Record<string, number>;
  /** Mesma chave de `actions` (`action_type`), valor monetário associado —
   * só relevante pra objetivos com receita (vendas). */
  actionValues?: Record<string, number>;
}

export interface MetaApiIngestPayload {
  /** Conta de anúncios Meta no formato `act_...` — mesma convenção já usada
   * por `import_sources.external_account_id` (Stract). Resolve QUAL cliente
   * recebe os dados; nunca inferido do nome/payload livre. */
  accountId: string;
  rows: MetaApiIngestRow[];
}

export type MetaApiIngestValidation = { ok: true; payload: MetaApiIngestPayload } | { ok: false; errors: string[] };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateActionMap(value: unknown, fieldName: string, rowLabel: string, errors: string[]): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${rowLabel}: "${fieldName}" precisa ser um objeto { action_type: número }.`);
    return undefined;
  }
  const result: Record<string, number> = {};
  for (const [actionType, count] of Object.entries(value as Record<string, unknown>)) {
    if (!isFiniteNonNegative(count)) {
      errors.push(`${rowLabel}: "${fieldName}.${actionType}" precisa ser um número >= 0.`);
      continue;
    }
    result[actionType] = count;
  }
  return result;
}

/**
 * Valida o payload inteiro — coleta TODOS os erros (nunca só o primeiro),
 * pra quem está construindo o workflow n8n conseguir corrigir tudo de uma
 * vez em vez de descobrir um campo por tentativa. Nenhum campo obrigatório
 * tem default silencioso: ausência é sempre erro, nunca um valor inventado.
 */
export function validateMetaApiIngestPayload(body: unknown): MetaApiIngestValidation {
  const errors: string[] = [];

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["Corpo da requisição precisa ser um objeto JSON."] };
  }
  const raw = body as Record<string, unknown>;

  const accountId = raw.accountId;
  if (typeof accountId !== "string" || accountId.trim().length === 0) {
    errors.push('"accountId" é obrigatório (string).');
  } else if (!accountId.startsWith("act_")) {
    errors.push(`"accountId" precisa começar com "act_" (mesmo formato usado em toda a MITZA) — recebido "${accountId}".`);
  }

  if (!Array.isArray(raw.rows)) {
    errors.push('"rows" é obrigatório e precisa ser uma lista.');
    return { ok: false, errors };
  }

  const rows: MetaApiIngestRow[] = [];
  raw.rows.forEach((rawRow, index) => {
    const rowLabel = `rows[${index}]`;
    if (typeof rawRow !== "object" || rawRow === null || Array.isArray(rawRow)) {
      errors.push(`${rowLabel}: precisa ser um objeto.`);
      return;
    }
    const row = rawRow as Record<string, unknown>;

    const date = row.date;
    if (typeof date !== "string" || !DATE_PATTERN.test(date)) {
      errors.push(`${rowLabel}: "date" é obrigatório, formato YYYY-MM-DD.`);
    }

    const campaignId = row.campaignId;
    if (typeof campaignId !== "string" || campaignId.trim().length === 0) {
      errors.push(`${rowLabel}: "campaignId" é obrigatório (string) — esta pipeline nunca aceita uma linha sem ID estável de campanha.`);
    }

    const campaignName = row.campaignName;
    if (typeof campaignName !== "string" || campaignName.trim().length === 0) {
      errors.push(`${rowLabel}: "campaignName" é obrigatório (string) — usado só pra exibição/sugestão, nunca como identidade.`);
    }

    const spend = row.spend;
    if (!isFiniteNonNegative(spend)) {
      errors.push(`${rowLabel}: "spend" é obrigatório, número >= 0.`);
    }

    const adSetId = row.adSetId;
    const adSetName = row.adSetName;
    if (adSetId !== undefined && typeof adSetId !== "string") errors.push(`${rowLabel}: "adSetId", quando presente, precisa ser string.`);
    if (adSetName !== undefined && typeof adSetName !== "string") errors.push(`${rowLabel}: "adSetName", quando presente, precisa ser string.`);
    if ((adSetId !== undefined) !== (adSetName !== undefined)) {
      errors.push(`${rowLabel}: "adSetId" e "adSetName" devem vir juntos ou nenhum dos dois — nunca um ID sem nome de exibição, nem o contrário.`);
    }

    const adId = row.adId;
    const adName = row.adName;
    if (adId !== undefined && typeof adId !== "string") errors.push(`${rowLabel}: "adId", quando presente, precisa ser string.`);
    if (adName !== undefined && typeof adName !== "string") errors.push(`${rowLabel}: "adName", quando presente, precisa ser string.`);
    if ((adId !== undefined) !== (adName !== undefined)) {
      errors.push(`${rowLabel}: "adId" e "adName" devem vir juntos ou nenhum dos dois.`);
    }

    const platformPosition = row.platformPosition;
    if (platformPosition !== undefined && typeof platformPosition !== "string") {
      errors.push(`${rowLabel}: "platformPosition", quando presente, precisa ser string.`);
    }

    for (const field of ["impressions", "reach", "clicks"] as const) {
      const value = row[field];
      if (value !== undefined && !isFiniteNonNegative(value)) {
        errors.push(`${rowLabel}: "${field}", quando presente, precisa ser número >= 0.`);
      }
    }

    const actions = validateActionMap(row.actions, "actions", rowLabel, errors);
    const actionValues = validateActionMap(row.actionValues, "actionValues", rowLabel, errors);

    if (
      typeof date === "string" &&
      DATE_PATTERN.test(date) &&
      typeof campaignId === "string" &&
      campaignId.trim().length > 0 &&
      typeof campaignName === "string" &&
      campaignName.trim().length > 0 &&
      isFiniteNonNegative(spend)
    ) {
      rows.push({
        date,
        campaignId,
        campaignName,
        adSetId: adSetId as string | undefined,
        adSetName: adSetName as string | undefined,
        adId: adId as string | undefined,
        adName: adName as string | undefined,
        platformPosition: platformPosition as string | undefined,
        spend,
        impressions: row.impressions as number | undefined,
        reach: row.reach as number | undefined,
        clicks: row.clicks as number | undefined,
        actions,
        actionValues,
      });
    }
  });

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, payload: { accountId: accountId as string, rows } };
}

/**
 * Converte uma linha já validada pra `RawSourceRow` — mesmo tipo genérico
 * que `lib/import-sources.ts` já consome de qualquer fonte (Stract inclusa),
 * usando os nomes de coluna FIXOS de `META_API_COLUMNS`. `actions`/
 * `actionValues` viram chaves achatadas (`actions.lead`, `actionValues.purchase`)
 * — válido como nome de propriedade JS comum, nunca precisa de suporte a
 * aninhamento nas funções de agregação (elas só fazem `row[columnName]`).
 */
export function flattenMetaApiRowToRawSourceRow(row: MetaApiIngestRow): RawSourceRow {
  const flat: RawSourceRow = {
    [META_API_COLUMNS.date]: row.date,
    [META_API_COLUMNS.campaignId]: row.campaignId,
    [META_API_COLUMNS.campaignName]: row.campaignName,
    [META_API_COLUMNS.spend]: row.spend,
  };
  if (row.adSetId !== undefined) flat[META_API_COLUMNS.adSetId] = row.adSetId;
  if (row.adSetName !== undefined) flat[META_API_COLUMNS.adSetName] = row.adSetName;
  if (row.adId !== undefined) flat[META_API_COLUMNS.adId] = row.adId;
  if (row.adName !== undefined) flat[META_API_COLUMNS.adName] = row.adName;
  if (row.platformPosition !== undefined) flat[META_API_COLUMNS.platformPosition] = row.platformPosition;
  if (row.impressions !== undefined) flat[META_API_COLUMNS.impressions] = row.impressions;
  if (row.reach !== undefined) flat[META_API_COLUMNS.reach] = row.reach;
  if (row.clicks !== undefined) flat[META_API_COLUMNS.clicks] = row.clicks;

  for (const [actionType, count] of Object.entries(row.actions ?? {})) {
    flat[`${META_API_ACTIONS_PREFIX}${actionType}`] = count;
  }
  for (const [actionType, value] of Object.entries(row.actionValues ?? {})) {
    flat[`${META_API_ACTION_VALUES_PREFIX}${actionType}`] = value;
  }

  return flat;
}

export function flattenMetaApiRowsToRawSourceRows(rows: MetaApiIngestRow[]): RawSourceRow[] {
  return rows.map(flattenMetaApiRowToRawSourceRow);
}

/** `true` quando pelo menos uma linha do lote tem `adSetId`/`adSetName` —
 * decide se a agregação de Públicos roda pra este lote (mesmo padrão de
 * degradação graciosa do Stract: sem a coluna, a seção simplesmente não
 * escreve nada, nunca um erro). */
export function hasAnyAdSetIdentity(rows: MetaApiIngestRow[]): boolean {
  return rows.some((r) => r.adSetId !== undefined && r.adSetName !== undefined);
}

export function hasAnyAdIdentity(rows: MetaApiIngestRow[]): boolean {
  return rows.some((r) => r.adId !== undefined && r.adName !== undefined);
}

export function hasAnyPlacementIdentity(rows: MetaApiIngestRow[]): boolean {
  return rows.some((r) => r.platformPosition !== undefined);
}

/** Todos os `action_type` distintos vistos em `actions` no lote — usado pra
 * a UI de configuração de `metric_mappings` sugerir opções reais (nunca uma
 * lista adivinhada) quando um admin configura pela primeira vez qual
 * `action_type` corresponde a qual objetivo. */
export function collectDistinctActionTypes(rows: MetaApiIngestRow[]): string[] {
  const types = new Set<string>();
  for (const row of rows) {
    for (const actionType of Object.keys(row.actions ?? {})) types.add(actionType);
  }
  return Array.from(types).sort();
}
