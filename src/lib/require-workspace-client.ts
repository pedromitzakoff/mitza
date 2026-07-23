import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { isWorkspaceClient } from "@/lib/client-fields";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Segunda camada de defesa do princípio "Workspace = só cliente ativo":
 * a primeira é a UI (botão/formulário escondido quando o cliente está
 * pausado/encerrado, ver `clients/[id]/page.tsx`), esta garante que
 * nenhuma Server Action que cria/altera registro operacional (tarefa,
 * comentário, otimização) execute pra um cliente sem contrato ativo,
 * mesmo com uma aba/cache desatualizado. Único ponto que faz essa
 * checagem — nunca reimplementada solta em cada action.
 *
 * Retorna a mensagem de erro pronta (nunca lança) pra encaixar direto no
 * contrato `{ error?: string }`/`redirect(...&Error=...)` que cada action
 * já usa — quem chama decide como exibir.
 */
export async function checkWorkspaceClientAction(supabase: Supabase, clientId: string): Promise<string | null> {
  const { data: client } = await supabase.from("clients").select("status").eq("id", clientId).single();
  if (!client || !isWorkspaceClient(client)) {
    return "Este cliente está pausado ou encerrado — ações operacionais estão bloqueadas.";
  }
  return null;
}
