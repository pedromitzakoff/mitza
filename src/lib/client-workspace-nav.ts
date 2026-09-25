/**
 * Núcleo puro da navegação do workspace do cliente (Etapa "MITZA —
 * Reformulação Estrutural"; revisado na Etapa "Correção de UX do
 * Workspace" — as 5 abas viraram 5 ROTAS DE APROFUNDAMENTO, não mais
 * abas equivalentes competindo no header. Este módulo só resolve "qual
 * sufixo replicar ao trocar de cliente" e "qual URL montar" — extraído de
 * `client-workspace-header.tsx` pra ser testável sem DOM/router (mesmo
 * padrão já usado em `lib/pendencias.ts` pro núcleo de filtro/agrupamento).
 *
 * `resolveActiveTab`/`WORKSPACE_TABS` (com `label`) existiram só pra
 * destacar a aba ativa na antiga barra `role="tablist"` — removidos junto
 * com ela (Etapa "Correção de UX do Workspace"); as 5 rotas continuam
 * existindo (seção 15 do pedido de correção: "as rotas da Fase 1 não
 * foram um erro"), só deixaram de ter uma barra de abas dedicada.
 */

/** Sufixos relativos a `/clients/[id]` reconhecidos como "seção do
 * workspace" — os únicos que são replicados ao trocar de cliente
 * (seletor ou anterior/próximo). "" é o Painel principal (Visão geral). */
export const WORKSPACE_SECTION_SUFFIXES: string[] = ["", "/relatorio", "/operation", "/demandas", "/edit"];

/** Sufixo da rota atual relativo a `/clients/[id]` — "" na raiz. */
export function resolveCurrentSuffix(pathname: string, clientId: string): string {
  const basePath = `/clients/${clientId}`;
  return pathname === basePath ? "" : pathname.slice(basePath.length);
}

/** Sufixo a replicar ao trocar de cliente (seletor ou anterior/próximo) —
 * decisão 1 do usuário: preservar a SEÇÃO atual, nunca voltar pro Painel
 * principal à toa (ex.: "Helping Hand / relatório completo → próximo
 * cliente → Kaizen / relatório completo"). Só um dos sufixos reconhecidos
 * é replicado; qualquer outra rota (legada, fora das 5 seções — ex.:
 * `/clients/[id]/tasks/new`) cai pra "" (Painel principal) — replicar uma
 * URL de formulário legado pro próximo cliente não faz sentido. */
export function resolveReplicableSuffix(currentSuffix: string): string {
  return WORKSPACE_SECTION_SUFFIXES.includes(currentSuffix) ? currentSuffix : "";
}

/** Monta a URL final do workspace pra um cliente + sufixo de seção + mês
 * opcional (único parâmetro verdadeiramente compartilhado entre seções). */
export function buildWorkspaceHref(clientId: string, suffix: string, month: string | null): string {
  const monthQuery = month ? `?month=${month}` : "";
  return `/clients/${clientId}${suffix}${monthQuery}`;
}
