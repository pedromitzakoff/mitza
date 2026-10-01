"use client";

import { useActiveClientName, useWorkspaceContextLabel } from "@/components/workspace-drawer/workspace-provider";

/**
 * MITZA 2.0 — Workspace Pessoal: registra o nome do cliente como o rótulo
 * de contexto ("Criada em: Nome do Cliente") de qualquer nota criada
 * enquanto o Prontuário estiver aberto — o padrão por rota
 * (`defaultWorkspaceContextLabel`) só sabe dizer "Cliente" genérico,
 * porque o id na URL não carrega o nome. Só existe pra chamar o hook; a
 * página do cliente continua sendo majoritariamente Server Component.
 */
export function ClientWorkspaceContext({ name }: { name: string }) {
  useWorkspaceContextLabel(name);
  return null;
}

/**
 * Etapa "MEGA FACELIFT — Fase 4.5: Navegação da Carteira" (seção 10 do
 * pedido) — registra o nome do cliente ativo pra Sidebar mostrar
 * discretamente no bloco "Cliente", sem precisar de uma segunda consulta
 * (dado já buscado por `clients/[id]/layout.tsx`, que monta este
 * componente). Deliberadamente SEPARADO de `ClientWorkspaceContext` acima
 * (campo próprio em `WorkspaceProvider`, `useActiveClientName`): aquele é
 * tied a pathname exato (só sobrevive na MESMA rota que o registrou) — é
 * pra rótulo de nota, não serviria pra persistir ao trocar de módulo do
 * mesmo cliente (Dashboard -> Metas). Este fica montado em TODAS as
 * sub-rotas do workspace (o `layout.tsx` que o renderiza nunca desmonta
 * só por trocar de módulo), então sobrevive à troca.
 */
export function ActiveClientSidebarName({ name }: { name: string }) {
  useActiveClientName(name);
  return null;
}
