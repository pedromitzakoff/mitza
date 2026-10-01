/**
 * Núcleo puro da navegação do workspace do cliente (Etapa "MITZA —
 * Reformulação Estrutural"; revisado na Etapa "Correção de UX do
 * Workspace" — as 5 abas viraram 5 ROTAS DE APROFUNDAMENTO, não mais
 * abas equivalentes competindo no header; revisado novamente na Etapa
 * "MEGA FACELIFT — Fase 1: Novo Shell da Growth Infra" — as seções
 * reconhecidas passam a ser os 7 módulos da Growth Infra do cliente
 * (Dashboard/Metas/Performance/Dados/Operação/Demandas/Timeline), agora
 * navegáveis diretamente pela Sidebar (`CLIENT_MODULE_ITEMS`,
 * `sidebar.tsx`), não só pelo header). Este módulo só resolve "qual
 * sufixo replicar ao trocar de cliente" e "qual URL montar" — extraído de
 * `client-workspace-header.tsx` pra ser testável sem DOM/router (mesmo
 * padrão já usado em `lib/pendencias.ts` pro núcleo de filtro/agrupamento).
 *
 * `resolveActiveTab`/`WORKSPACE_TABS` (com `label`) existiram só pra
 * destacar a aba ativa na antiga barra `role="tablist"` — removidos junto
 * com ela (Etapa "Correção de UX do Workspace"); as rotas continuam
 * existindo (seção 15 do pedido de correção: "as rotas da Fase 1 não
 * foram um erro"), só deixaram de ter uma barra de abas dedicada — a
 * navegação entre elas agora vive na Sidebar.
 *
 * `/edit` (Configurações do cliente) saiu da lista replicável nesta
 * etapa: a auditoria da mudança estrutural (seção V) reclassificou
 * Edição como administrativo, não um módulo de Growth — trocar de
 * cliente estando em `/edit` agora cai pro Dashboard, mesmo
 * comportamento já aplicado a qualquer rota legada fora da lista (ex.:
 * `/clients/[id]/tasks/new`). A rota `/edit` em si continua existindo e
 * funcionando exatamente como antes — só deixou de ser replicada.
 */

/** Sufixos relativos a `/clients/[id]` reconhecidos como "módulo da
 * Growth Infra" — os únicos que são replicados ao trocar de cliente
 * (seletor ou anterior/próximo) e os únicos navegáveis pelo bloco
 * "Cliente" da Sidebar. "" é o Dashboard (Painel). `/relatorio` continua
 * com este nome técnico de rota (nenhum link/PDF/`/r/[token]` quebra) —
 * "Performance" é só o rótulo exibido na navegação. */
export const WORKSPACE_SECTION_SUFFIXES: string[] = ["", "/metas", "/relatorio", "/dados", "/operation", "/demandas", "/timeline"];

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

/**
 * Etapa "MEGA FACELIFT — Fase 1": extrai o id do cliente de um pathname,
 * só pra decidir se a Sidebar está "dentro" de um workspace de cliente
 * (mostra o bloco "Cliente") — extraído de `sidebar.tsx` pra ser
 * testável sem DOM/router, mesmo padrão das demais funções deste módulo.
 * `/clients` (lista) e `/clients/new` (criação) nunca contam como
 * contexto de cliente.
 */
export function resolveActiveClientIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/clients\/([^/]+)/);
  if (!match) return null;
  return match[1] === "new" ? null : match[1];
}
