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

/**
 * Etapa "MEGA FACELIFT — Fase 4.6: Módulos Fixos + Cliente como Contexto
 * Global" — MÓDULO é fixo (os 7 da Growth Infra), CLIENTE é contexto. A
 * Sidebar deixa de ter "Navegação da Carteira" e "Navegação do Cliente"
 * como dois menus — vira UMA navegação (`ModuleKey`), e o CONTEXTO
 * (`AppContext`: "Todos" ou um cliente específico) decide o escopo.
 * `buildModuleContextHref`/`resolveCurrentModuleAndContext` são o núcleo
 * puro ÚNICO que resolve "módulo atual + contexto desejado -> URL" —
 * usado pela Sidebar, por `ClientWorkspaceHeader` (saída pra "Todos") e
 * por `GlobalScopeSelect` (entrada de "Todos" pra um cliente), nunca
 * duplicado/reimplementado em cada componente (seção 17 do pedido).
 */
export type ModuleKey = "dashboard" | "metas" | "performance" | "dados" | "operation" | "demandas" | "timeline";

export type AppContext = { type: "all" } | { type: "client"; id: string };

/** Mesmo vocabulário de sufixo de `WORKSPACE_SECTION_SUFFIXES` acima, só
 * reindexado por módulo (chave estável, nunca o sufixo bruto) — os dois
 * precisam ficar em sincronia manual (um módulo novo aqui sem entrada lá
 * nunca é reconhecido ao trocar de cliente). */
const MODULE_CLIENT_SUFFIX: Record<ModuleKey, string> = {
  dashboard: "",
  metas: "/metas",
  performance: "/relatorio",
  dados: "/dados",
  operation: "/operation",
  demandas: "/demandas",
  timeline: "/timeline",
};

const SUFFIX_TO_MODULE: Record<string, ModuleKey> = {
  "": "dashboard",
  "/metas": "metas",
  "/relatorio": "performance",
  "/dados": "dados",
  "/operation": "operation",
  "/demandas": "demandas",
  "/timeline": "timeline",
};

/** Só os módulos que têm uma rota GLOBAL de verdade hoje (seção 8 do
 * pedido) — Metas/Performance/Dados nunca tiveram uma versão consolidada
 * da carteira inteira, e esta fase explicitamente NÃO cria uma (seção 7:
 * "não inventar dashboard/agregação consolidada"). Pra esses 3, contexto
 * "Todos" cai em `/clients` (escolher um cliente), decisão documentada —
 * nunca um redirect pra uma página que não existe. */
const MODULE_GLOBAL_HREF: Partial<Record<ModuleKey, string>> = {
  dashboard: "/",
  operation: "/operation",
  demandas: "/demandas",
  timeline: "/timeline",
};

/** Resolve "módulo atual + contexto desejado" pra uma URL — único lugar
 * que sabe montar esse destino (seção 17 do pedido: "evitar lógica de
 * pathname duplicada"). `month` só se aplica ao contexto de CLIENTE
 * (mesmo `buildWorkspaceHref` de sempre) — nunca propagado pra uma rota
 * global, cujo próprio `?month=` (quando existe) tem semântica e formato
 * independentes (seção 16: filtros locais continuam locais). */
export function buildModuleContextHref(module: ModuleKey, context: AppContext, month: string | null): string {
  if (context.type === "client") return buildWorkspaceHref(context.id, MODULE_CLIENT_SUFFIX[module], month);
  return MODULE_GLOBAL_HREF[module] ?? "/clients";
}

/** Resolve módulo + contexto ATUAIS a partir do pathname — núcleo único
 * usado pela Sidebar (destaque do item ativo) e por `ClientWorkspaceHeader`
 * (pra saber qual módulo replicar ao sair pra "Todos"). `module: null`
 * cobre rotas que não são nenhum dos 7 módulos (`/clients`, `/team`,
 * `/settings` — área "Gestão", sem conceito de módulo/contexto). Dentro
 * de um cliente, reaproveita `resolveReplicableSuffix` — a MESMA regra
 * de sempre pra rotas legadas fora dos 7 módulos (`/edit`,
 * `/tasks/new`) cair no Dashboard, nunca uma segunda regra. */
export function resolveCurrentModuleAndContext(pathname: string): { module: ModuleKey | null; context: AppContext } {
  const clientId = resolveActiveClientIdFromPathname(pathname);
  if (clientId) {
    const suffix = resolveReplicableSuffix(resolveCurrentSuffix(pathname, clientId));
    return { module: SUFFIX_TO_MODULE[suffix] ?? "dashboard", context: { type: "client", id: clientId } };
  }
  if (pathname === "/") return { module: "dashboard", context: { type: "all" } };
  if (pathname.startsWith("/operation")) return { module: "operation", context: { type: "all" } };
  if (pathname.startsWith("/demandas") || pathname.startsWith("/pendencias")) return { module: "demandas", context: { type: "all" } };
  if (pathname.startsWith("/timeline") || pathname.startsWith("/achievements")) return { module: "timeline", context: { type: "all" } };
  return { module: null, context: { type: "all" } };
}
