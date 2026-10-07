import { cache } from "react";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { requireQuery } from "@/lib/require-query";
import { WORKSPACE_ACTIVE_CONTRACT_STATUS } from "@/lib/client-fields";
import { buildAgencyAccountsTree, type AgencyTree } from "./agency-accounts-tree";

/**
 * Busca + construção da árvore "Contas da Agência", extraída de
 * `agency-accounts-tree.tsx` (Sidebar) pra ser reaproveitada também pelo
 * layout do workspace do cliente (Etapa "MITZA — Reformulação Estrutural" —
 * seletor rápido/anterior-próximo). Envolvida em `cache()` do React (mesmo
 * padrão de `getCurrentProfile`, `lib/auth.ts`) — todo consumidor que pedir
 * a árvore com os MESMOS argumentos na MESMA requisição reaproveita a
 * mesma consulta, nunca uma segunda ida ao Supabase.
 *
 * MITZA ONE — Fase 2 (Sidebar = Carteira de Clientes): `includeAllStatuses`
 * é a ÚNICA diferença entre as duas populações possíveis — por padrão
 * (`undefined`/`false`, todo chamador de antes desta fase: `app/page.tsx`
 * resolvendo "/", `agency-accounts-tree.tsx` na árvore de Gestão de
 * `/clients`) continua "Workspace = só cliente ativo", regra de negócio
 * INTOCADA. A Sidebar (seção 1 do pedido: "clientes inativos/pausados
 * devem seguir as regras existentes de visibilidade; não assumir
 * exclusão") passa `includeAllStatuses: true` — mesma função, mesmo
 * agrupamento por gestor/`wallet_position`, só sem o filtro de contrato;
 * RLS continua sendo o único filtro de PERMISSÃO real (este `.eq`/sua
 * ausência nunca decidiu quem pode ver o quê, só qual RECORTE de contrato
 * entra na árvore). Argumentos diferentes = chamadas de `cache()`
 * diferentes (nunca reaproveitadas uma pela outra, de propósito — são
 * populações genuinamente distintas).
 */
export const loadAgencyAccountsTree = cache(async (options?: { includeAllStatuses?: boolean }): Promise<AgencyTree> => {
  const supabase = await createSupabaseClient();
  let clientsQuery = supabase
    .from("clients")
    .select("id, name, wallet_position, avatar_url, status, primary_manager:team_members!clients_primary_manager_id_fkey(id, name)")
    .is("deleted_at", null);
  if (!options?.includeAllStatuses) {
    // Princípio "Workspace = só cliente ativo", sem exceção — mesmo
    // critério de sempre (ver `agency-accounts-tree.tsx`), preservado
    // byte a byte pra quem não pediu `includeAllStatuses`.
    clientsQuery = clientsQuery.eq("status", WORKSPACE_ACTIVE_CONTRACT_STATUS);
  }

  const [clients, managers] = await Promise.all([
    requireQuery(clientsQuery.order("wallet_position", { ascending: true, nullsFirst: false }).order("name"), "clients"),
    requireQuery(supabase.from("team_members").select("id, name").eq("status", "ativo").order("name"), "team_members"),
  ]);

  return buildAgencyAccountsTree(clients, managers);
});
