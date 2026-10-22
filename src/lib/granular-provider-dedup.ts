import type { createClient as createSupabaseClient } from "./supabase/server";
import { requireQuery } from "./require-query";
import type { ImportProviderDb } from "./supabase/database.types";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

export interface ImportSourceProviderInfo {
  provider: ImportProviderDb;
  externalAccountId: string;
}

/**
 * Migração Stract -> Meta API direta (`docs/STRACT_INTEGRATION_ARCHITECTURE.md`):
 * as tabelas granulares (`campaign_daily_metrics`/`ad_set_daily_metrics`/
 * `ad_creative_daily_metrics`/`campaign_placement_daily_metrics`) fazem
 * upsert por `import_source_id`, nunca por `client_id` — então linhas
 * antigas gravadas pela fonte `stract` (hoje sempre desativada, nunca mais
 * sincronizada) convivem no banco com as novas linhas `meta_api` pra
 * qualquer dia em que as duas tenham rodado. As leituras (`*-analytics-data.ts`)
 * filtram só por `client_id` + período — sem isto, elas SOMARIAM as duas
 * fontes, dobrando investimento/resultado nesses dias.
 *
 * Este mapa (`import_source_id -> provider/conta`) é a única consulta usada
 * por `dedupeRowsByProviderPreference` abaixo — inclui fontes desativadas de
 * propósito (uma fonte Stract que parou de sincronizar ainda identifica as
 * linhas antigas que ela já gravou).
 */
export async function getMetaImportSourceProviderMap(supabase: Supabase, clientId: string): Promise<Map<string, ImportSourceProviderInfo>> {
  const rows = await requireQuery(
    supabase.from("import_sources").select("id, provider, external_account_id").eq("client_id", clientId).eq("channel", "meta"),
    "import_sources:provider-map",
  );
  return new Map(rows.map((row) => [row.id, { provider: row.provider, externalAccountId: row.external_account_id }]));
}

/**
 * Resolve a duplicidade descrita acima: agrupa as linhas por (conta, data) —
 * nunca só por data, pra nunca misturar contas diferentes do mesmo cliente —
 * e, quando QUALQUER linha do grupo vier de `meta_api`, descarta as linhas
 * `stract` do MESMO grupo. Nunca soma as duas fontes pro mesmo dia.
 *
 * Dias em que só o Stract tem linha (todo o histórico anterior à migração de
 * um cliente, ou um cliente que nunca foi migrado) continuam 100% intactos —
 * é isso que preserva o histórico sem apagar nenhuma linha do banco.
 *
 * Uma fonte que não está no mapa (ex.: linha de uma `import_source_id` já
 * excluída) nunca é misturada com nada — fica isolada no seu próprio grupo,
 * por `import_source_id` em vez de conta.
 */
export function dedupeRowsByProviderPreference<T>(
  rows: T[],
  getImportSourceId: (row: T) => string,
  getDate: (row: T) => string,
  sourceById: Map<string, ImportSourceProviderInfo>,
): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const importSourceId = getImportSourceId(row);
    const source = sourceById.get(importSourceId);
    const groupKey = source ? `${source.externalAccountId}::${getDate(row)}` : `unknown::${importSourceId}::${getDate(row)}`;
    const list = groups.get(groupKey);
    if (list) list.push(row);
    else groups.set(groupKey, [row]);
  }

  const result: T[] = [];
  for (const groupRows of groups.values()) {
    const hasMetaApi = groupRows.some((row) => sourceById.get(getImportSourceId(row))?.provider === "meta_api");
    if (!hasMetaApi) {
      result.push(...groupRows);
      continue;
    }
    for (const row of groupRows) {
      if (sourceById.get(getImportSourceId(row))?.provider === "meta_api") result.push(row);
    }
  }
  return result;
}
