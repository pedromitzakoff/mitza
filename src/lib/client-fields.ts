import type { ClientContractStatus, ClientMainObjective } from "@/lib/supabase/database.types";
import { CLIENT_CONTRACT_STATUS_REGISTRY } from "@/lib/status-registry";

/** Status CONTRATUAL (cadastral) — diferente da saúde operacional
 * (AccountHealth) mostrada em Sprints/Visão Geral. Não misturar os dois.
 * Deriva do Status Registry (`@/lib/status-registry`), ver Platform
 * Integrity Wave 1. */
export const CLIENT_STATUS_LABEL: Record<ClientContractStatus, string> = {
  ativo: CLIENT_CONTRACT_STATUS_REGISTRY["client_contract.ativo"].label,
  pausado: CLIENT_CONTRACT_STATUS_REGISTRY["client_contract.pausado"].label,
  encerrado: CLIENT_CONTRACT_STATUS_REGISTRY["client_contract.encerrado"].label,
};

export const CLIENT_STATUS_BADGE_CLASSES: Record<ClientContractStatus, string> = {
  ativo: CLIENT_CONTRACT_STATUS_REGISTRY["client_contract.ativo"].badgeClassName,
  pausado: CLIENT_CONTRACT_STATUS_REGISTRY["client_contract.pausado"].badgeClassName,
  encerrado: CLIENT_CONTRACT_STATUS_REGISTRY["client_contract.encerrado"].badgeClassName,
};

/**
 * Princípio "Workspace = só cliente ativo" — fonte única do que conta
 * como "dentro do Workspace" (toda tela/fila/job operacional). Cliente
 * pausado ou encerrado nunca aparece em nenhuma superfície operacional
 * (Sidebar, Pastas dos gestores, Visão Geral, Operação, Dashboard,
 * Relatórios, Sprints, Painel Mensal, contagens de carga, sync/geração
 * automática) — só em Configurações > Clientes (histórico/administração)
 * e, em modo de consulta, na própria página do cliente/relatório
 * acessada por URL direta. Reativar (`status` volta a "ativo") restaura a
 * presença em toda consulta que usa este critério automaticamente, sem
 * nenhuma ação manual adicional.
 *
 * Toda query Supabase que precisa desse filtro usa
 * `WORKSPACE_ACTIVE_CONTRACT_STATUS` diretamente (`.eq("status", ...)`) —
 * não há como passar uma função pra dentro do query builder. Checagem em
 * memória sobre um cliente já carregado (banner de status, esconder uma
 * ação) usa `isWorkspaceClient`. Os dois derivam do mesmo valor único.
 */
export const WORKSPACE_ACTIVE_CONTRACT_STATUS: ClientContractStatus = "ativo";

export function isWorkspaceClient(client: { status: ClientContractStatus }): boolean {
  return client.status === WORKSPACE_ACTIVE_CONTRACT_STATUS;
}

/** `null` quando ativo (nenhum aviso — o Workspace já garante que só
 * cliente ativo aparece nas telas normais). Nas duas páginas que
 * continuam acessíveis por URL direta mesmo pausado/encerrado (cliente,
 * relatório individual), este é o único texto do aviso — nunca montado
 * de novo em cada tela. */
export function contractStatusBannerText(status: ClientContractStatus): string | null {
  if (status === "pausado") return "Cliente pausado — fora da operação atual.";
  if (status === "encerrado") return "Cliente encerrado — relacionamento encerrado.";
  return null;
}

export const CLIENT_MAIN_OBJECTIVE_LABEL: Record<ClientMainObjective, string> = {
  leads: "Leads",
  vendas: "Vendas",
  reservas: "Reservas",
  reconhecimento: "Reconhecimento",
  trafego: "Tráfego",
  outro: "Outro",
};

/** Modelagem simples pro campo `contracted_services` (text[]) — validado só
 * na aplicação, sem constraint no banco, pra não travar a lista no futuro. */
export const CONTRACTED_SERVICE_OPTIONS = [
  "Meta Ads",
  "Google Ads",
  "TikTok Ads",
  "LinkedIn Ads",
  "Relatórios",
  "Copy",
  "Tracking",
  "Outro",
] as const;
