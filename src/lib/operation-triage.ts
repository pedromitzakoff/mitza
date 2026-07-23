import type { HealthStatus } from "@/lib/account-health-engine";
import type { ClientOperationalState } from "@/lib/client-operational-state";
import { getActiveDiagnosticFilters } from "@/lib/metric-diagnostics";

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
 * é genuinamente específico da Operação: a tradução pra "banda" (vocabulário
 * da tela), os contadores do cabeçalho e a navegação de mês.
 */

export type OperationTriageBand = "precisa_atencao" | "em_risco" | "em_acompanhamento" | "saudavel";

const BAND_BY_HEALTH_STATUS: Record<HealthStatus, OperationTriageBand> = {
  acao_necessaria: "precisa_atencao",
  em_risco: "em_risco",
  em_acompanhamento: "em_acompanhamento",
  saudavel: "saudavel",
};

/** `healthStatus` (vocabulário do motor) → banda (vocabulário da tela) —
 * único lugar que faz essa tradução; a chave interna `precisa_atencao`
 * nunca muda mesmo que o rótulo exibido vire "Ação necessária"
 * (`status-registry.ts`), preservando compatibilidade de quem já persiste/
 * lê esse valor (filtro na URL, por exemplo). */
export function bandFromHealthStatus(status: HealthStatus): OperationTriageBand {
  return BAND_BY_HEALTH_STATUS[status];
}

export interface OperationTriageSummary {
  totalClients: number;
  /** Clientes sem as configurações mínimas pro motor conseguir avaliá-los
   * (meta de CPA/CPL e/ou plano mensal de investimento) — problema
   * ESTRUTURAL, diferente dos quatro abaixo (que são operacionais). */
  withPlanejamentoIncompleto: number;
  /** Clientes com CPA fora da meta (Motor de Diagnóstico Único). */
  withCpaOff: number;
  /** Clientes com investimento fora do ritmo esperado (qualquer direção). */
  withInvestmentOff: number;
  /** Clientes com ao menos 1 pendência operacional (tarefa aberta). */
  withPendencias: number;
}

/**
 * Contadores operacionais do cabeçalho da Operação (Etapa "Novo Conceito de
 * Monitoramento Operacional") — substitui os antigos contadores
 * (pendências/revisões/sem sincronização/relatório pendente, que
 * misturavam critérios de naturezas diferentes) pelos diagnósticos
 * objetivos do Motor Único: Planejamento, CPA, Investimento, Pendências.
 * Nunca reimplementa o critério de "fora do esperado"/"incompleto" aqui —
 * sempre via `getActiveDiagnosticFilters` (metric-diagnostics.ts).
 */
export function summarizeOperationTriage(cards: ClientOperationalState[]): OperationTriageSummary {
  let withPlanejamentoIncompleto = 0;
  let withCpaOff = 0;
  let withInvestmentOff = 0;
  let withPendencias = 0;
  for (const card of cards) {
    const active = getActiveDiagnosticFilters(card.diagnostics);
    if (active.includes("planejamento")) withPlanejamentoIncompleto++;
    if (active.includes("cpa")) withCpaOff++;
    if (active.includes("investimento")) withInvestmentOff++;
    if (active.includes("pendencias")) withPendencias++;
  }
  return { totalClients: cards.length, withPlanejamentoIncompleto, withCpaOff, withInvestmentOff, withPendencias };
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

