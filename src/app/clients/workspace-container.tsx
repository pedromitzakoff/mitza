/**
 * Largura compartilhada do workspace do cliente (Etapa "Correção de UX do
 * Workspace" — causa raiz auditada: cada rota (`[id]/page.tsx`,
 * `[id]/operation/page.tsx`, além do header) embrulhava seu próprio
 * conteúdo num `mx-auto max-w-5xl` independente — um resquício copiado do
 * antigo monólito de 1944 linhas, nunca uma restrição vinda do
 * `layout.tsx` (que não define largura nenhuma, só `flex flex-col`) nem do
 * `<main>` do `AppShell` (`min-w-0 flex-1`, sem cap). Cada rota nova
 * simplesmente repetiu o padrão por convenção, e a barra `role="tablist"`
 * do header tinha seu PRÓPRIO `max-w-5xl` de novo — daí o painel e o
 * cabeçalho ficarem estreitos e desalinhados um do outro.
 *
 * Correção: uma única constante de largura, usada pelo header e pelas
 * rotas genéricas do workspace (Painel/`Operação`). `/relatorio` e a List
 * View de Demandas (`pendencias-page-client.tsx`) têm padding/identidade
 * visual próprios (paleta do Relatório, por exemplo) — não usam este
 * componente diretamente, mas importam `WORKSPACE_CONTENT_MAX_WIDTH_CLASS`
 * pra manter a MESMA borda vertical entre as rotas (nunca um segundo valor
 * de largura inventado). `/edit` (Configurações) fica de fora de propósito
 * — largura de formulário é decisão do PRÓPRIO conteúdo, não do workspace
 * (seção 17 do pedido de correção).
 *
 * 1600px (~100rem) foi escolhido por aproveitar a largura real disponível
 * em desktop/notebook comuns (1440–1920px, sidebar de 256px já descontada)
 * sem chegar a linhas de texto desconfortavelmente longas em monitores
 * ultra-wide/4K — não é "100% da tela", é "quase toda a largura útil".
 */
export const WORKSPACE_CONTENT_MAX_WIDTH_CLASS = "max-w-[1600px]";

export function WorkspaceContainer({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full ${WORKSPACE_CONTENT_MAX_WIDTH_CLASS} px-6 py-5 sm:px-8 lg:px-10 ${className}`}>{children}</div>;
}
