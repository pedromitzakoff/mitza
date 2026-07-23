import { createAdminClient } from "@/lib/supabase/admin";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";

export interface EnsureSprintsResult {
  clientId: string;
  ok: boolean;
  error?: string;
}

/**
 * Garante que todo cliente ativo tem as sprints canônicas (regra única em
 * `compute_month_sprint_periods`, ver supabase/sprint-calendar-reconciliation.sql)
 * do mês atual + 2 à frente. Etapa 50 (correção): antes isso rodava dentro do
 * carregamento de `/clients/[id]` a cada request — gerando sprints durante a
 * própria renderização da página, o que a rodada anterior identificou como
 * incorreto. Agora só roda aqui, chamada por uma rota de cron (nunca client-
 * side, nunca dentro de um Server Component de página).
 */
export async function ensureAllClientsSprints(): Promise<EnsureSprintsResult[]> {
  const supabase = createAdminClient();
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id")
    .is("deleted_at", null)
    .eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS);

  if (error) {
    throw new Error(error.message);
  }

  const results: EnsureSprintsResult[] = [];
  for (const client of clients ?? []) {
    const { error: rpcError } = await supabase.rpc("ensure_client_sprints", {
      p_client_id: client.id,
      p_horizon_months: 2,
    });
    results.push(
      rpcError ? { clientId: client.id, ok: false, error: rpcError.message } : { clientId: client.id, ok: true },
    );
  }
  return results;
}
