import type { AlertSeverity, AlertStatus } from "@/lib/alerts/alert-types";

/**
 * Melhoria da tela "Alertas" (pedido do usuário, seção 3 — "ajude o
 * gestor a priorizar"): núcleo puro de ordenação/contagem, extraído de
 * `alerts-data.ts` (que depende do Supabase) pra ser testável sem rede.
 */
const SEVERITY_ORDER: Record<AlertSeverity, number> = { critico: 0, atencao: 1, oportunidade: 2 };

export interface SortableAlert {
  severity: AlertSeverity;
  /** Desvio em reais (`observado - referência`), com sinal — `null` pra
   * tipos de alerta futuros sem essa métrica, ou alertas antigos
   * calculados antes dela existir (nunca quebra, só vai pro fim da sua
   * faixa de gravidade). */
  diffReais: number | null;
  lastEvaluatedAt: string;
}

/**
 * Crítico > atenção > oportunidade; dentro da MESMA gravidade, maior
 * desvio ABSOLUTO em reais primeiro (pedido: "priorize o maior desvio
 * absoluto em reais, preservando o sinal na exibição" — o sinal nunca
 * entra na comparação, só aparece depois, no card); data mais recente
 * como desempate final.
 */
export function compareAlertsByPriority<T extends SortableAlert>(a: T, b: T): number {
  if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];

  const aAbs = a.diffReais !== null ? Math.abs(a.diffReais) : -1;
  const bAbs = b.diffReais !== null ? Math.abs(b.diffReais) : -1;
  if (aAbs !== bAbs) return bAbs - aAbs;

  return b.lastEvaluatedAt.localeCompare(a.lastEvaluatedAt);
}

/** Contagem por situação (pedido: "abas com contagem") — sempre as 3,
 * mesmo quando alguma vale 0 (nunca omite uma aba da UI por falta de
 * alerta nela). */
export function countAlertsByStatus(items: { status: AlertStatus }[]): Record<AlertStatus, number> {
  const counts: Record<AlertStatus, number> = { precisa_atencao: 0, acompanhamento: 0, resolvido: 0 };
  for (const item of items) counts[item.status]++;
  return counts;
}
