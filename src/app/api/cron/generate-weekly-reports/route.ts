import { NextResponse } from "next/server";
import { generateWeeklyReports } from "@/lib/weekly-reports/generate-weekly-reports";
import { guardCronRequest } from "@/lib/cron-auth";

/**
 * Aba "Reports" (pedido, seção 1: "gere os reports após a sincronização
 * da manhã"). Cron em `vercel.json` ("/api/cron/generate-weekly-reports"),
 * mesma cadência de `evaluate-alerts` — reprocessa os 2 períodos da semana
 * a cada execução, idempotente por natureza (dedup por
 * `client_id+period_start+period_end`, nunca duplica linha). Rodar mais
 * vezes que o estritamente necessário é inofensivo: é exatamente o que
 * faz um report em "Aguardando dados" virar "Pronto para enviar" assim
 * que a sincronização da manhã terminar, sem precisar saber a que hora
 * isso aconteceu.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const rejection = await guardCronRequest(request, "generate-weekly-reports");
  if (rejection) return rejection;

  const summary = await generateWeeklyReports();
  return NextResponse.json({ summary });
}
