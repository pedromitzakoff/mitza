import { redirect } from "next/navigation";
import { buildReportsRedirectHref } from "../report-panel";

/**
 * Etapa "Separação Relatório Operacional × Documento de Performance":
 * `/reports/[clientId]` aposentada — o documento de performance que essa
 * rota tentava mostrar (Campanhas/Criativos/KPIs) é 100% do Relatório de
 * Performance agora (`/clients/[id]/relatorio`, aberto direto de
 * `/reports`), e o workflow de status (não iniciado/em andamento/pronto
 * para revisão/finalizado) migrou pra dentro da própria linha da tabela em
 * `/reports`. Nunca 404 — bookmarks/links antigos continuam levando a algum
 * lugar real, com mês e cliente preservados quando possível.
 */
export default async function ClientReportRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { clientId } = await params;
  const { month } = await searchParams;
  redirect(buildReportsRedirectHref(clientId, month));
}
