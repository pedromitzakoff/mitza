/**
 * Núcleo puro da navegação do workspace do cliente — extraído de
 * `client-workspace-header.tsx`/`sidebar.tsx` pra ser testável sem DOM/
 * router.
 *
 * KOFF Analytics — Etapa 1.8: toda a camada de "módulos" (`ModuleKey`,
 * `AppContext`, `MODULE_CLIENT_SUFFIX`, `SUFFIX_TO_MODULE`,
 * `MODULE_GLOBAL_HREF`, `MODULES_OFFERING_ALL_IN_SELECTOR`,
 * `moduleSupportsAllContext`, `buildModuleContextHref`,
 * `resolveModuleLinkContext`, `resolveCurrentModuleAndContext`) foi removida
 * — existia só pra sustentar `GlobalScopeSelect` (removido junto com
 * Operação) e `resolveModuleLinkContext`/`resolveCurrentModuleAndContext`
 * já estavam sem nenhum consumidor real desde a Etapa 1.3 da
 * reestruturação KOFF Analytics. Restam só as três funções com consumidor
 * analítico real: `resolveCurrentSuffix` (`client-workspace-header.tsx`),
 * `buildWorkspaceHref`/`resolveActiveClientIdFromPathname` (`sidebar.tsx`).
 */

/** Sufixo da rota atual relativo a `/clients/[id]` — "" na raiz. */
export function resolveCurrentSuffix(pathname: string, clientId: string): string {
  const basePath = `/clients/${clientId}`;
  return pathname === basePath ? "" : pathname.slice(basePath.length);
}

/** Monta a URL final do workspace pra um cliente + sufixo de seção + mês
 * opcional (único parâmetro verdadeiramente compartilhado entre seções). */
export function buildWorkspaceHref(clientId: string, suffix: string, month: string | null): string {
  const monthQuery = month ? `?month=${month}` : "";
  return `/clients/${clientId}${suffix}${monthQuery}`;
}

/**
 * Extrai o id do cliente de um pathname, só pra decidir se a Sidebar está
 * "dentro" de um workspace de cliente (mostra o bloco "Cliente") — testável
 * sem DOM/router. `/clients` (lista) e `/clients/new` (criação) nunca contam
 * como contexto de cliente.
 */
export function resolveActiveClientIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/clients\/([^/]+)/);
  if (!match) return null;
  return match[1] === "new" ? null : match[1];
}
