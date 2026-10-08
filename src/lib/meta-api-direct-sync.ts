import { createAdminClient } from "@/lib/supabase/admin";
import { fetchMetaApiInsightsForAccount } from "@/lib/meta-api-fetch";
import { ingestMetaApiPayload } from "@/lib/meta-api-ingest-run";
import { todayDateString } from "@/lib/today";

/** Janela deliberadamente curta (hoje + 2 dias anteriores) — a busca roda a
 * cada 5 minutos (`/api/cron/sync-meta-api`), então um histórico longo a
 * cada execução seria desperdício de cota da API da Meta sem necessidade:
 * o que muda a cada 5 minutos é o dia corrente (e, por atribuição tardia da
 * própria Meta, os 1-2 dias anteriores) — nunca o histórico completo. Mesma
 * ideia de "janela curta, re-escrita idempotente" já usada em outros syncs
 * (upsert pela mesma chave natural, nunca duplica linha). */
const DIRECT_SYNC_WINDOW_DAYS = 3;

export function resolveSyncWindow(today: string): { since: string; until: string } {
  const untilDate = new Date(`${today}T00:00:00Z`);
  const sinceDate = new Date(untilDate);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - (DIRECT_SYNC_WINDOW_DAYS - 1));
  return { since: sinceDate.toISOString().slice(0, 10), until: today };
}

export interface DirectSyncResult {
  accountId: string;
  outcome: "ok" | "unregistered_account" | "disabled_source" | "concurrent_run" | "error";
  rowsRead?: number;
  errorMessage?: string;
}

/**
 * Busca e grava, pra UMA conta, os insights da janela curta
 * (`resolveSyncWindow`) — equivalente direto a um POST de
 * `/api/n8n/meta-insights` pra essa conta, só que disparado pelo próprio
 * servidor da MITZA em vez de um workflow externo. Reaproveita
 * INTEGRALMENTE `ingestMetaApiPayload` (mesma validação/agregação/gravação
 * que o caminho n8n já usa) — nenhuma segunda implementação de gravação.
 * Nunca lança — erro vira `{ outcome: "error" }`, pro chamador (cron ou
 * ação manual) decidir o que fazer, nunca travar quem chama.
 */
export async function syncOneMetaApiAccount(accountId: string): Promise<DirectSyncResult> {
  const { since, until } = resolveSyncWindow(todayDateString());
  try {
    const rows = await fetchMetaApiInsightsForAccount(accountId, since, until);
    const outcome = await ingestMetaApiPayload({ accountId, rows });

    if (outcome.kind === "ok") {
      return { accountId, outcome: "ok", rowsRead: outcome.result.rowsRead };
    }
    return { accountId, outcome: outcome.kind };
  } catch (err) {
    console.error(`[meta-api-direct-sync] Falha ao sincronizar ${accountId}:`, err);
    return { accountId, outcome: "error", errorMessage: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Busca e grava, pra TODAS as contas registradas como fonte `meta_api`
 * ativa, os insights da janela curta — mesma função (`syncOneMetaApiAccount`)
 * aplicada por conta, nunca uma segunda implementação. Usada pelo cron
 * (`/api/cron/sync-meta-api`); `syncClientMetaApiSourcesAction`
 * (`meta-api-sync-actions.ts`) usa `syncOneMetaApiAccount` diretamente pro
 * botão "Sincronizar agora" de UM cliente.
 *
 * Nunca para no primeiro erro (mesma convenção de `syncAllClientsMetaSpend`,
 * `lib/meta-sync.ts`) — uma conta com problema (token expirado, rate limit,
 * conta desativada na Meta) não pode travar a atualização das outras.
 */
export async function syncAllMetaApiAccounts(): Promise<DirectSyncResult[]> {
  const supabase = createAdminClient();
  const { data: sources, error } = await supabase
    .from("import_sources")
    .select("external_account_id")
    .eq("provider", "meta_api")
    .eq("enabled", true);

  if (error) {
    throw new Error(error.message);
  }

  const accountIds = Array.from(new Set((sources ?? []).map((s) => s.external_account_id)));
  const results: DirectSyncResult[] = [];
  for (const accountId of accountIds) {
    results.push(await syncOneMetaApiAccount(accountId));
  }
  return results;
}
