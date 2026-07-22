import type {
  ClientContractStatus,
  MonthlyReportStatus,
  ReportActionItemStatus,
  TaskStatus,
  TeamInvitationStatus,
  TeamMemberStatus,
} from "@/lib/supabase/database.types";
import type { OperationalActivityStatus } from "@/lib/operational-activity";
import type { SpendStatus } from "@/lib/spend-status";
import type { KpiTargetStatus } from "@/lib/monthly-reports";
import type { OperationTriageBand } from "@/lib/operation-triage";

/**
 * Etapa "MITZA Platform Constitution 1.0" (Wave 1 — Representação),
 * decisão 003 da Platform Integrity Review: Status não é UM enum — cada
 * eixo de negócio (contrato do cliente, tarefa, saúde de conta, atividade
 * operacional, ritmo financeiro, relatório mensal, item de ação, meta de
 * KPI) é uma dimensão real e distinta, e continua com seu próprio enum
 * em `database.types.ts`/`lib`. O que este arquivo centraliza não é o
 * DADO, é a REPRESENTAÇÃO desse dado — label, classe visual do badge e
 * ordem — que hoje estava espalhada em 8 mapas `_BADGE_CLASSES` e ~10
 * mapas `_LABEL` independentes (ver Platform Integrity Audit 1.0).
 *
 * Cada chave é qualificada por domínio (`"task.pendente"`, nunca
 * `"pendente"` sozinho) — isso resolve a ambiguidade real encontrada na
 * auditoria: `"atencao"` significava coisas diferentes em
 * `AccountHealth`/`OperationalActivityStatus`, e `"em_andamento"`
 * significava coisas diferentes em `SpendStatus`/`MonthlyReportStatus`/
 * `ReportActionItemStatus`. O domínio no nome da chave garante que dois
 * eixos nunca colidam, mesmo reaproveitando o mesmo valor de enum.
 *
 * Os domínios que colidiam em texto (`atencao`, `em_andamento`) recebem
 * aqui um label QUALIFICADO ("Conta em atenção" vs. "Operação em
 * atenção"; "Sprint em andamento" vs. "Relatório em andamento" vs. "Item
 * em andamento") — mudança de vocabulário já aprovada na Platform
 * Integrity Review (Decisão 003) e na própria etapa desta constituição
 * (Parte E6). Nenhuma classe visual (cor) foi alterada nesta migração —
 * são as mesmas classes que já existiam em cada `_BADGE_CLASSES`
 * original, só centralizadas aqui.
 *
 * As constantes antigas (`TASK_STATUS_BADGE_CLASSES`, `CLIENT_STATUS_LABEL`
 * etc.) continuam existindo com a mesma assinatura pública — viraram
 * adapters finos derivados deste registry (ver cada arquivo de domínio),
 * então nenhum ponto de consumo no resto da plataforma precisou mudar.
 */

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info" | "brand";

export interface StatusEntry {
  label: string;
  badgeClassName: string;
  tone: StatusTone;
  order: number;
}

const NEUTRAL_MUTED = "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
const SUCCESS = "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300";
const WARNING = "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
const DANGER = "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
const INFO = "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300";
const BRAND_SOFT = "bg-brand/10 text-brand";

export const TASK_STATUS_REGISTRY: Record<`task.${TaskStatus}`, StatusEntry> = {
  "task.pendente": { label: "Pendente", badgeClassName: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300", tone: "neutral", order: 0 },
  "task.feito": { label: "Feito", badgeClassName: SUCCESS, tone: "success", order: 1 },
  "task.atrasado": { label: "Atrasado", badgeClassName: DANGER, tone: "danger", order: 2 },
  "task.nao_realizado": { label: "Não realizado", badgeClassName: NEUTRAL_MUTED, tone: "neutral", order: 3 },
};

export const CLIENT_CONTRACT_STATUS_REGISTRY: Record<`client_contract.${ClientContractStatus}`, StatusEntry> = {
  "client_contract.ativo": { label: "Ativo", badgeClassName: SUCCESS, tone: "success", order: 0 },
  "client_contract.pausado": { label: "Pausado", badgeClassName: WARNING, tone: "warning", order: 1 },
  "client_contract.encerrado": { label: "Encerrado", badgeClassName: NEUTRAL_MUTED, tone: "neutral", order: 2 },
};

export const SPEND_STATUS_REGISTRY: Record<`spend.${SpendStatus}`, StatusEntry> = {
  "spend.dentro": { label: "Dentro", badgeClassName: SUCCESS, tone: "success", order: 0 },
  "spend.acima": { label: "Acima", badgeClassName: DANGER, tone: "danger", order: 1 },
  "spend.abaixo": { label: "Abaixo", badgeClassName: WARNING, tone: "warning", order: 2 },
  "spend.sem_meta": { label: "Sem planejamento", badgeClassName: NEUTRAL_MUTED, tone: "neutral", order: 3 },
  "spend.nao_iniciado": { label: "Ainda não iniciada", badgeClassName: NEUTRAL_MUTED, tone: "neutral", order: 4 },
  // Qualificado (colidia em texto com monthly_report.em_andamento e
  // report_action_item.em_andamento — achado adicional desta etapa, mesma
  // categoria do que a auditoria já tinha encontrado com "atencao").
  "spend.em_andamento": { label: "Sprint em andamento", badgeClassName: BRAND_SOFT, tone: "brand", order: 5 },
};

export const OPERATIONAL_ACTIVITY_STATUS_REGISTRY: Record<`operational_activity.${OperationalActivityStatus}`, StatusEntry> = {
  "operational_activity.ativo": { label: "Ativo", badgeClassName: SUCCESS, tone: "success", order: 0 },
  // Qualificado — colidia em texto com account_health.atencao (achado
  // original da auditoria).
  "operational_activity.atencao": { label: "Operação em atenção", badgeClassName: WARNING, tone: "warning", order: 1 },
  "operational_activity.inativo": { label: "Inativo", badgeClassName: DANGER, tone: "danger", order: 2 },
};

export const TEAM_MEMBER_STATUS_REGISTRY: Record<`team_member.${TeamMemberStatus}`, StatusEntry> = {
  "team_member.ativo": { label: "Ativo", badgeClassName: SUCCESS, tone: "success", order: 0 },
  "team_member.inativo": { label: "Inativo", badgeClassName: NEUTRAL_MUTED, tone: "neutral", order: 1 },
};

export const TEAM_INVITATION_STATUS_REGISTRY: Record<`team_invitation.${TeamInvitationStatus}`, StatusEntry> = {
  "team_invitation.sem_acesso": { label: "Sem acesso", badgeClassName: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400", tone: "neutral", order: 0 },
  "team_invitation.convite_pendente": { label: "Convite pendente", badgeClassName: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400", tone: "warning", order: 1 },
  "team_invitation.acesso_ativo": { label: "Acesso ativo", badgeClassName: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400", tone: "success", order: 2 },
};

export const MONTHLY_REPORT_STATUS_REGISTRY: Record<`monthly_report.${MonthlyReportStatus}`, StatusEntry> = {
  "monthly_report.nao_iniciado": { label: "Não iniciado", badgeClassName: NEUTRAL_MUTED, tone: "neutral", order: 0 },
  // Qualificado — colidia em texto com spend.em_andamento e
  // report_action_item.em_andamento.
  "monthly_report.em_andamento": { label: "Relatório em andamento", badgeClassName: WARNING, tone: "warning", order: 1 },
  "monthly_report.pronto_revisao": { label: "Pronto para revisão", badgeClassName: INFO, tone: "info", order: 2 },
  "monthly_report.finalizado": { label: "Finalizado", badgeClassName: SUCCESS, tone: "success", order: 3 },
};

export const REPORT_ACTION_ITEM_STATUS_REGISTRY: Record<`report_action_item.${ReportActionItemStatus}`, StatusEntry> = {
  "report_action_item.pendente": { label: "Pendente", badgeClassName: NEUTRAL_MUTED, tone: "neutral", order: 0 },
  // Qualificado — colidia em texto com spend.em_andamento e
  // monthly_report.em_andamento.
  "report_action_item.em_andamento": { label: "Item em andamento", badgeClassName: WARNING, tone: "warning", order: 1 },
  "report_action_item.concluido": { label: "Concluído", badgeClassName: SUCCESS, tone: "success", order: 2 },
};

export const KPI_TARGET_STATUS_REGISTRY: Record<`kpi_target.${KpiTargetStatus}`, StatusEntry> = {
  "kpi_target.atingiu": { label: "Bateu meta", badgeClassName: SUCCESS, tone: "success", order: 0 },
  "kpi_target.abaixo": { label: "Abaixo da meta", badgeClassName: WARNING, tone: "warning", order: 1 },
  "kpi_target.sem_meta": { label: "Sem meta", badgeClassName: NEUTRAL_MUTED, tone: "neutral", order: 2 },
};

/** Banda de triagem da tela Operação (`lib/operation-triage.ts`) — dimensão
 * própria, distinta de `account_health` (3 níveis, usado na página do
 * Cliente): a Operação precisa de uma banda intermediária a mais pra
 * refletir "vale acompanhar, mas não é urgente" sem forçá-la pra dentro de
 * "atenção" nem de "saudável". `em_acompanhamento` usa `neutral` (não
 * inventa um 4º tom de cor) — é deliberadamente mais discreta que
 * `warning`, pra não competir visualmente com o que precisa de ação agora. */
export const OPERATION_TRIAGE_BAND_REGISTRY: Record<`operation_triage.${OperationTriageBand}`, StatusEntry> = {
  // Rótulo "Ação necessária" (Etapa "Redesenho da Operação") — só o texto
  // exibido mudou; a chave interna `precisa_atencao` é mantida (usada em
  // filtros/URLs e no mapeamento `bandFromHealthStatus`).
  "operation_triage.precisa_atencao": { label: "Ação necessária", badgeClassName: DANGER, tone: "danger", order: 0 },
  "operation_triage.em_risco": { label: "Em risco", badgeClassName: WARNING, tone: "warning", order: 1 },
  "operation_triage.em_acompanhamento": { label: "Em acompanhamento", badgeClassName: NEUTRAL_MUTED, tone: "neutral", order: 2 },
  "operation_triage.saudavel": { label: "Saudável", badgeClassName: SUCCESS, tone: "success", order: 3 },
};

/** Todos os registries num só objeto, só pra quem precisar iterar sobre
 * todos os domínios de uma vez (ex.: uma futura tela de auditoria viva) —
 * consumo normal continua sendo direto pelo registry do próprio domínio. */
export const STATUS_REGISTRIES = {
  task: TASK_STATUS_REGISTRY,
  client_contract: CLIENT_CONTRACT_STATUS_REGISTRY,
  spend: SPEND_STATUS_REGISTRY,
  operational_activity: OPERATIONAL_ACTIVITY_STATUS_REGISTRY,
  team_member: TEAM_MEMBER_STATUS_REGISTRY,
  team_invitation: TEAM_INVITATION_STATUS_REGISTRY,
  monthly_report: MONTHLY_REPORT_STATUS_REGISTRY,
  report_action_item: REPORT_ACTION_ITEM_STATUS_REGISTRY,
  kpi_target: KPI_TARGET_STATUS_REGISTRY,
  operation_triage: OPERATION_TRIAGE_BAND_REGISTRY,
} as const;
