import type { ClientOperationalState } from "@/lib/client-operational-state";
import { describeCostReason, type AccountHealthEvaluation } from "@/lib/account-health-engine";

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
 * Leitura da Operação", atualizada pela Etapa "Operação — CPA como régua
 * única") — o topo fala a mesma língua do corpo da tela: gravidade, não
 * eixo de diagnóstico. Contagens vêm de `resolveOperationCpaPriorityGroup`
 * — a mesma fonte que `groupClientsByOperationPriority`/
 * `filterOperationTriageClients` usam, nunca um score paralelo.
 */
export function summarizeOperationTriage(cards: ClientOperationalState[]): OperationTriageSummary {
  let critico = 0;
  let atencao = 0;
  let saudavel = 0;
  let semDados = 0;
  for (const card of cards) {
    switch (resolveOperationCpaPriorityGroup(card.evaluation)) {
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

/**
 * Etapa "Operação — CPA como régua única": a Operação responde UMA
 * pergunta ("como está minha carteira olhando pra custo por resultado?"),
 * não mais a pior de 5 dimensões. Esta função é a ÚNICA mudança de
 * comportamento desta etapa — `resolveOperationPriorityGroup` (acima)
 * continua 100% intacta e continua sendo o que o Dashboard (`app/page.tsx`)
 * e a Visão Geral do cliente (`clients/[id]/page.tsx`) consomem; nenhuma das
 * duas telas muda por causa desta etapa. `account-health-engine.ts` também
 * não muda uma linha — esta função só RECOMBINA o que ele já calculou.
 *
 * Regra (aprovada explicitamente):
 * 1. `dataQuality` com qualquer lacuna → "sem_dados" (idêntico à função
 *    acima — "sem dado confiável não existe operação" continua valendo).
 * 2. Custo sem amostra confiável (`hasReliableSample`) ou sem escopo
 *    comparável (`hasComparableScope`) → também "sem_dados" — são
 *    exatamente os casos que você pediu pra preservar ("campanha ainda sem
 *    gasto suficiente", "CPA ainda não calculável"): o motor já tinha essa
 *    trava pronta (`evaluateCost`), só nunca tinha sido promovida a um
 *    estado visível fora de "nenhum sinal".
 * 3. Senão, a severidade de `cost` sozinha decide o balde — nenhum novo
 *    limiar, a MESMA tabela severidade→balde que a Operação já usava (leve/
 *    relevante → atenção, grave → crítico, nenhum → saudável).
 *
 * Investimento, Resultado e Revisão NUNCA entram aqui — deliberado.
 */
export function resolveOperationCpaPriorityGroup(evaluation: AccountHealthEvaluation): OperationPriorityGroup {
  if (evaluation.dimensions.dataQuality.status !== "nenhum") return "sem_dados";

  const cost = evaluation.dimensions.cost;
  if (!cost.hasReliableSample || !cost.hasComparableScope) return "sem_dados";

  switch (cost.status) {
    case "grave":
      return "critico";
    case "relevante":
    case "leve":
      return "atencao";
    case "nenhum":
      return "saudavel";
  }
}

/**
 * Motivo principal da Operação (Etapa "Operação — CPA como régua única") —
 * sempre explica o CPA ou a impossibilidade de avaliá-lo, nunca
 * investimento/resultado/revisão. Quando `dataQuality` tem alguma lacuna,
 * reaproveita `evaluation.primaryReason`: como `dataQuality` é sempre a
 * primeira da ordem de desempate do motor (`DIMENSION_PRIORITY_ORDER`) e sua
 * severidade só existe como "grave" (binária), toda vez que ela dispara ela
 * já é, por construção, a dimensão vencedora de `evaluateAccountHealth` —
 * `primaryReason` já É o texto de qualidade de dado, nunca precisa ser
 * recalculado aqui. Fora isso, é sempre `describeCostReason` (mesma função
 * do motor, nunca uma frase nova) — cobre tanto os motivos de "ainda não dá
 * pra avaliar" (amostra/escopo) quanto o desvio real, e devolve `null`
 * quando a conta está genuinamente saudável (mesmo comportamento de sempre:
 * sem texto, sem linha de motivo).
 */
export function describeOperationCpaReason(evaluation: AccountHealthEvaluation): string | null {
  if (evaluation.dimensions.dataQuality.status !== "nenhum") return evaluation.primaryReason;
  return describeCostReason(evaluation.dimensions.cost);
}

/** Reordena a fila (já ordenada por `sortClientOperationalStates`) só pelos
 * 4 baldes acima — `Array.prototype.sort` é estável (ES2019+, mesma garantia
 * já usada por `collectAccountHealthReasons`), então a ordem dentro de cada
 * balde continua exatamente a que o motor decidiu. */
export function groupClientsByOperationPriority(cards: ClientOperationalState[]): ClientOperationalState[] {
  return [...cards].sort(
    (a, b) =>
      OPERATION_PRIORITY_GROUP_RANK[resolveOperationCpaPriorityGroup(a.evaluation)] -
      OPERATION_PRIORITY_GROUP_RANK[resolveOperationCpaPriorityGroup(b.evaluation)],
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
    if (filters.severity !== "todos" && resolveOperationCpaPriorityGroup(card.evaluation) !== filters.severity) return false;
    if (filters.managerId !== "todos" && card.managerId !== filters.managerId) return false;
    if (normalizedQuery) {
      const matchesName = card.clientName.toLowerCase().includes(normalizedQuery);
      const matchesManager = (card.managerName ?? "").toLowerCase().includes(normalizedQuery);
      if (!matchesName && !matchesManager) return false;
    }
    return true;
  });
}

