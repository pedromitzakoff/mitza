import { SPEND_STATUS_REGISTRY } from "@/lib/status-registry";

/** Margem de tolerância pra considerar um gasto "dentro do esperado" — MVP
 * Etapa "Regras centrais de saúde da conta": ±20% (antes ±10%), sobre o
 * `relativeDeviation` abaixo. Única constante de ritmo financeiro do
 * sistema — mudar aqui reclassifica toda tela que consome
 * `classifySpendStatus`/`classifySprintSpendStatus`, nunca uma segunda
 * margem duplicada em algum componente. */
export const SPEND_STATUS_MARGIN = 0.2; // ±20%

/**
 * Desvio relativo do realizado em relação ao esperado —
 * `(actual - expected) / expected`. Positivo = acima do esperado; negativo =
 * abaixo. `null` quando `expected <= 0` (não dá pra calcular uma razão
 * contra uma base zero/negativa — quem chama decide o que isso significa no
 * seu contexto, ver `classifySpendStatus`). Central e reaproveitado por
 * qualquer lugar que precise do NÚMERO do desvio (não só a classificação
 * dentro/acima/abaixo) — ex.: o texto de prioridade "27% abaixo do ritmo".
 */
export function computeRelativeDeviation(actual: number, expected: number): number | null {
  if (expected <= 0) return null;
  return (actual - expected) / expected;
}

/** "nao_iniciado" e "em_andamento" são status TEMPORAIS disfarçados de
 * financeiro — só existem pra sprints (ver `classifySprintSpendStatus` em
 * sprint-financials.ts), nunca produzidos por esta função (`classifySpendStatus`
 * lida só com números, sem saber se o período já começou ou está em
 * andamento). "em_andamento" (Etapa 67): a sprint atual nunca é classificada
 * Acima/Abaixo/Dentro por dias transcorridos DENTRO da própria sprint — essa
 * conta foi removida (era uma fórmula diferente da nova regra de "esperado
 * até hoje" do mês, e produzia números sem sentido operacional pro gestor).
 * A sprint atual só mostra progresso operacional ("Em andamento"), nunca um
 * veredito de ritmo. */
export type SpendStatus = "dentro" | "acima" | "abaixo" | "sem_meta" | "nao_iniciado" | "em_andamento";

/**
 * Compara um valor gasto com um valor esperado e classifica dentro da
 * margem de tolerância acima. Usado tanto no selo de cada sprint (esperado
 * proporcional aos dias já passados) quanto no painel geral do mês
 * (esperado = planejado do mês inteiro).
 *
 * `plannedTotal` é o planejado "cru" (não prorateado) — serve só para
 * detectar meta não configurada. Sem essa distinção, uma sprint com
 * planejado > 0 mas que ainda não começou (esperado prorateado = 0) seria
 * confundida com uma sprint sem planejado nenhum.
 */
export function classifySpendStatus(
  actual: number,
  expected: number,
  plannedTotal: number,
): SpendStatus {
  if (!plannedTotal || plannedTotal <= 0) {
    return "sem_meta";
  }

  const relativeDeviation = computeRelativeDeviation(actual, expected);
  if (relativeDeviation === null) {
    // `expected <= 0` com `plannedTotal > 0` NUNCA significa "período ainda
    // não começou" pra quem já filtra isso antes de chamar esta função
    // (`classifySprintSpendStatus` devolve "nao_iniciado" mais cedo pra
    // sprint futura, sem nunca chegar aqui) — na prática, o único jeito de
    // cair aqui com `actual > 0` é o período JÁ ter começado mas não haver
    // planejamento diário histórico suficiente pros dias já decorridos
    // (ex.: orçamento configurado pela primeira vez no meio do mês — ver
    // supabase/fix-monthly-budget-actual-spend.sql). Achado real desta
    // etapa: essa lacuna estava virando "acima" automaticamente, mesmo sem
    // nenhuma base de comparação — corrigido pra "sem_meta" ("sem uma base
    // de planejamento pra avaliar o ritmo até aqui"), nunca inventando um
    // valor retroativo nem alarmando "acima" sem contexto.
    return "sem_meta";
  }

  if (relativeDeviation > SPEND_STATUS_MARGIN) return "acima";
  if (relativeDeviation < -SPEND_STATUS_MARGIN) return "abaixo";
  return "dentro";
}

/** Rótulo usado quando o status compara com o planejado total (sem
 * prorateio por dia) — painel geral do mês e resumo do mês na página do
 * cliente. Etapa 53: nunca mais "Bateu meta"/"Meta atingida" — o
 * acompanhamento é de RITMO de investimento, não de conquista de meta.
 * Deriva do Status Registry (`@/lib/status-registry`), ver Platform
 * Integrity Wave 1 — `em_andamento` agora é "Sprint em andamento"
 * (qualificado: o mesmo valor de enum também existe, com outro
 * significado, em `MonthlyReportStatus` e `ReportActionItemStatus`). */
export const SPEND_STATUS_LABEL: Record<SpendStatus, string> = {
  dentro: SPEND_STATUS_REGISTRY["spend.dentro"].label,
  acima: SPEND_STATUS_REGISTRY["spend.acima"].label,
  abaixo: SPEND_STATUS_REGISTRY["spend.abaixo"].label,
  sem_meta: SPEND_STATUS_REGISTRY["spend.sem_meta"].label,
  nao_iniciado: SPEND_STATUS_REGISTRY["spend.nao_iniciado"].label,
  em_andamento: SPEND_STATUS_REGISTRY["spend.em_andamento"].label,
};

/** Texto curto e padronizado do status de ritmo — "Dentro/Abaixo/Acima do
 * ritmo esperado", sempre a mesma estrutura, qualquer que seja a métrica
 * (investimento, resultado de performance, etc.). Etapa "Simetria
 * Performance x Investimento": as duas colunas da Visão Geral do cliente
 * usam esta MESMA frase pro status principal — nenhuma fórmula de texto
 * própria por componente. Detalhes específicos (valor em R$, quantidade,
 * dias restantes) vivem numa linha secundária separada, nunca aqui.
 * `sem_meta`/`nao_iniciado`/`em_andamento` ficam de fora do mapa de
 * propósito — sem texto é melhor que um texto inventado sem base real. */
export const RITMO_STATUS_TEXT: Partial<Record<SpendStatus, string>> = {
  acima: "Acima do ritmo esperado",
  dentro: "Dentro do ritmo esperado",
  abaixo: "Abaixo do ritmo esperado",
};

export const SPEND_STATUS_BADGE_CLASSES: Record<SpendStatus, string> = {
  dentro: SPEND_STATUS_REGISTRY["spend.dentro"].badgeClassName,
  acima: SPEND_STATUS_REGISTRY["spend.acima"].badgeClassName,
  abaixo: SPEND_STATUS_REGISTRY["spend.abaixo"].badgeClassName,
  sem_meta: SPEND_STATUS_REGISTRY["spend.sem_meta"].badgeClassName,
  nao_iniciado: SPEND_STATUS_REGISTRY["spend.nao_iniciado"].badgeClassName,
  em_andamento: SPEND_STATUS_REGISTRY["spend.em_andamento"].badgeClassName,
};
