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
