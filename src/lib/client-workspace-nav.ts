/**
 * Núcleo puro da navegação do workspace do cliente (Etapa "MITZA —
 * Reformulação Estrutural") — extraído de `client-workspace-header.tsx`
 * pra ser testável sem DOM/router (mesmo padrão já usado em
 * `lib/pendencias.ts` pro núcleo de filtro/agrupamento). O componente é só
 * a casca visual; toda decisão de "qual sufixo replicar"/"qual URL montar"
 * mora aqui.
 */

export type WorkspaceTabKey = "visao-geral" | "performance" | "operacao" | "demandas" | "configuracoes";

export interface WorkspaceTab {
  key: WorkspaceTabKey;
  label: string;
  /** Relativo a `/clients/[id]` — "" é a raiz (Visão geral). */
  suffix: string;
}

export const WORKSPACE_TABS: WorkspaceTab[] = [
  { key: "visao-geral", label: "Visão geral", suffix: "" },
  { key: "performance", label: "Performance", suffix: "/relatorio" },
  { key: "operacao", label: "Operação", suffix: "/operation" },
  { key: "demandas", label: "Demandas", suffix: "/demandas" },
  { key: "configuracoes", label: "Configurações", suffix: "/edit" },
];

/** Sufixo da rota atual relativo a `/clients/[id]` — "" na raiz. */
export function resolveCurrentSuffix(pathname: string, clientId: string): string {
  const basePath = `/clients/${clientId}`;
  return pathname === basePath ? "" : pathname.slice(basePath.length);
}

/** Qual aba está ativa pro pathname atual — `undefined` pra rotas legadas
 * fora das 5 abas (ex.: `/clients/[id]/tasks/new`). */
export function resolveActiveTab(pathname: string, clientId: string): WorkspaceTab | undefined {
  const basePath = `/clients/${clientId}`;
  return WORKSPACE_TABS.find((tab) => (tab.suffix === "" ? pathname === basePath : pathname.startsWith(`${basePath}${tab.suffix}`)));
}

/** Sufixo a replicar ao trocar de cliente (seletor ou anterior/próximo) —
 * decisão 1 do usuário: preservar a ABA atual, nunca voltar pra Visão
 * geral à toa. Só um dos 5 sufixos reconhecidos é replicado; qualquer
 * outra rota (legada, fora das 5 abas) cai pra "" (Visão geral) — replicar
 * uma URL de formulário legado pro próximo cliente não faz sentido. */
export function resolveReplicableSuffix(currentSuffix: string): string {
  return WORKSPACE_TABS.some((tab) => tab.suffix === currentSuffix) ? currentSuffix : "";
}

/** Monta a URL final do workspace pra um cliente + sufixo de aba + mês
 * opcional (único parâmetro verdadeiramente compartilhado entre abas). */
export function buildWorkspaceHref(clientId: string, suffix: string, month: string | null): string {
  const monthQuery = month ? `?month=${month}` : "";
  return `/clients/${clientId}${suffix}${monthQuery}`;
}
