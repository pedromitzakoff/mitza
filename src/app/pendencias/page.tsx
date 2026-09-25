import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { loadPendenciasRawData, loadPendingRecurringTasks } from "./pendencias-data";
import { PendenciasPageClient } from "./pendencias-page-client";

/**
 * Etapa "Pendências" — área dedicada de gestão de tarefas (seção 2 do
 * pedido: lista densa inspirada em ClickUp List View, nunca um clone).
 * Toda a filtragem/agrupamento acontece no cliente (`PendenciasPageClient`)
 * sobre os dados já carregados aqui — uma única consulta (`tasks` + joins),
 * sem N+1 por cliente/filtro, e sem round-trip ao servidor a cada troca de
 * filtro (Server Actions de edição inline continuam revalidando este
 * caminho normalmente, o que re-renderiza este Server Component com dados
 * frescos sem recarregar a página).
 */
export default async function PendenciasPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createSupabaseClient();
  const [{ items, clientOptions, assigneeOptions }, recurringTasks] = await Promise.all([
    loadPendenciasRawData(supabase),
    loadPendingRecurringTasks(supabase),
  ]);

  return (
    <PendenciasPageClient
      items={items}
      clientOptions={clientOptions}
      assigneeOptions={assigneeOptions}
      recurringTasks={recurringTasks}
      currentTeamMemberId={profile.id}
      isAdmin={profile.role === "admin"}
    />
  );
}
