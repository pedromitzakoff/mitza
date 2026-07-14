import type { OperationClientCard } from "@/app/operation/operation-data";
import type { AccountHealth } from "@/lib/attention-alerts";
import { businessDaysSince } from "@/lib/business-days";
import { effectiveTaskStatus } from "@/lib/task-status";

/** Mesmos limiares já usados pela antiga Central de Atenção pra decidir
 * quando tarefas atrasadas são "críticas" (não qualquer atraso vira
 * prioridade máxima) — preservados aqui, não uma regra nova. */
const TASK_OVERDUE_DAYS_THRESHOLD = 2;
const TASK_OVERDUE_COUNT_THRESHOLD = 3;

function parseDateUTC(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export interface ClientPriorityIssue {
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}

export interface ClientPriority {
  clientId: string;
  clientName: string;
  /** Igual a `card.accountHealth` — nunca uma segunda classificação de
   * severidade. "Prioridades de hoje" e "Saúde da operação" sempre
   * concordam sobre qual severidade cada cliente tem. */
  severity: AccountHealth;
  /** Só pra ordenação — nunca exibido na interface. */
  priorityScore: number;
  /** null quando o cliente está saudável — não entra na fila. */
  primaryIssue: ClientPriorityIssue | null;
  /** Dias úteis em aberto do problema principal, quando isso é um dado
   * real (tarefa atrasada, sem execução) — null quando a natureza do
   * problema não tem uma "idade" confiável (ex.: ritmo de investimento),
   * pra nunca inventar um número. */
  issueAgeBusinessDays: number | null;
  secondaryCount: number;
  secondaryIssues: { title: string; description: string }[];
}

/**
 * Prioridade de UM cliente, hoje — função central e determinística (Etapa
 * 46, seção 12 do pedido). Nunca inventa sinal novo: cada regra abaixo já
 * existe em algum lugar do sistema (classifySpendStatus, sprintFilterBucket,
 * alertas de otimização, tipos de tarefa). A novidade aqui é só a ORDEM em
 * que essas regras são consultadas pra decidir qual é O problema principal
 * de um cliente que pode ter vários — e o pacote de dados (severidade,
 * idade do problema, ação recomendada, destino) que a Visão Geral precisa
 * pra virar uma fila de trabalho, não uma lista de alertas.
 *
 * Hierarquia (primeira que bater, ganha — a lista completa dos "Problemas
 * secundários" guarda as demais que também bateram):
 *   1. Investimento significativamente acima do ritmo
 *   2. Tarefa(s) crítica(s) atrasada(s) (mesmo limiar de sempre)
 *   3. Sprint sem execução
 *   4. Investimento significativamente abaixo do ritmo
 *   5. Otimização vencida
 *   6. Entrega de criativo atrasada
 *   7. Tarefa atrasada (abaixo do limiar de "crítica")
 *   8. Sem atividade operacional recente
 *   9. Qualquer outro alerta já calculado (fallback — nunca deixa um
 *      cliente não-saudável sem nenhum texto de problema)
 *
 * Itens fora do que o sistema calcula hoje com confiança (saldo da conta,
 * reuniões, criativos entregues via WhatsApp, relacionamento) ficam de fora
 * de propósito — a lista acima é só o que já existe, arquitetura pronta
 * pra crescer sem precisar mudar quem chama esta função.
 */
export function getClientPriority(card: OperationClientCard, today: Date): ClientPriority {
  const candidates: { tier: number; issue: ClientPriorityIssue; ageBusinessDays: number | null }[] = [];

  const sprintHref = card.sprint ? `/clients/${card.clientId}#sprint-${card.sprint.sprintId}` : `/clients/${card.clientId}`;
  const clientHref = `/clients/${card.clientId}`;

  if (card.monthStatus === "acima") {
    candidates.push({
      tier: 1,
      issue: {
        title: "Investimento acima do ritmo esperado",
        description: `${Math.round((card.monthActual / (card.monthPlanned || 1)) * 100)}% já realizado no mês`,
        actionLabel: "Abrir cliente",
        actionHref: clientHref,
      },
      ageBusinessDays: null,
    });
  }

  const overdueCount = card.overdueTasks.length;
  if (overdueCount > 0) {
    const oldestDays = Math.max(...card.overdueTasks.map((t) => businessDaysSince(parseDateUTC(t.due_date), today)));
    const isCritical = oldestDays >= TASK_OVERDUE_DAYS_THRESHOLD || overdueCount >= TASK_OVERDUE_COUNT_THRESHOLD;
    const plural = overdueCount !== 1 ? "s" : "";
    candidates.push({
      tier: isCritical ? 2 : 7,
      issue: {
        title: `${overdueCount} tarefa${plural} crítica${plural} atrasada${plural}`,
        description: `Atrasada${plural} há ${oldestDays} dia${oldestDays !== 1 ? "s" : ""} úteis`,
        actionLabel: "Abrir sprint",
        actionHref: sprintHref,
      },
      ageBusinessDays: oldestDays,
    });
  }

  if (card.sprintExecutionInfo && card.sprint) {
    candidates.push({
      tier: 3,
      issue: {
        title: "Sem execução",
        description: `Sprint sem execução há ${card.sprintExecutionInfo.businessDays} dias úteis`,
        actionLabel: "Abrir sprint",
        actionHref: sprintHref,
      },
      ageBusinessDays: card.sprintExecutionInfo.businessDays,
    });
  }

  if (card.monthStatus === "abaixo") {
    candidates.push({
      tier: 4,
      issue: {
        title: "Investimento abaixo do ritmo esperado",
        description: `${Math.round((card.monthActual / (card.monthPlanned || 1)) * 100)}% já realizado no mês`,
        actionLabel: "Abrir cliente",
        actionHref: clientHref,
      },
      ageBusinessDays: null,
    });
  }

  if (card.alerts.some((a) => a.kind === "otimizacao")) {
    candidates.push({
      tier: 5,
      issue: {
        title: "Otimização vencida",
        description: "Nenhuma otimização registrada recentemente",
        actionLabel: "Abrir sprint",
        actionHref: sprintHref,
      },
      ageBusinessDays: null,
    });
  }

  const overdueCreativeDeliveries = card.monthTasks.filter(
    (t) => t.type === "entrega_criativo" && effectiveTaskStatus(t, today) === "atrasado",
  );
  if (overdueCreativeDeliveries.length > 0) {
    candidates.push({
      tier: 6,
      issue: {
        title: "Entrega de criativo atrasada",
        description: `${overdueCreativeDeliveries.length} entrega${overdueCreativeDeliveries.length !== 1 ? "s" : ""} pendente${overdueCreativeDeliveries.length !== 1 ? "s" : ""}`,
        actionLabel: "Abrir sprint",
        actionHref: sprintHref,
      },
      ageBusinessDays: null,
    });
  }

  if (card.activityStatus !== "ativo") {
    candidates.push({
      tier: 8,
      issue: {
        title: card.activityStatus === "inativo" ? "Sem atividade recente" : "Atenção por inatividade",
        description: card.activityLabel,
        actionLabel: "Abrir cliente",
        actionHref: clientHref,
      },
      ageBusinessDays: null,
    });
  }

  if (candidates.length === 0 && card.alerts.length > 0) {
    candidates.push({
      tier: 9,
      issue: {
        title: card.alerts[0].message,
        description: "",
        actionLabel: "Abrir cliente",
        actionHref: clientHref,
      },
      ageBusinessDays: null,
    });
  }

  candidates.sort((a, b) => a.tier - b.tier);
  const primary = candidates[0] ?? null;

  return {
    clientId: card.clientId,
    clientName: card.clientName,
    severity: card.accountHealth,
    priorityScore: primary ? (primary.tier === 1 || primary.tier === 2 ? 1000 - primary.tier : 100 - primary.tier) : 0,
    primaryIssue: primary?.issue ?? null,
    issueAgeBusinessDays: primary?.ageBusinessDays ?? null,
    secondaryCount: Math.max(candidates.length - 1, 0),
    secondaryIssues: candidates.slice(1).map((c) => ({ title: c.issue.title, description: c.issue.description })),
  };
}

const SEVERITY_RANK: Record<AccountHealth, number> = { critico: 0, atencao: 1, saudavel: 2 };

/**
 * Ordenação da fila (seção 12): severidade primeiro, depois a posição na
 * hierarquia de problemas (menor tier = mais urgente), depois há quanto
 * tempo o problema está aberto (mais antigo primeiro; sem idade conhecida
 * fica depois de quem tem), depois nome — sempre determinístico.
 */
export function sortClientPriorities(priorities: ClientPriority[]): ClientPriority[] {
  return [...priorities].sort((a, b) => {
    const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severityDiff !== 0) return severityDiff;

    const scoreDiff = b.priorityScore - a.priorityScore;
    if (scoreDiff !== 0) return scoreDiff;

    const ageA = a.issueAgeBusinessDays ?? -1;
    const ageB = b.issueAgeBusinessDays ?? -1;
    if (ageA !== ageB) return ageB - ageA;

    return a.clientName.localeCompare(b.clientName);
  });
}

/** Só os clientes que realmente precisam de alguma ação — "saudável" nunca
 * entra na fila (não há problema principal pra mostrar). */
export function buildClientPriorityQueue(cards: OperationClientCard[], today: Date): ClientPriority[] {
  const withIssues = cards.map((card) => getClientPriority(card, today)).filter((p) => p.primaryIssue !== null);
  return sortClientPriorities(withIssues);
}
