/**
 * Camada de PERFORMANCE (Etapa 71) — nova funcionalidade, dimensão
 * complementar (nunca substituta) do acompanhamento FINANCEIRO já existente
 * (orçamento, realizado, recomendação de sprint). Este arquivo é a
 * configuração central do objetivo de performance de um cliente — nunca
 * espalhar `if (performanceGoal === "leads")` pelos componentes; qualquer
 * tela que precise de rótulo/formatação por objetivo lê daqui.
 *
 * `PerformanceGoal` é DELIBERADAMENTE distinto de `ClientMainObjective`
 * (`main_objective`, já existente em `clients` — "leads"|"vendas"|"reservas"|
 * "reconhecimento"|"trafego"|"outro", um campo descritivo/textual de
 * contexto estratégico, sem estrutura de meta ou cálculo). `performance_goal`
 * é estruturado, alimenta cálculo de custo por resultado — conceito
 * diferente, nunca unificado com `main_objective`.
 *
 * Terceiro valor ("followers", Etapa "Objetivo Seguidores"): contas cujo KPI
 * principal é crescimento de audiência. Deliberadamente NÃO introduz um
 * conceito novo na interface (nunca "Growth"/"Branding"/"Awareness") — é só
 * mais um objetivo estruturado, com a mesma forma dos outros dois
 * (`resultMetricLabel`/`costMetricLabel`/`costMetricShortLabel`), consumido
 * pelas MESMAS funções genéricas já existentes (`formatPerformanceResult`,
 * `deriveMonthlyKpiTexts`, `computePerformanceSummary` etc.) — nenhuma delas
 * faz `if (goal === "leads")`, todas leem de `PERFORMANCE_GOALS[goal]`, por
 * isso um objetivo novo é uma entrada de configuração, nunca uma ramificação
 * de código nova.
 */
export type PerformanceGoal = "leads" | "sales" | "followers";

export interface PerformanceGoalConfig {
  id: PerformanceGoal;
  /** Rótulo curto pra selects/badges (ex.: "Leads"). */
  label: string;
  singularLabel: string;
  pluralLabel: string;
  /** Rótulo da métrica de resultado (ex.: "Leads" no resumo de performance). */
  resultMetricLabel: string;
  /** Rótulo completo da métrica de custo (ex.: "Custo por lead"). Etapa 71,
   * seção 3: nomenclatura única — nunca alternar "Custo por aquisição"/
   * "Custo por venda" em telas diferentes; sempre "Custo por venda" por
   * extenso. */
  costMetricLabel: string;
  /** Abreviação curta da métrica de custo (ex.: "CPL"/"CPA") — usada em
   * espaços compactos (card fechado da sprint, tabela da Visão Geral). */
  costMetricShortLabel: string;
}

export const PERFORMANCE_GOALS: Record<PerformanceGoal, PerformanceGoalConfig> = {
  leads: {
    id: "leads",
    label: "Leads",
    singularLabel: "Lead",
    pluralLabel: "Leads",
    resultMetricLabel: "Leads",
    costMetricLabel: "Custo por lead",
    costMetricShortLabel: "CPL",
  },
  sales: {
    id: "sales",
    label: "Vendas",
    singularLabel: "Venda",
    pluralLabel: "Vendas",
    resultMetricLabel: "Vendas",
    costMetricLabel: "Custo por venda",
    costMetricShortLabel: "CPA",
  },
  followers: {
    id: "followers",
    label: "Seguidores",
    singularLabel: "Seguidor",
    pluralLabel: "Seguidores",
    resultMetricLabel: "Seguidores",
    costMetricLabel: "Custo por seguidor",
    // Sem abreviação (ao contrário de CPL/CPA): "CPS" não é reconhecido no
    // mercado e "CPF" já significa Cadastro de Pessoa Física — por extenso
    // em qualquer espaço, mesmo os compactos que usam `costMetricShortLabel`.
    costMetricShortLabel: "Custo por seguidor",
  },
};

export const PERFORMANCE_GOAL_OPTIONS: { value: PerformanceGoal; label: string }[] = [
  { value: "leads", label: "Geração de leads" },
  { value: "sales", label: "Vendas" },
  { value: "followers", label: "Seguidores" },
];

/** `null`/`undefined` = cliente sem objetivo configurado ainda (nunca
 * inventamos "leads" como padrão pra cliente existente — Etapa 71, seção 2). */
export function getPerformanceGoalConfig(goal: PerformanceGoal | null | undefined): PerformanceGoalConfig | null {
  return goal ? PERFORMANCE_GOALS[goal] : null;
}

/** "X lead"/"X leads" (singular/plural correto) — nunca hardcoded numa tela
 * só; qualquer lugar que precise formatar uma contagem de resultado usa
 * esta função. */
export function formatPerformanceResult(count: number, goal: PerformanceGoal): string {
  const config = PERFORMANCE_GOALS[goal];
  const label = count === 1 ? config.singularLabel : config.pluralLabel;
  return `${count} ${label.toLowerCase()}`;
}
