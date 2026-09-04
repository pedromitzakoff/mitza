import { NextResponse } from "next/server";

/**
 * Etapa "Relatório Único"/"Relatório Nativo": rota aposentada — "Exportar
 * relatório" do Analytics (antigo PDF snapshot da tela do hub) deixou de
 * existir como documento próprio. Mantida só como REDIRECT (nunca 404
 * silencioso pra um link/bookmark antigo), agora pra página NATIVA do
 * Relatório de Performance (`/clients/[id]/relatorio`) — nunca mais direto
 * pro endpoint de PDF: a experiência principal é a página, PDF é só a opção
 * de exportação dentro dela. Nenhuma lógica de negócio sobrevive aqui, só o
 * encaminhamento do período (`analyticsPlatform` não existe no destino: o
 * Relatório de Performance é Meta-only).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);

  const destination = new URL(`/clients/${id}/relatorio`, url.origin);
  const preset = url.searchParams.get("analyticsPreset");
  const start = url.searchParams.get("analyticsStart");
  const end = url.searchParams.get("analyticsEnd");
  if (preset) destination.searchParams.set("analyticsPreset", preset);
  if (start) destination.searchParams.set("analyticsStart", start);
  if (end) destination.searchParams.set("analyticsEnd", end);

  return NextResponse.redirect(destination, { status: 308 });
}
