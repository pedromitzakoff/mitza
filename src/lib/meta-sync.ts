import { createAdminClient } from "@/lib/supabase/admin";
import { fetchDailySpend } from "@/lib/meta";

export interface SyncResult {
  clientId: string;
  daysSynced: number;
}

function today() {
  return new Date().toISOString().slice(0, 10);
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
    .select("id, meta_ad_account_id")
    .eq("id", clientId)
    .single();

  if (clientError || !client) {
    throw new Error(`Cliente ${clientId} não encontrado`);
  }

  const currentDate = today();

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
        spend: d.spend,
        synced_at: new Date().toISOString(),
      })),
      { onConflict: "client_id,date" },
    );

    if (upsertError) {
      throw new Error(`Erro ao salvar daily_spend: ${upsertError.message}`);
    }
  }

  return { clientId, daysSynced: dailySpend.length };
}

/** Roda a sync acima para todos os clientes cadastrados. */
export async function syncAllClientsMetaSpend(): Promise<SyncResult[]> {
  const supabase = createAdminClient();
  const { data: clients, error } = await supabase.from("clients").select("id");

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
