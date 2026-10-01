import Link from "next/link";
import { WorkspaceContainer } from "@/app/clients/workspace-container";

/**
 * `/clients/[id]/timeline` — Etapa "MEGA FACELIFT — Fase 1: Novo Shell da
 * Growth Infra". Shell de navegação apenas: valida que o módulo
 * "Timeline" existe e é alcançável pela Sidebar e pela troca de cliente
 * (`WORKSPACE_SECTION_SUFFIXES`), sem nenhum conteúdo funcional ainda —
 * reaproveitar `client-operational-history.ts`/`ClientHistoryList` (hoje
 * embutidos no drawer de Operação) como a memória de Growth deste
 * cliente é a Fase 2, não implementado aqui de propósito.
 */
export default async function ClientTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <WorkspaceContainer>
      <Link href={`/clients/${id}`} className="text-sm font-semibold text-overview-text-secondary hover:text-overview-text-primary">
        &larr; Painel
      </Link>
      <h1 className="mt-3 text-lg font-semibold text-overview-text-primary">Timeline</h1>
      <div className="mt-4 rounded-lg border border-overview-border bg-overview-surface p-6">
        <p className="text-sm text-overview-text-secondary">Histórico do Growth deste cliente.</p>
      </div>
    </WorkspaceContainer>
  );
}
