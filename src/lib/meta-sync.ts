import { createAdminClient } from "@/lib/supabase/admin";
import { fetchDailySpend, MetaSyncError, type MetaSyncErrorKind } from "@/lib/meta";
import { currentMonthRange } from "@/lib/sprint-financials";
import { todayDateString } from "@/lib/today";

export type ClientSyncStatus = "synced" | "skipped_no_account" | "error";

export interface ClientSyncResult {
  clientId: string;
  status: ClientSyncStatus;
  /** Quantidade de dias inseridos/atualizados em daily_spend (0 se skipped/error). */
  daysSynced: number;
  /** Presente só quando status === "error" — nunca inclui o token. */
  errorKind?: MetaSyncErrorKind;
  errorMessage?: string;
}

export interface SyncSummary {
  syncedAt: string;
  /** Total de clientes elegíveis considerados (não inclui excluídos). */
  processed: number;
  synced: number;
  skipped: number;
  failed: number;
  totalDaysSynced: number;
  results: ClientSyncResult[];
}

/**
 * Busca o spend diário do Meta do primeiro dia do mês corrente até hoje e
 * salva em `daily_spend` (upsert por client_id+date — nunca duplica, nunca
 * associa o gasto à data da sincronização). Não depende de existir uma
 * sprint atual: o vínculo com sprint/mês acontece depois, só na leitura
 * (computeSprintEffectiveSpend/sumActualSpendForMonth), nunca aqui.
 *
 * Usa o client admin (service role) porque roda fora do contexto de uma
 * sessão de usuário (script ou rota de cron) e porque a escrita em
 * `daily_spend` é restrita ao admin via RLS — quem chama esta função (ação
 * do botão, cron) já validou a autorização do usuário antes de chegar aqui.
 */
export async function syncClientMetaSpend(clientId: string): Promise<ClientSyncResult> {
  const supabase = createAdminClient();

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, meta_ad_account_id, deleted_at")
    .eq("id", clientId)
    .single();

  if (clientError || !client) {
    return { clientId, status: "error", daysSynced: 0, errorKind: "unknown", errorMessage: "Cliente não encontrado." };
  }

  if (client.deleted_at) {
    return { clientId, status: "skipped_no_account", daysSynced: 0 };
  }

  if (!client.meta_ad_account_id) {
    return { clientId, status: "skipped_no_account", daysSynced: 0 };
  }

  const { firstDay } = currentMonthRange();
  const today = todayDateString();

  let dailySpend;
  try {
    dailySpend = await fetchDailySpend(client.meta_ad_account_id, firstDay, today);
  } catch (err) {
    if (err instanceof MetaSyncError) {
      return { clientId, status: "error", daysSynced: 0, errorKind: err.kind, errorMessage: err.message };
    }
    return { clientId, status: "error", daysSynced: 0, errorKind: "unknown", errorMessage: "Erro ao consultar a Meta." };
  }

  if (dailySpend.length > 0) {
    const { error: upsertError } = await supabase.from("daily_spend").upsert(
      dailySpend.map((d) => ({
        client_id: clientId,
        date: d.date,
        spend: d.spend,
        synced_at: new Date().toISOString(),
      })),
      { onConflict: "client_id,date" },
    );

    if (upsertError) {
      return { clientId, status: "error", daysSynced: 0, errorKind: "unknown", errorMessage: "Erro ao salvar o gasto sincronizado." };
    }
  }

  return { clientId, status: "synced", daysSynced: dailySpend.length };
}

/** Roda a sync acima pra todos os clientes ativos (não excluídos) —
 * clientes sem `meta_ad_account_id` configurado são apenas ignorados
 * (`skipped_no_account`), nunca tratados como erro; uma falha numa conta
 * nunca impede a sincronização das demais. */
export async function syncAllClientsMetaSpend(): Promise<SyncSummary> {
  const supabase = createAdminClient();
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id")
    .is("deleted_at", null);

  if (error) {
    throw new Error(error.message);
  }

  const results: ClientSyncResult[] = [];
  for (const client of clients ?? []) {
    results.push(await syncClientMetaSpend(client.id));
  }

  return {
    syncedAt: new Date().toISOString(),
    processed: results.length,
    synced: results.filter((r) => r.status === "synced").length,
    skipped: results.filter((r) => r.status === "skipped_no_account").length,
    failed: results.filter((r) => r.status === "error").length,
    totalDaysSynced: results.reduce((sum, r) => sum + r.daysSynced, 0),
    results,
  };
}
