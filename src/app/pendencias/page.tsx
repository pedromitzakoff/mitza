import { getCurrentProfile } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { loadPendenciasRawData } from "./pendencias-data";
import { PendenciasPageClient } from "./pendencias-page-client";

/**
 * Etapa "Pendências" — central de DEMANDAS criadas manualmente (correção de
 * conceito: a versão original mostrava toda `tasks`, inclusive rotina
 * operacional/gerada pelo sistema — corrigido em `pendencias-data.ts`, que
 * já filtra na própria query via `template_id is null`). Toda a
 * filtragem/agrupamento acontece no cliente (`PendenciasPageClient`) sobre
 * os dados já carregados aqui — uma única consulta (`tasks` + joins), sem
 * N+1 por cliente/filtro, e sem round-trip ao servidor a cada troca de
 * filtro (Server Actions de edição inline continuam revalidando este
 * caminho normalmente, o que re-renderiza este Server Component com dados
 * frescos sem recarregar a página).
 *
 * Recorrências (`recurring_tasks`) NUNCA aparecem aqui — continuam
 * tratadas só pela Operação/`/sprints`, sem representação nesta página.
 */
export default async function PendenciasPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createSupabaseClient();
  const { items, clientOptions, assigneeOptions } = await loadPendenciasRawData(supabase);

  return (
    <PendenciasPageClient
      items={items}
      clientOptions={clientOptions}
      assigneeOptions={assigneeOptions}
      currentTeamMemberId={profile.id}
      isAdmin={profile.role === "admin"}
    />
  );
}
