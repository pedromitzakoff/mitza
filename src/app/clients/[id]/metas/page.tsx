import Link from "next/link";
import { WorkspaceContainer } from "@/app/clients/workspace-container";

/**
 * `/clients/[id]/metas` — Etapa "MEGA FACELIFT — Fase 1: Novo Shell da
 * Growth Infra". Shell de navegação apenas: valida que a rota/módulo
 * "Metas" existe e é alcançável pela Sidebar e pela troca de cliente
 * (`WORKSPACE_SECTION_SUFFIXES`), sem nenhum conteúdo funcional ainda — a
 * tabela "Resumo das Metas" (Indicador × Meta × Realizado × colunas
 * diárias) é a Fase 2, sobre dados que já existem hoje
 * (`client_goals`/`monthly_budget_changes`/`resolveClientMonthlyGoals`),
 * não implementada aqui de propósito.
 */
export default async function ClientMetasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <WorkspaceContainer>
      <Link href={`/clients/${id}`} className="text-sm font-semibold text-overview-text-secondary hover:text-overview-text-primary">
        &larr; Painel
      </Link>
      <h1 className="mt-3 text-lg font-semibold text-overview-text-primary">Metas</h1>
      <div className="mt-4 rounded-lg border border-overview-border bg-overview-surface p-6">
        <p className="text-sm text-overview-text-secondary">Área de metas do cliente.</p>
      </div>
    </WorkspaceContainer>
  );
}
