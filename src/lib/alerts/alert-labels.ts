import { ALERT_SEVERITY_REGISTRY, ALERT_STATUS_REGISTRY } from "@/lib/status-registry";
import type { AlertSeverity, AlertStatus, AlertType } from "@/lib/alerts/alert-types";

/** Adapters finos derivados do Status Registry (`@/lib/status-registry`) —
 * mesmo padrão de `SPEND_STATUS_LABEL`/`SPEND_STATUS_BADGE_CLASSES`: nunca
 * uma cor/rótulo redeclarado fora do registry. */
export const ALERT_SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critico: ALERT_SEVERITY_REGISTRY["alert_severity.critico"].label,
  atencao: ALERT_SEVERITY_REGISTRY["alert_severity.atencao"].label,
  oportunidade: ALERT_SEVERITY_REGISTRY["alert_severity.oportunidade"].label,
};

export const ALERT_SEVERITY_BADGE_CLASSES: Record<AlertSeverity, string> = {
  critico: ALERT_SEVERITY_REGISTRY["alert_severity.critico"].badgeClassName,
  atencao: ALERT_SEVERITY_REGISTRY["alert_severity.atencao"].badgeClassName,
  oportunidade: ALERT_SEVERITY_REGISTRY["alert_severity.oportunidade"].badgeClassName,
};

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  precisa_atencao: ALERT_STATUS_REGISTRY["alert_status.precisa_atencao"].label,
  acompanhamento: ALERT_STATUS_REGISTRY["alert_status.acompanhamento"].label,
  resolvido: ALERT_STATUS_REGISTRY["alert_status.resolvido"].label,
};

export const ALERT_STATUS_BADGE_CLASSES: Record<AlertStatus, string> = {
  precisa_atencao: ALERT_STATUS_REGISTRY["alert_status.precisa_atencao"].badgeClassName,
  acompanhamento: ALERT_STATUS_REGISTRY["alert_status.acompanhamento"].badgeClassName,
  resolvido: ALERT_STATUS_REGISTRY["alert_status.resolvido"].badgeClassName,
};

/** Ordem canônica das 3 abas da tela (pedido do usuário: "troque as três
 * colunas [Kanban] por abas com contagem") — mesma ordem já usada pro
 * `order` do Status Registry; única fonte, nunca uma 2ª lista hardcoded
 * em `alerts-tabs.tsx`. */
export const ALERT_STATUS_COLUMN_ORDER: AlertStatus[] = ["precisa_atencao", "acompanhamento", "resolvido"];

/** Pedido, seção 2: rótulo de cada tipo — só "spend_pace" tem avaliador
 * implementado nesta fase (`IMPLEMENTED_ALERT_TYPES`), os demais existem
 * aqui pro filtro "Tipo" e pra UI nunca precisar de um `?? "Tipo desconhecido"`
 * quando os próximos forem implementados. */
export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  spend_pace: "Gasto acima/abaixo do previsto",
  no_delivery: "Conta sem entrega",
  cost_per_result_increase: "Aumento do custo por resultado",
  spend_without_result: "Gasto relevante sem resultado",
  sync_issue: "Problema de dados ou sincronização",
  opportunity: "Oportunidade",
};
