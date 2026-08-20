import type { ClientOperationalState } from "@/lib/client-operational-state";
import type { AccountHealthEvaluation } from "@/lib/account-health-engine";

/**
 * Suporte da tela Operação (fila de triagem, ordenação/contagem/navegação
 * de mês) — conceito NOVO, não uma evolução da Sprint. Nenhuma função aqui
 * importa de `lib/sprint-financials.ts`, `app/sprints/` ou
 * `app/operation/operation-data.ts` (o motor/a interface da Sprint), pra a
 * Operação poder evoluir sem carregar a Sprint junto. Independência da
 * Operação não significa ignorar onde o dado oficial mora, porém: o
 * investimento efetivo (`operation-triage-data.ts`) é resolvido chamando
 * `sumEffectiveSpendForMonth` (`lib/effective-spend.ts`, módulo de domínio
 * NEUTRO — nem da Sprint, nem da Operação) sobre uma query própria de
 * `sprints`, exatamente como a página do Cliente faz — nenhuma fórmula
 * duplicada em lugar nenhum, uma única implementação pras duas telas.
 *
 * A Operação não é um dashboard — é uma FILA DE TRABALHO. Um dashboard
 * tenta mostrar tudo; uma fila inteligente mostra primeiro o que exige
 * ação e só depois contexto. Ordenação e tipo do card foram promovidos
 * (Etapa "Consolidação da Arquitetura — Fase A") pra `lib/client-operational-state.ts`
 * — domínio neutro, não mais exclusivo da Operação, pronto pra a Visão
 * Geral/Relatórios migrarem numa PR futura. Este arquivo continua com o que
 * é genuinamente específico da Operação: os contadores do cabeçalho e a
 * navegação de mês.
 */

export interface OperationTriageSummary {
  totalClients: number;
  /** Contagem por balde de gravidade — SEMPRE derivada de
   * `resolveOperationPriorityGroup` (abaixo), a mesma fonte que decide o
   * agrupamento da fila. Nunca um score novo: é só a contagem do que o
   * motor de saúde já classificou. */
  critico: number;
  atencao: number;
  saudavel: number;
  semDados: number;
}

/**
 * Contadores operacionais do cabeçalho da Operação (Etapa "Unificação da
 * Leitura da Operação") — o topo passa a falar a mesma língua do corpo da
 * tela: gravidade, não eixo de diagnóstico. Substitui os antigos contadores
 * por dimensão (Planejamento/CPA/Investimento/Pendências, Motor de
 * Diagnóstico Único) pelos MESMOS 4 baldes que `groupClientsByOperationPriority`
 * já usa pra ordenar a fila — nenhuma severidade nova, nenhum score
 * paralelo: `resolveOperationPriorityGroup` é chamado aqui exatamente como
 * é chamado lá embaixo pra cada card.
 */
export function summarizeOperationTriage(cards: ClientOperationalState[]): OperationTriageSummary {
  let critico = 0;
  let atencao = 0;
  let saudavel = 0;
  let semDados = 0;
  for (const card of cards) {
    switch (resolveOperationPriorityGroup(card.evaluation)) {
      case "critico":
        critico++;
        break;
      case "atencao":
        atencao++;
        break;
      case "saudavel":
        saudavel++;
        break;
      case "sem_dados":
        semDados++;
        break;
    }
  }
  return { totalClients: cards.length, critico, atencao, saudavel, semDados };
}

/** Desloca um parâmetro de mês (`YYYY-MM-01`) em N meses — helper local e
 * mínimo (não importa de `lib/sprint-financials.ts`, que é código da
 * Sprint) só pra navegação do seletor de período desta tela. */
export function shiftOperationMonth(monthParam: string, deltaMonths: number): string {
  const [year, month] = monthParam.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** `{firstDay, lastDay}` do mês do parâmetro da Operação — helper local e
 * mínimo (mesma razão de `shiftOperationMonth`: nunca importar de
 * `lib/sprint-financials.ts`) só pra alimentar `computeMonthlyExpectedPct`/
 * `resolveMonthlyPlanSnapshot` com o intervalo real do mês (nunca o
 * "-31" fixo usado pelos filtros de `daily_spend`/`performance_records`,
 * que só precisam de um limite superior generoso, não do último dia real). */
export function monthRangeFromOperationParam(monthParam: string): { firstDay: string; lastDay: string } {
  const [year, month] = monthParam.split("-").map(Number);
  const lastDay = daysInMonth(year, month);
  return { firstDay: monthParam, lastDay: `${monthParam.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * Agrupamento de prioridade visual da fila da Operação (Etapa "Central de
 * Decisão Diária") — deriva 100% de `evaluation.healthStatus`/
 * `evaluation.primaryDimension`, já calculados pelo Motor de Saúde da Conta
 * (`lib/account-health-engine.ts`, nunca alterado por esta etapa). Nenhuma
 * severidade nova: só reagrupa o que o motor já decidiu, em 4 baldes pra
 * leitura rápida ("qual conta ignoro, qual eu olho primeiro").
 *
 * O balde `sem_dados` é a única reinterpretação deliberada: no motor, uma
 * conta sem configuração mínima (`primaryDimension === "dataQuality"`) é
 * SEMPRE a mais grave — "sem dado confiável não existe operação" (ver
 * `DIMENSION_PRIORITY_ORDER`, account-health-engine.ts) — e por isso
 * `evaluation.healthStatus` vem `"acao_necessaria"` pra ela, igual a uma
 * conta com performance realmente ruim. Isso é correto pra decidir o
 * `primaryReason`/desempate do motor, mas ENGANOSO nesta tela: uma conta
 * sem dado não "performou mal", só não pôde ser avaliada — misturá-la com
 * quem tem um problema real de performance faria o gestor tratar as duas
 * coisas como o mesmo tipo de urgência. Por isso ela sai do topo aqui e
 * vira o último grupo, nunca competindo visualmente com Crítico/Atenção —
 * mesma distinção pedida explicitamente pro conteúdo do card. Dentro de
 * cada balde, a ordem relativa que `sortClientOperationalStates` já decidiu
 * é preservada (partição estável, nenhum critério de desempate novo).
 */
export type OperationPriorityGroup = "critico" | "atencao" | "saudavel" | "sem_dados";

const OPERATION_PRIORITY_GROUP_RANK: Record<OperationPriorityGroup, number> = {
  critico: 0,
  atencao: 1,
  saudavel: 2,
  sem_dados: 3,
};

export function resolveOperationPriorityGroup(evaluation: AccountHealthEvaluation): OperationPriorityGroup {
  if (evaluation.primaryDimension === "dataQuality") return "sem_dados";
  if (evaluation.healthStatus === "acao_necessaria") return "critico";
  if (evaluation.healthStatus === "em_risco" || evaluation.healthStatus === "em_acompanhamento") return "atencao";
  return "saudavel";
}

/** Reordena a fila (já ordenada por `sortClientOperationalStates`) só pelos
 * 4 baldes acima — `Array.prototype.sort` é estável (ES2019+, mesma garantia
 * já usada por `collectAccountHealthReasons`), então a ordem dentro de cada
 * balde continua exatamente a que o motor decidiu. */
export function groupClientsByOperationPriority(cards: ClientOperationalState[]): ClientOperationalState[] {
  return [...cards].sort(
    (a, b) => OPERATION_PRIORITY_GROUP_RANK[resolveOperationPriorityGroup(a.evaluation)] - OPERATION_PRIORITY_GROUP_RANK[resolveOperationPriorityGroup(b.evaluation)],
  );
}

/** Filtro rápido do topo da Operação (Etapa "Unificação da Leitura da
 * Operação") — `"todos"` ou um dos 4 baldes de `OperationPriorityGroup`.
 * Deliberadamente o MESMO tipo (mais `"todos"`), nunca um enum paralelo de
 * "tipo de problema" — o topo da tela só sabe falar de gravidade, a mesma
 * língua do corpo. */
export type OperationQuickFilter = "todos" | OperationPriorityGroup;

export interface OperationTriageFilters {
  severity: OperationQuickFilter;
  /** `"todos"` ou o id de um gestor — mesmo valor de sempre (ver
   * `operation-triage-view.tsx`). */
  managerId: string;
  query: string;
}

/**
 * Núcleo puro de filtragem da fila da Operação — gravidade (via
 * `resolveOperationPriorityGroup`, nunca uma segunda regra) + gestor +
 * busca por nome de cliente/gestor. Extraído do componente (Etapa
 * "Unificação da Leitura da Operação") pra ser testável sem React — os três
 * critérios são independentes e compõem por E lógico, na mesma ordem que já
 * valia antes desta etapa.
 */
export function filterOperationTriageClients(
  cards: ClientOperationalState[],
  filters: OperationTriageFilters,
): ClientOperationalState[] {
  const normalizedQuery = filters.query.trim().toLowerCase();
  return cards.filter((card) => {
    if (filters.severity !== "todos" && resolveOperationPriorityGroup(card.evaluation) !== filters.severity) return false;
    if (filters.managerId !== "todos" && card.managerId !== filters.managerId) return false;
    if (normalizedQuery) {
      const matchesName = card.clientName.toLowerCase().includes(normalizedQuery);
      const matchesManager = (card.managerName ?? "").toLowerCase().includes(normalizedQuery);
      if (!matchesName && !matchesManager) return false;
    }
    return true;
  });
}

