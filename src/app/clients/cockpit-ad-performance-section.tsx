"use client";

import { useState } from "react";
import type { MetricCardViewModel } from "@/lib/meta-ads-dashboard/metric-cards";
import type { ChartMetricSeries } from "@/lib/meta-ads-dashboard/evolution-data";
import { CockpitAdMetricCards } from "./cockpit-ad-metric-cards";
import { CockpitAdEvolutionSection } from "./cockpit-ad-evolution-section";

type Tab = "indicators" | "evolution";

const TABS: { id: Tab; label: string }[] = [
  { id: "indicators", label: "Indicadores" },
  { id: "evolution", label: "Evolução" },
];

/**
 * MITZA ONE — Cockpit Único do Cliente, seção "Performance Meta Ads".
 * Etapa "Redesign e organização visual do Cockpit": reduz a seção que
 * antes empilhava cards → gráfico → tabela, um embaixo do outro, dentro
 * de uma caixa única — os cards de KPI e o gráfico de evolução
 * respondem, essencialmente, a mesma pergunta ("como está a performance
 * de mídia?") em duas vistas diferentes, por isso viram ABAS (pedido do
 * usuário: "use abas... quando isso melhorar a experiência"), nunca duas
 * seções competindo por atenção ao mesmo tempo. A tabela de exploração
 * (Campanhas/Conjuntos/Anúncios) SAIU daqui — vive como sua própria seção,
 * sempre visível, logo abaixo (pedido explícito: "essa deve ser uma das
 * seções mais úteis da página", precisa de destaque, nunca escondida
 * atrás de uma aba).
 *
 * Nenhuma caixa externa envolvendo tudo (como a versão anterior) — esta
 * seção usa o MESMO padrão visual das outras do Cockpit (cabeçalho
 * discreto + conteúdo, sem uma segunda moldura redundante).
 */
export function CockpitAdPerformanceSection({
  clientId,
  metaAdAccountId,
  cards,
  evolution,
}: {
  clientId: string;
  metaAdAccountId: string | null;
  cards: MetricCardViewModel[];
  evolution: ChartMetricSeries[];
}) {
  const [tab, setTab] = useState<Tab>("indicators");

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-overview-text-muted">Performance Meta Ads</h2>
        <p className="shrink-0 text-right text-[11px] text-overview-text-muted">
          {metaAdAccountId ? `Conta ${metaAdAccountId}` : "Conta Meta direta não configurada"}
        </p>
      </div>

      {/* Pedido do usuário (reafirmado na Etapa 2.4): diferenciar métricas
          atribuídas pela Meta de resultados gerais do negócio. */}
      <p className="mt-0.5 text-xs text-overview-text-secondary">
        Resultados atribuídos pela Meta (janela de atribuição do Ads Manager) — não confirmados por uma fonte de negócio independente.
      </p>

      <div className="mt-3 inline-flex w-fit items-center gap-1 rounded-full border border-overview-border bg-overview-surface p-1 text-xs font-semibold">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1.5 ${tab === t.id ? "bg-brand text-white" : "text-overview-text-secondary hover:text-overview-text-primary"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {tab === "indicators" ? <CockpitAdMetricCards clientId={clientId} cards={cards} /> : <CockpitAdEvolutionSection series={evolution} />}
      </div>
    </div>
  );
}
