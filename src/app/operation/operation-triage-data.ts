import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { loadOperationChannelStates } from "@/lib/operation-channel-state-data";
import type { ClientOperationalState } from "@/lib/client-operational-state";
import type { TrafficChannel } from "@/lib/traffic-channels";

/**
 * Ponto de entrada de dados da Operação — Etapa "Operação por Canal": a
 * Operação deixou de ter uma leitura consolidada (multi-canal) e passa a
 * exigir sempre um canal (`"meta"`/`"google"`) — nunca mais um wrapper sobre
 * `loadClientOperationalStates` (consolidado, `lib/client-operational-state-data.ts`,
 * que continua intocado e é quem ainda alimenta Dashboard/Visão Geral do
 * cliente/Relatórios/Sprints). Delega inteiramente pra
 * `loadOperationChannelStates` (`lib/operation-channel-state-data.ts`) — ver
 * a docstring de lá pro porquê da pipeline separada.
 */
export async function loadOperationTriageClients(monthParam: string, channel: TrafficChannel): Promise<ClientOperationalState[]> {
  const supabase = await createSupabaseClient();
  return loadOperationChannelStates(supabase, monthParam, channel);
}
