import { formatCurrency, formatPercent } from "@/lib/format";
import { safeDivide } from "@/lib/performance";
import { PERFORMANCE_GOALS, formatPerformanceResult, type PerformanceGoal } from "@/lib/performance-goals";
import type { AchievementLevel, AchievementMetricSnapshot } from "@/lib/achievement-types";
import type { AchievementRow } from "@/lib/achievements-data";

/**
 * Camada de COMUNICAÇÃO de Conquistas — o texto que o gestor pode copiar e
 * enviar DIRETO pro cliente (pedido "Ajuste no conceito de Conquistas").
 * Nunca decide o QUE é uma conquista (isso continua 100% nas regras de
 * `achievement-client-rules.ts`/`achievement-sub-entity-rules.ts`, intocadas
 * nesta etapa) — só COMO comunicar uma conquista já decidida. Determinístico:
 * o mesmo `AchievementRow` sempre produz a mesma mensagem, sem chamada de
 * LLM/API (pedido, seção 4).
 *
 * Fonte única de verdade: nunca persiste texto redundante (pedido, seção 8)
 * — toda mensagem é reconstruída aqui, em leitura, a partir de campos que já
 * existem em `AchievementMetricSnapshot`/`AchievementRow` (`type`, `level`,
 * `entityName`, `metric`, `performanceGoal`). Nenhum campo novo em
 * `operational_events.metadata`.
 *
 * Fallback seguro pra histórico (pedido, seção 9): cada template checa os
 * campos numéricos de que precisa e devolve `null` quando algo essencial
 * falta — nunca inventa um número, nunca lança exceção. `null` significa "sem
 * mensagem pronta pra este evento": a interface simplesmente não mostra o
 * botão de copiar e cai no texto técnico (`headline`/`detail`) já existente,
 * nunca quebra a renderização. Nenhuma regra aqui reaproveita `headline`/
 * `detail` como fonte de texto — eventos anteriores a esta etapa podiam ter
 * o nome do cliente embutido no `headline` (convenção antiga, já removida do
 * motor), e reutilizar esse texto arriscaria vazar o nome do cliente pra
 * dentro da mensagem copiável. Só escopo `client` tem mensagem — Agência/
 * Pessoa não são "enviadas para o cliente" (natureza interna).
 */

interface GoalWording {
  /** "CPA" | "CPL" | "Custo por novo seguidor" | fallback neutro quando o
   * cliente não tem objetivo configurado — nunca inventa CPA/CPL sem saber o
   * objetivo real (pedido, seção 5: "não escreva CPL numa conta de vendas"). */
  costShortLabel: string;
  /** "venda" | "lead" | "novo seguidor" | "resultado" (minúsculo, pra frases
   * como "por venda"/"por lead"). */
  singularResultLower: string;
  formatResult(count: number): string;
}

function resolveGoalWording(goal: PerformanceGoal | null): GoalWording {
  if (!goal) {
    return {
      costShortLabel: "Custo por resultado",
      singularResultLower: "resultado",
      formatResult: (count) => `${count} resultado${count === 1 ? "" : "s"}`,
    };
  }
  const config = PERFORMANCE_GOALS[goal];
  return {
    costShortLabel: config.costMetricShortLabel,
    singularResultLower: config.singularLabel.toLowerCase(),
    formatResult: (count) => formatPerformanceResult(count, goal),
  };
}

const LEVEL_NOUN: Record<Exclude<AchievementLevel, "account">, { article: string; noun: string; pluralArticle: string; pluralNoun: string; fem: boolean }> = {
  campaign: { article: "A", noun: "campanha", pluralArticle: "as", pluralNoun: "campanhas", fem: true },
  ad_set: { article: "O", noun: "público", pluralArticle: "os", pluralNoun: "públicos", fem: false },
  creative: { article: "O", noun: "criativo", pluralArticle: "os", pluralNoun: "criativos", fem: false },
};

/** "Destaque" (campanha/público/criativo) — a entidade com vantagem material
 * de CPA/CPL sobre o agregado das demais (`achievement-sub-entity.ts`,
 * intocado nesta etapa). `advantagePct` é reconstruído aqui a partir de
 * `metric.actual`/`metric.comparisonActual` — a MESMA fórmula que
 * `findSubEntityDestaque` já usou pra decidir a conquista, nunca um segundo
 * cálculo divergente. */
function destaqueMessage(level: Exclude<AchievementLevel, "account">, entityName: string, metric: AchievementMetricSnapshot, wording: GoalWording): string | null {
  if (metric.comparisonActual === undefined || metric.comparisonActual === 0) return null;
  if (metric.sampleResultCount === undefined) return null;

  const info = LEVEL_NOUN[level];
  const advantagePct = (metric.comparisonActual - metric.actual) / metric.comparisonActual;
  const opening =
    level === "creative"
      ? "Temos um novo destaque entre os criativos! 🚀"
      : level === "ad_set"
        ? "Um dos públicos se destacou nos últimos dias."
        : "Uma das campanhas se destacou nos últimos dias! 🚀";

  const body = `${info.article} ${info.noun} "${entityName}" gerou ${wording.formatResult(metric.sampleResultCount)} com ${wording.costShortLabel} de ${formatCurrency(metric.actual)}, ${formatPercent(advantagePct * 100)} mais eficiente que ${info.pluralArticle} demais ${info.pluralNoun} analisad${info.fem ? "as" : "os"}.`;

  return `${opening}\n\n${body}`;
}

/** "Evolução" de campanha/público/criativo — mesma fórmula de
 * `evaluateSubEntityEvolution` (`achievement-sub-entity.ts`), reconstruída a
 * partir de `metric.actual`/`metric.comparisonActual`. */
function subEntityEvolutionMessage(level: Exclude<AchievementLevel, "account">, entityName: string, metric: AchievementMetricSnapshot, wording: GoalWording): string | null {
  if (metric.comparisonActual === undefined || metric.comparisonActual === 0) return null;

  const info = LEVEL_NOUN[level];
  const improvementPct = (metric.comparisonActual - metric.actual) / metric.comparisonActual;
  const opening =
    level === "campaign"
      ? "Boa evolução em uma das campanhas! 📈"
      : level === "ad_set"
        ? "Boa evolução em um dos públicos! 📈"
        : "Boa evolução em um dos criativos! 📈";

  const body = `${info.article} ${info.noun} "${entityName}" reduziu o ${wording.costShortLabel} em ${formatPercent(improvementPct * 100)}, saindo de ${formatCurrency(metric.comparisonActual)} para ${formatCurrency(metric.actual)} nos últimos 7 dias.`;

  return `${opening}\n\n${body}`;
}

type AccountTemplate = (metric: AchievementMetricSnapshot, wording: GoalWording) => string | null;

/** Um template por `type` de conquista de CONTA (11 regras de
 * `achievement-client-rules.ts`, intocadas nesta etapa) — cada um só usa
 * campos que a regra correspondente já preenche sempre; quando um campo
 * opcional falta (evento antigo), degrada pra uma frase mais simples em vez
 * de inventar o número ausente. */
const ACCOUNT_TEMPLATES: Record<string, AccountTemplate> = {
  client_consistency_cpa_below_target: (m, wording) => {
    if (m.streakDays === undefined) return null;
    const opening = "Ótimo resultado nos últimos dias! 🚀";
    const base = `Completamos ${m.streakDays} dias consecutivos com o ${wording.costShortLabel} abaixo da meta.`;
    if (m.target === undefined || m.target === null) return `${opening}\n\n${base}`;
    return `${opening}\n\n${base} No período, ficamos em ${formatCurrency(m.actual)} por ${wording.singularResultLower}, contra uma meta de ${formatCurrency(m.target)}.`;
  },

  client_evolution_cpa_improved: (m, wording) => {
    if (m.comparisonActual === undefined || m.comparisonActual === 0) return null;
    const pct = (m.comparisonActual - m.actual) / m.comparisonActual;
    return `Boa evolução de performance nos últimos 7 dias! 📈\n\nO ${wording.costShortLabel} caiu ${formatPercent(pct * 100)}, saindo de ${formatCurrency(m.comparisonActual)} para ${formatCurrency(m.actual)} no período atual.`;
  },

  client_evolution_roas_growth: (m) => {
    if (m.comparisonActual === undefined || m.comparisonActual === 0) return null;
    const pct = (m.actual - m.comparisonActual) / m.comparisonActual;
    return `Boa evolução de performance nos últimos 7 dias! 📈\n\nO ROAS cresceu ${formatPercent(pct * 100)}, saindo de ${m.comparisonActual.toFixed(2)}x para ${m.actual.toFixed(2)}x no período atual.`;
  },

  client_scale_investment_growth_with_efficiency: (m, wording) => {
    if (m.comparisonActual === undefined || m.comparisonActual === 0) return null;
    const opening = "Conseguimos aumentar o investimento mantendo uma boa eficiência. 🚀";
    const growthPct = (m.actual - m.comparisonActual) / m.comparisonActual;
    const growthSentence = `O investimento cresceu ${formatPercent(growthPct * 100)}`;
    const derivedCpa = m.sampleResultCount !== undefined ? safeDivide(m.actual, m.sampleResultCount) : null;
    if (derivedCpa === null || m.target === undefined || m.target === null) {
      return `${opening}\n\n${growthSentence} mantendo a eficiência dentro da meta.`;
    }
    return `${opening}\n\n${growthSentence} e o ${wording.costShortLabel} permaneceu dentro da meta, em ${formatCurrency(derivedCpa)} frente à meta de ${formatCurrency(m.target)}.`;
  },

  client_recovery_cpa_back_within_target: (m, wording) => {
    const opening = "Voltamos a performar dentro da meta! 🚀";
    if (m.target === undefined || m.target === null) {
      return `${opening}\n\nO ${wording.costShortLabel} voltou a ficar dentro da meta após um período fora dela.`;
    }
    return `${opening}\n\nO ${wording.costShortLabel} voltou a ${formatCurrency(m.actual)}, abaixo da meta de ${formatCurrency(m.target)}, após um período fora da meta.`;
  },

  client_goal_monthly_result_reached: (m, wording) => {
    if (m.target === undefined || m.target === null || m.target <= 0) return null;
    const ratio = m.actual / m.target;
    const opening = ratio > 1 ? "Superamos a meta do mês! 🚀" : "Batemos a meta do mês! 🚀";
    const body =
      ratio > 1
        ? `${wording.formatResult(m.actual)} no mês, ${formatPercent((ratio - 1) * 100)} acima da meta de ${m.target}.`
        : `${wording.formatResult(m.actual)} no mês, atingindo a meta de ${m.target}.`;
    return `${opening}\n\n${body}`;
  },

  client_record_best_cpa_week: (m, wording) => {
    if (m.comparisonActual === undefined) return null;
    return `Novo recorde por aqui! 🚀\n\nTivemos a melhor semana de ${wording.costShortLabel} da nossa história: ${formatCurrency(m.actual)} na semana, superando a marca anterior de ${formatCurrency(m.comparisonActual)}.`;
  },

  client_record_best_roas_week: (m) => {
    if (m.comparisonActual === undefined) return null;
    return `Novo recorde por aqui! 🚀\n\nTivemos a melhor semana de ROAS da nossa história: ${m.actual.toFixed(2)}x, superando a marca anterior de ${m.comparisonActual.toFixed(2)}x.`;
  },

  client_record_best_results_week: (m, wording) => {
    if (m.comparisonActual === undefined) return null;
    return `Novo recorde por aqui! 🚀\n\nTivemos a melhor semana de resultados da nossa história: ${wording.formatResult(m.actual)} na semana, superando a marca anterior de ${wording.formatResult(m.comparisonActual)}.`;
  },

  client_record_best_month_closed: (m, wording) => {
    if (m.comparisonActual === undefined) return null;
    return `Fechamos o melhor mês da nossa história! 🚀\n\nForam ${wording.formatResult(m.actual)} no mês, superando o recorde anterior de ${wording.formatResult(m.comparisonActual)}.`;
  },

  client_record_current_month_pace_beats_history: (m, wording) => {
    if (m.comparisonActual === undefined) return null;
    return `Estamos no caminho para o melhor mês da nossa história! 🚀\n\nJá são ${wording.formatResult(m.actual)} neste mês, superando o melhor mês fechado até aqui (${wording.formatResult(m.comparisonActual)}).`;
  },
};

/** Mensagem pronta pra copiar e enviar direto ao cliente — `null` quando o
 * evento não é de escopo `client`, ou quando os dados disponíveis não
 * sustentam uma mensagem segura (fallback: a interface cai pro texto técnico
 * já existente, nunca quebra). Nunca contém o nome do cliente (ele já é
 * contexto separado da interface, nunca parte da frase). */
export function buildClientMessage(row: AchievementRow): string | null {
  if (row.scope !== "client") return null;
  if (!row.metric) return null;

  const wording = resolveGoalWording(row.clientPerformanceGoal);

  if (row.level !== "account") {
    if (!row.entityName) return null;
    if (row.family === "destaque") return destaqueMessage(row.level, row.entityName, row.metric, wording);
    if (row.family === "evolucao") return subEntityEvolutionMessage(row.level, row.entityName, row.metric, wording);
    return null;
  }

  const template = ACCOUNT_TEMPLATES[row.type];
  return template ? template(row.metric, wording) : null;
}
