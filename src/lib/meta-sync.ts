import { createAdminClient } from "@/lib/supabase/admin";
import { fetchDailySpend } from "@/lib/meta";
import { todayDateString } from "@/lib/today";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS, isWorkspaceClient } from "@/lib/client-fields";

export interface SyncResult {
  clientId: string;
  daysSynced: number;
}

/**
 * Busca o spend diário do Meta desde o início da sprint atual do cliente
 * até hoje, e salva em `daily_spend`. Usa o client admin (service role)
 * porque isso roda fora do contexto de uma sessão de usuário (script ou
 * rota de cron) e porque a escrita em `daily_spend` é restrita ao admin
 * via RLS — quem chama esta função já deve ter validado o acesso do
 * usuário ao cliente antes (ver `syncClientMetaAction`).
 */
export async function syncClientMetaSpend(clientId: string): Promise<SyncResult> {
  const supabase = createAdminClient();

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, meta_ad_account_id, deleted_at, status")
    .eq("id", clientId)
    .single();

  if (clientError || !client) {
    throw new Error(`Cliente ${clientId} não encontrado`);
  }

  if (client.deleted_at) {
    throw new Error(`Cliente ${clientId} foi excluído`);
  }

  // Princípio "Workspace = só cliente ativo": pausado/encerrado não
  // recebe sincronização automática nem manual — evita gastar cota da
  // API do Meta e criar dado novo numa conta sem contrato ativo.
  if (!isWorkspaceClient(client)) {
    throw new Error(`Cliente ${clientId} está com status "${client.status}" — sincronização automática pausada.`);
  }

  const currentDate = todayDateString();

  const { data: sprint, error: sprintError } = await supabase
    .from("sprints")
    .select("id, start_date, end_date")
    .eq("client_id", clientId)
    .lte("start_date", currentDate)
    .gte("end_date", currentDate)
    .single();

  if (sprintError || !sprint) {
    throw new Error(`Nenhuma sprint atual encontrada para o cliente ${clientId}`);
  }

  const dailySpend = await fetchDailySpend(client.meta_ad_account_id, sprint.start_date, currentDate);

  if (dailySpend.length > 0) {
    const { error: upsertError } = await supabase.from("daily_spend").upsert(
      dailySpend.map((d) => ({
        client_id: clientId,
        date: d.date,
        channel: "meta",
        spend: d.spend,
        synced_at: new Date().toISOString(),
      })),
      { onConflict: "client_id,date,channel" },
    );

    if (upsertError) {
      throw new Error(`Erro ao salvar daily_spend: ${upsertError.message}`);
    }
  }

  return { clientId, daysSynced: dailySpend.length };
}

/** Roda a sync acima só pros clientes ativos (Workspace) — pausado/
 * encerrado nem entra no loop, pra não gerar erro/log por tentativa
 * bloqueada pelo guard de `syncClientMetaSpend` acima. */
export async function syncAllClientsMetaSpend(): Promise<SyncResult[]> {
  const supabase = createAdminClient();
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id")
    .is("deleted_at", null)
    .eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS);

  if (error) {
    throw new Error(error.message);
  }

  const results: SyncResult[] = [];
  for (const client of clients ?? []) {
    try {
      results.push(await syncClientMetaSpend(client.id));
    } catch (err) {
      console.error(`Falha ao sincronizar cliente ${client.id}:`, err);
    }
  }
  return results;
}
