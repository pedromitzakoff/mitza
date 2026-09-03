import { NextResponse } from "next/server";

/**
 * Etapa "Relatório Único": rota aposentada — "Exportar relatório" do
 * Analytics (antigo PDF snapshot da tela do hub) deixou de existir como
 * documento próprio, ver `docs/` da etapa. Mantida só como REDIRECT (nunca
 * 404 silencioso pra um link/bookmark antigo) pro Relatório de Performance
 * já existente, que agora é o único documento de performance da plataforma
 * — nenhuma lógica de negócio sobrevive aqui, só o encaminhamento do
 * período (`analyticsPlatform` não existe no destino: o Relatório de
 * Performance é Meta-only, mesmo comportamento que o antigo botão
 * "Gerar Relatório de Performance" dentro do hub já tinha).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);

  const destination = new URL(`/api/clients/${id}/performance-report`, url.origin);
  const preset = url.searchParams.get("analyticsPreset");
  const start = url.searchParams.get("analyticsStart");
  const end = url.searchParams.get("analyticsEnd");
  if (preset) destination.searchParams.set("analyticsPreset", preset);
  if (start) destination.searchParams.set("analyticsStart", start);
  if (end) destination.searchParams.set("analyticsEnd", end);

  return NextResponse.redirect(destination, { status: 308 });
}
