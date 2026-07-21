import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { loadClientOperationalStates } from "@/lib/client-operational-state-data";
import type { ClientOperationalState } from "@/lib/client-operational-state";

/**
 * Ponto de entrada de dados da Operação — desde a Etapa "Consolidação da
 * Arquitetura — Fase B", é um wrapper fino sobre `loadClientOperationalStates`
 * (`lib/client-operational-state-data.ts`, neutro), que também alimenta a
 * Visão Geral agora. Mesma assinatura e mesmo comportamento externo de
 * sempre — só a implementação das queries mudou de endereço (extraída pra
 * um módulo compartilhado), nenhuma fórmula mudou.
 */
export async function loadOperationTriageClients(monthParam: string): Promise<ClientOperationalState[]> {
  const supabase = await createSupabaseClient();
  return loadClientOperationalStates(supabase, monthParam);
}
