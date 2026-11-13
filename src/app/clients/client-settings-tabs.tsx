"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type ClientSettingsTab = "geral" | "midia" | "metricas" | "links";

const TAB_LABELS: Record<ClientSettingsTab, string> = {
  geral: "Geral",
  midia: "Mídia",
  metricas: "Métricas",
  links: "Links",
};

const ClientSettingsTabContext = createContext<ClientSettingsTab>("geral");

/**
 * "Configurações do Cliente" (redesign de `/clients/[id]/edit`, pedido
 * explícito do usuário) — 4 abas (Geral/Mídia/Métricas/Links), navegação
 * 100% client-side (nunca recarrega a página). Alternar de aba só troca o
 * que fica VISÍVEL (classe `hidden`, nunca desmontagem) — o próprio
 * `<form>` principal (Geral+Mídia+Links, um elemento só por baixo das 3
 * abas — ver `client-form.tsx`) e as seções independentes de Métricas
 * continuam montados o tempo todo. Por isso trocar de aba nunca descarta
 * uma alteração pendente em silêncio (ponto 6 do pedido) — não existe
 * "reset" nenhum pra implementar, o estado simplesmente nunca é destruído.
 *
 * Mesma árvore/CSS pra desktop e mobile (ponto 10: "não criar uma segunda
 * implementação pro mobile") — a faixa de abas rola horizontalmente
 * (`overflow-x-auto`) em telas estreitas, sem nenhum componente adicional.
 */
export function ClientSettingsTabsProvider({
  showMetricsTab,
  children,
}: {
  /** Métricas é inteiramente admin-only (Bloco A/B já eram `isAdmin &&`
   * antes desta etapa) — pra um gestor não-admin a aba nem aparece, em vez
   * de abrir num painel vazio sem nenhuma ação disponível. */
  showMetricsTab: boolean;
  children: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<ClientSettingsTab>("geral");
  const tabs: ClientSettingsTab[] = showMetricsTab ? ["geral", "midia", "metricas", "links"] : ["geral", "midia", "links"];

  return (
    <ClientSettingsTabContext.Provider value={activeTab}>
      <nav role="tablist" aria-label="Seções de configuração do cliente" className="flex gap-1 overflow-x-auto border-b border-overview-border">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`mitza-pressable shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              activeTab === tab
                ? "border-brand text-brand"
                : "border-transparent text-overview-text-secondary hover:text-overview-text-primary"
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </nav>
      <div className="mt-5">{children}</div>
    </ClientSettingsTabContext.Provider>
  );
}

export function useClientSettingsTab(): ClientSettingsTab {
  return useContext(ClientSettingsTabContext);
}

/** Mostra os filhos só quando `tab` é a aba ativa — sem desmontar (ver
 * comentário acima). Usado pelo conteúdo que vive FORA do `<form>`
 * principal (a aba Métricas, cujas seções são Server Actions
 * independentes dele). */
export function ClientSettingsTabPanel({
  tab,
  className = "flex flex-col gap-6",
  children,
}: {
  tab: ClientSettingsTab;
  className?: string;
  children: ReactNode;
}) {
  const activeTab = useClientSettingsTab();
  return <div className={activeTab === tab ? className : "hidden"}>{children}</div>;
}
