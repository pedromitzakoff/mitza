"use client";

import { useWorkspaceContextLabel } from "@/components/workspace-drawer/workspace-provider";

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
