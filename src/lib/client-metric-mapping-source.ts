import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { parsePerformanceGoal, type PerformanceGoal } from "@/lib/performance-goals";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Etapa "Configuração inteligente de métricas por cliente" — a seção
 * "Métricas de performance" (`/clients/[id]/edit`) precisa dos mesmos 2 IDs
 * que `MetaConnectionDrawer` já usa (`settings/meta-connections`): o id da
 * `import_sources` (pra salvar o mapeamento) e o `external_account_id`
 * (pra descobrir eventos reais via Graph API) — nunca uma segunda forma de
 * resolver isso. Mesmo filtro de sempre (`channel = 'meta'`, `provider =
 * 'meta_api'`, `enabled = true`) e mesma limitação documentada na auditoria
 * (B3): assume no máximo 1 conta Meta ativa por cliente — "não altere a
 * arquitetura de múltiplas contas Meta nesta rodada", pedido explícito do
 * usuário. `null` = cliente sem conta Meta conectada (nunca um erro — a UI
 * trata isso como "nada pra mapear ainda", igual ao resto da plataforma).
 */
export interface ClientMetaMappingSource {
  importSourceId: string;
  externalAccountId: string;
}

export async function resolveClientMetaMappingSource(supabase: Supabase, clientId: string): Promise<ClientMetaMappingSource | null> {
  const { data, error } = await supabase
    .from("import_sources")
    .select("id, external_account_id")
    .eq("client_id", clientId)
    .eq("channel", "meta")
    .eq("provider", "meta_api")
    .eq("enabled", true)
    .maybeSingle();

  if (error) {
    console.error(`[resolveClientMetaMappingSource] falha ao resolver fonte Meta do cliente ${clientId}:`, error);
    return null;
  }
  if (!data) return null;

  return { importSourceId: data.id, externalAccountId: data.external_account_id };
}

export interface ActiveMetricMapping {
  resultColumn: string;
  valueColumn: string | null;
}

/**
 * Mapeamentos ATIVOS de uma fonte, por objetivo — mesma tabela/consulta já
 * lida por `dados-data.ts` (nunca uma segunda fonte). 'carts' (métrica
 * secundária, nunca um `PerformanceGoal` de cliente — ver
 * `secondary-cart-metric.sql`) é ignorado aqui pelo mesmo motivo que já é
 * lá: esta seção só mostra/edita objetivos de CLIENTE, nunca a métrica de
 * carrinho.
 */
export async function listActiveMetricMappingsByGoal(supabase: Supabase, importSourceId: string): Promise<Map<PerformanceGoal, ActiveMetricMapping>> {
  const rows = await requireQuery(
    supabase.from("metric_mappings").select("goal, result_column, value_column").eq("import_source_id", importSourceId).eq("active", true),
    "metric_mappings:client-metrics-section",
  );

  const map = new Map<PerformanceGoal, ActiveMetricMapping>();
  for (const row of rows) {
    const goal = parsePerformanceGoal(row.goal);
    if (!goal) continue; // 'carts' ou qualquer valor fora de PerformanceGoal — nunca um objetivo de cliente.
    map.set(goal, { resultColumn: row.result_column, valueColumn: row.value_column });
  }
  return map;
}
