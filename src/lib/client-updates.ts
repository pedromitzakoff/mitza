import { OPTIMIZATION_ACTION_LABEL, OPTIMIZATION_TYPE_LABEL } from "@/lib/account-reviews";
import type { AccountReviewOutcome, OptimizationType } from "@/lib/supabase/database.types";

/** Taxonomia central de Atualização para o Cliente (Etapa 59). Preparado
 * conceitualmente para `generation_method: "ai"` (seção 2 do pedido) — só
 * "template" é de fato gerado nesta etapa. */
export type ClientUpdateGenerationMethod = "template" | "ai";

/** Estado exibido nos indicadores discretos (seção 14/15 do pedido). "none"
 * nunca aparece como texto — é o estado em que nada é mostrado. */
export type ClientUpdateStatus = "none" | "generated" | "copied" | "sent";

export function computeClientUpdateStatus(
  update: { copiedAt: string | null; sentAt: string | null } | null | undefined,
): ClientUpdateStatus {
  if (!update) return "none";
  if (update.sentAt) return "sent";
  if (update.copiedAt) return "copied";
  return "generated";
}

export const CLIENT_UPDATE_STATUS_LABEL: Record<Exclude<ClientUpdateStatus, "none">, string> = {
  generated: "Atualização gerada",
  copied: "Atualização copiada",
  sent: "Atualização enviada",
};

export interface ClientUpdateOptimizationSource {
  type: OptimizationType;
  action: string;
  description: string | null;
  reason: string | null;
}

export interface ClientUpdateSourceData {
  outcome: AccountReviewOutcome;
  notes: string | null;
  issueDescription: string | null;
  optimizations: ClientUpdateOptimizationSource[];
}

function dedupNonEmpty(values: (string | null)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function actionLine(opt: ClientUpdateOptimizationSource): string {
  if (opt.description && opt.description.trim().length > 0) return opt.description.trim();
  const actionLabel = OPTIMIZATION_ACTION_LABEL[opt.action] ?? opt.action;
  return `${OPTIMIZATION_TYPE_LABEL[opt.type]}: ${actionLabel}`;
}

/**
 * Monta o texto da atualização para o cliente (seções 5-7 do pedido) —
 * exclusivamente com dados reais já registrados na análise, nunca inventa
 * informação nem gera "Próximos passos" (não existe campo estruturado para
 * isso no modelo atual de account_reviews/account_optimizations; a seção
 * some por completo em vez de aparecer vazia ou com texto genérico).
 */
export function buildClientUpdateText(data: ClientUpdateSourceData): string {
  const lines: string[] = ["Olá! Passando para atualizar vocês sobre o acompanhamento da conta.", ""];

  if (data.outcome === "OPTIMIZATION_PERFORMED") {
    lines.push("Hoje analisamos as campanhas e realizamos alguns ajustes.");

    const points = dedupNonEmpty([...data.optimizations.map((o) => o.reason), data.notes]);
    if (points.length > 0) {
      lines.push("", "Principais pontos identificados:");
      for (const point of points) lines.push(`• ${point}`);
    }

    const actions = data.optimizations.map(actionLine);
    lines.push("", "Ações realizadas:");
    for (const action of actions) lines.push(`• ${action}`);

    lines.push("", "Seguimos acompanhando os resultados após as alterações realizadas.");
    return lines.join("\n");
  }

  if (data.outcome === "ISSUE_IDENTIFIED") {
    lines.push("Hoje realizamos uma nova análise das campanhas.");

    const points = dedupNonEmpty([data.issueDescription, data.notes]);
    if (points.length > 0) {
      lines.push("", "Principais pontos identificados:");
      for (const point of points) lines.push(`• ${point}`);
    }

    lines.push("", "Seguimos acompanhando de perto e retornaremos em breve com mais informações.");
    return lines.join("\n");
  }

  // NO_CHANGE
  lines.push("Hoje realizamos uma nova análise das campanhas.", "");

  const points = dedupNonEmpty([data.notes]);
  if (points.length > 0) {
    lines.push("Principais pontos identificados:");
    for (const point of points) lines.push(`• ${point}`);
    lines.push("");
  }

  lines.push(
    "Neste momento, não identificamos necessidade de realizar alterações na estrutura atual.",
    "",
    "As campanhas seguem sendo acompanhadas e continuaremos avaliando a evolução dos resultados.",
  );
  return lines.join("\n");
}
