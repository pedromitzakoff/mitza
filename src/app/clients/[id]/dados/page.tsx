import Link from "next/link";
import { WorkspaceContainer } from "@/app/clients/workspace-container";

/**
 * `/clients/[id]/dados` — Etapa "MEGA FACELIFT — Fase 1: Novo Shell da
 * Growth Infra". Shell de navegação apenas: valida que o módulo "Dados"
 * existe e é alcançável pela Sidebar e pela troca de cliente
 * (`WORKSPACE_SECTION_SUFFIXES`), sem nenhum conteúdo funcional ainda — o
 * painel de leitura sobre `import_sources`/`data_sync_runs` (hoje só no
 * drawer "Informações da conta" e em `/settings/meta-connections`) e o
 * editor de fontes/mapeamentos (hoje só via SQL manual) são a Fase 2,
 * não implementados aqui de propósito.
 */
export default async function ClientDadosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <WorkspaceContainer>
      <Link href={`/clients/${id}`} className="text-sm font-semibold text-overview-text-secondary hover:text-overview-text-primary">
        &larr; Painel
      </Link>
      <h1 className="mt-3 text-lg font-semibold text-overview-text-primary">Dados</h1>
      <div className="mt-4 rounded-lg border border-overview-border bg-overview-surface p-6">
        <p className="text-sm text-overview-text-secondary">Infraestrutura de dados do cliente.</p>
      </div>
    </WorkspaceContainer>
  );
}
