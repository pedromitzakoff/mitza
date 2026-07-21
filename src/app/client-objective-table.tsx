import type { ClientObjectiveTableRow as ClientObjectiveRow } from "./overview-client-view";
import type { PerformanceGoal } from "@/lib/performance-goals";
import { PERFORMANCE_GOALS, formatPerformanceResult } from "@/lib/performance-goals";
import type { SpendStatus } from "@/lib/spend-status";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/workspace/button";
import { SectionHeader } from "@/components/workspace/section-header";
import { EmptyState } from "@/components/workspace/empty-state";
import { StatusDot, type StatusTone } from "@/components/workspace/status-dot";

/** Rótulo do filtro de plataforma da Visão Geral — reaproveitado por
 * `src/app/page.tsx` (Controle de investimento, título da tabela) pra nunca
 * duplicar este mapa em dois arquivos. */
export const PLATFORM_LABEL: Record<"consolidado" | "meta" | "google", string> = {
  consolidado: "Consolidado",
  meta: "Meta",
  google: "Google",
};

const SITUATION_LABEL: Record<SpendStatus, string> = {
  dentro: "Dentro",
  acima: "Acima",
  abaixo: "Abaixo",
  sem_meta: "Sem planejamento",
  nao_iniciado: "Ainda não iniciada",
  em_andamento: "Em andamento",
};

const SITUATION_TONE: Record<SpendStatus, StatusTone> = {
  dentro: "success",
  acima: "danger",
  abaixo: "warning",
  sem_meta: "neutral",
  nao_iniciado: "neutral",
  em_andamento: "neutral",
};

/** Plataformas configuradas do cliente (Etapa 2/3 — `clientUsesChannel`),
 * formatadas pra coluna "Plataforma" — "Meta", "Google", "Meta + Google" ou
 * "—" (nenhum dado de plataforma ainda, ex.: cliente recém-criado). */
export function formatClientPlatforms(card: ClientObjectiveRow): string {
  const labels: string[] = [];
  if (card.clientUsesChannel.meta) labels.push("Meta");
  if (card.clientUsesChannel.google) labels.push("Google");
  return labels.length > 0 ? labels.join(" + ") : "—";
}

/**
 * MVP Etapa "Reformular a tabela de clientes" — UM componente parametrizado
 * por objetivo da conta (`objective`), nunca duas implementações
 * independentes pra "Clientes de leads" e "Clientes de vendas". `objective:
 * null` cobre o caso não pedido pelo enunciado mas que precisa de um lugar
 * pra existir sem sumir da tela: cliente sem `performance_goal` configurado
 * (legado, nunca inventado retroativamente — Etapa 71) — mesmas colunas,
 * exceto as 3 que dependem de um objetivo (Leads/Vendas, CPL/CPA, Meta de
 * CPL/CPA), que não fazem sentido sem ele.
 *
 * Respeita o filtro de plataforma da Visão Geral (Etapa 3): `platformFilter`
 * decide se Investimento/Ritmo financeiro/CPL·CPA mostram o valor
 * CONSOLIDADO ou o de um canal só — mesma fonte (`monthActualByChannel`/
 * `monthPerformanceSummaryByChannel`), nunca um cálculo paralelo.
 */
export function ClientObjectiveTable({
  cards,
  objective,
  platformFilter,
  primaryManagerNameByClient,
}: {
  cards: ClientObjectiveRow[];
  objective: PerformanceGoal | null;
  platformFilter: "consolidado" | "meta" | "google";
  primaryManagerNameByClient: Map<string, string | null>;
}) {
  if (cards.length === 0) return null;

  const goalConfig = objective ? PERFORMANCE_GOALS[objective] : null;
  const title = goalConfig
    ? objective === "leads"
      ? `Clientes de leads · ${cards.length}`
      : `Clientes de vendas · ${cards.length}`
    : `Clientes sem objetivo configurado · ${cards.length}`;
  const isConsolidado = platformFilter === "consolidado";

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-overview-border bg-overview-surface">
      <div className="flex items-center justify-between px-3.5 py-2">
        <SectionHeader title={title} />
      </div>

      <div className="overflow-x-auto border-t border-overview-border">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-overview-border bg-overview-surface-subtle text-left text-[12px] font-semibold text-overview-text-secondary">
              <th className="py-2 px-3.5 font-semibold">Cliente</th>
              <th className="py-2 px-3.5 text-right font-semibold">Investimento</th>
              <th className="py-2 px-3.5 font-semibold">Ritmo financeiro</th>
              <th className="py-2 px-3.5 font-semibold">Gestor</th>
              <th className="py-2 px-3.5 font-semibold">Plataforma</th>
              {goalConfig && <th className="py-2 px-3.5 font-semibold">{goalConfig.resultMetricLabel}</th>}
              {goalConfig && <th className="py-2 px-3.5 text-right font-semibold">{goalConfig.costMetricShortLabel}</th>}
              {goalConfig && <th className="py-2 px-3.5 text-right font-semibold">Meta de {goalConfig.costMetricShortLabel}</th>}
              <th className="py-2 px-3.5 font-semibold">Sprint atual</th>
              <th className="py-2 px-3.5 text-right font-semibold">Abrir cliente</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => {
              const investmentValue = isConsolidado ? card.monthActual : (card.monthActualByChannel[platformFilter] ?? 0);
              // Fora do Consolidado, o resumo vem do investimento REAL
              // daquele canal (`monthPerformanceSummaryByChannel`), nunca o
              // consolidado dividido pelos resultados de um canal só.
              const performanceSummary = isConsolidado
                ? card.monthPerformanceSummary
                : (card.monthPerformanceSummaryByChannel[platformFilter] ?? null);
              // Etapa 71: nunca "0 leads"/"0 vendas" fabricado — só quando
              // `hasAnyRecord` é true (registro real existe, mesmo que com
              // contagem 0 — ver PerformanceSummary).
              const resultText = goalConfig && performanceSummary?.hasAnyRecord ? formatPerformanceResult(performanceSummary.resultCount, objective!) : "—";
              const costText =
                goalConfig && performanceSummary?.costPerResult !== null && performanceSummary?.costPerResult !== undefined
                  ? formatCurrency(performanceSummary.costPerResult)
                  : "—";
              const targetText = goalConfig && card.targetCostPerResult !== null ? formatCurrency(card.targetCostPerResult) : "—";

              return (
                <tr
                  key={card.clientId}
                  className="border-b border-overview-border/70 transition-colors duration-150 last:border-0 hover:bg-overview-surface-hover"
                >
                  <td className="py-2.5 px-3.5 font-semibold text-overview-text-primary">{card.clientName}</td>
                  <td className="py-2.5 px-3.5 text-right font-semibold tabular-nums text-overview-text-primary">{formatCurrency(investmentValue)}</td>
                  <td className="py-2.5 px-3.5">
                    {isConsolidado ? (
                      <StatusDot tone={SITUATION_TONE[card.monthStatus]} label={SITUATION_LABEL[card.monthStatus]} />
                    ) : (
                      <span className="text-overview-text-muted">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3.5 text-overview-text-secondary">
                    {primaryManagerNameByClient.get(card.clientId) ?? "Sem gestor"}
                  </td>
                  <td className="py-2.5 px-3.5 text-overview-text-secondary">{formatClientPlatforms(card)}</td>
                  {goalConfig && <td className="py-2.5 px-3.5 text-overview-text-secondary">{resultText}</td>}
                  {goalConfig && <td className="py-2.5 px-3.5 text-right tabular-nums text-overview-text-secondary">{costText}</td>}
                  {goalConfig && <td className="py-2.5 px-3.5 text-right tabular-nums text-overview-text-secondary">{targetText}</td>}
                  <td className="py-2.5 px-3.5 text-overview-text-secondary">{card.sprintPeriodLabel ?? "—"}</td>
                  <td className="py-2.5 px-3.5 text-right">
                    <Button href={`/clients/${card.clientId}`} variant="ghost" size="sm">
                      Abrir cliente
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Fallback pra quando NENHUM cliente do recorte atual bate com nenhum dos
 * 3 grupos (leads/vendas/sem objetivo) — mesma regra de "esconder seção
 * vazia" aplicada ao caso limite de não haver cliente nenhum no recorte. */
export function ClientObjectiveTablesEmptyState() {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-overview-border bg-overview-surface">
      <EmptyState title="Nenhum cliente encontrado com esses filtros." description="Ajuste os filtros acima ou limpe-os para ver todos os clientes monitorados." />
    </div>
  );
}
