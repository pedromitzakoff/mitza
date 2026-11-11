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
 *
 * Quarto e quinto valores ("conversations"/"registrations", Etapa
 * "Configuração inteligente de métricas por cliente"): ao contrário de
 * "followers", estes DOIS são eventos atribuíveis a uma campanha/anúncio
 * específico na Meta (mensagem iniciada, cadastro) — por isso entram em
 * `GRANULAR_RESULT_GOAL_PRIORITY` (`meta-api-ingest-run.ts`), diferente de
 * "followers", que nunca entrou (não é um resultado por campanha). Mesma
 * disciplina: só configuração nova aqui, nenhuma ramificação de código.
 */
export type PerformanceGoal = "leads" | "sales" | "followers" | "conversations" | "registrations";

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
    // Etapa Integração Instagram: renomeado de "Seguidores"/"Custo por
    // seguidor" pra deixar explícito que a métrica é sempre o LÍQUIDO
    // ganho no período (nunca o total acumulado — "seguidores totais" não
    // é uma métrica de análise nesta plataforma, decisão explícita do
    // usuário). `resultCount` já era somado por período desde sempre (nunca
    // fazia sentido como total acumulado, já que soma não é a operação
    // certa pra um snapshot) — o rótulo só passou a refletir isso.
    singularLabel: "Novo seguidor",
    pluralLabel: "Novos seguidores",
    resultMetricLabel: "Novos seguidores",
    costMetricLabel: "Custo por novo seguidor",
    // Sem abreviação (ao contrário de CPL/CPA): "CPS" não é reconhecido no
    // mercado e "CPF" já significa Cadastro de Pessoa Física — por extenso
    // em qualquer espaço, mesmo os compactos que usam `costMetricShortLabel`.
    costMetricShortLabel: "Custo por novo seguidor",
  },
  conversations: {
    id: "conversations",
    label: "Conversas",
    singularLabel: "Conversa",
    pluralLabel: "Conversas",
    resultMetricLabel: "Conversas",
    costMetricLabel: "Custo por conversa",
    costMetricShortLabel: "Custo por conversa",
  },
  registrations: {
    id: "registrations",
    label: "Cadastros",
    singularLabel: "Cadastro",
    pluralLabel: "Cadastros",
    resultMetricLabel: "Cadastros",
    costMetricLabel: "Custo por cadastro",
    costMetricShortLabel: "Custo por cadastro",
  },
};

export const PERFORMANCE_GOAL_OPTIONS: { value: PerformanceGoal; label: string }[] = [
  { value: "leads", label: "Geração de leads" },
  { value: "sales", label: "Vendas" },
  { value: "conversations", label: "Conversas" },
  { value: "registrations", label: "Cadastros" },
  { value: "followers", label: "Seguidores" },
];

/**
 * Etapa "Configuração inteligente de métricas por cliente": `conversations`/
 * `registrations` já existiam no código antes da migração
 * (`supabase/performance-goal-conversations-registrations.sql`) rodar em
 * produção — `AVAILABLE_PERFORMANCE_GOAL_OPTIONS` é o que toda UI de
 * SELEÇÃO usa (nunca `PERFORMANCE_GOAL_OPTIONS` direto), pra nenhuma tela
 * deixar selecionar um valor que a CHECK constraint do banco ainda não
 * aceitava. Migração confirmada executada — lista vazia, os 2 objetivos já
 * liberados em toda a plataforma.
 */
export const PERFORMANCE_GOALS_PENDING_MIGRATION: readonly PerformanceGoal[] = [];

export const AVAILABLE_PERFORMANCE_GOAL_OPTIONS: { value: PerformanceGoal; label: string }[] = PERFORMANCE_GOAL_OPTIONS.filter(
  (option) => !PERFORMANCE_GOALS_PENDING_MIGRATION.includes(option.value),
);

/** Único parser de `PerformanceGoal` a partir de `FormData`/texto solto —
 * nunca duplicar esta lista de valores válidos em cada Server Action
 * (era o caso antes desta etapa: `goal-actions.ts`/`funnel-actions.ts`
 * tinham cada uma sua própria cópia hardcoded). */
export function parsePerformanceGoal(value: FormDataEntryValue | null | undefined): PerformanceGoal | null {
  const raw = String(value ?? "");
  return (PERFORMANCE_GOAL_OPTIONS as { value: string; label: string }[]).some((opt) => opt.value === raw) ? (raw as PerformanceGoal) : null;
}

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
