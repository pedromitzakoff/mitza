import { PERFORMANCE_GOALS, type PerformanceGoal } from "@/lib/performance-goals";
import type { ClientGoal } from "@/lib/client-goals";
import { ClientContextSelect } from "./client-context-select";

/**
 * Seletor "Meta / Planejamento" (Etapa "Primeira Rodada Visual — Contexto +
 * Performance", seção 5 do pedido) — populado por `client_goals`
 * (`lib/client-goals.ts`), ZERO migration/armazenamento novo. Rótulos vêm
 * de `PERFORMANCE_GOALS` (`lib/performance-goals.ts`), os mesmos já usados
 * em todo o resto da plataforma — nunca um nome inventado tipo "Captação"
 * aqui (isso é identidade de FUNIL, um conceito diferente, ver auditoria).
 *
 * `goals.length <= 1` vira rótulo estático (mesmo critério que
 * `VisaoGeralChannelSwitch` já aplicava pra canal) — sem nada pra trocar,
 * não faz sentido um controle interativo que não faz nada.
 *
 * A opção do objetivo PRINCIPAL navega pra uma URL SEM o param `goal`
 * (`buildHref(null)`) — ausência do param é o estado "default" (seção 5 do
 * pedido: "se o usuário não escolher nada, mostrar exatamente o objetivo
 * principal"), nunca um valor explícito reservado pra "principal".
 */
export function GoalSelect({
  goals,
  selectedResultType,
  buildHref,
}: {
  goals: ClientGoal[];
  selectedResultType: PerformanceGoal | null;
  buildHref: (resultType: PerformanceGoal | null) => string;
}) {
  if (goals.length === 0) return null;

  if (goals.length === 1) {
    return <span className="text-sm font-medium text-overview-text-primary">{PERFORMANCE_GOALS[goals[0].resultType].label}</span>;
  }

  const options = goals.map((goal) => ({
    value: goal.resultType,
    label: `${PERFORMANCE_GOALS[goal.resultType].label}${goal.isPrimary ? " (principal)" : ""}`,
    href: buildHref(goal.isPrimary ? null : goal.resultType),
    active: goal.resultType === selectedResultType,
  }));

  const triggerLabel = selectedResultType ? PERFORMANCE_GOALS[selectedResultType].label : "Objetivo";

  return <ClientContextSelect label={triggerLabel} options={options} ariaLabel="Meta / Planejamento" />;
}
