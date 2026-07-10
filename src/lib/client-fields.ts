import type { ClientContractStatus, ClientMainObjective } from "@/lib/supabase/database.types";

/** Status CONTRATUAL (cadastral) — diferente da saúde operacional
 * (AccountHealth) mostrada em Sprints/Visão Geral. Não misturar os dois. */
export const CLIENT_STATUS_LABEL: Record<ClientContractStatus, string> = {
  ativo: "Ativo",
  pausado: "Pausado",
  encerrado: "Encerrado",
};

export const CLIENT_STATUS_BADGE_CLASSES: Record<ClientContractStatus, string> = {
  ativo: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  pausado: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  encerrado: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
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
