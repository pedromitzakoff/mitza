import { NextResponse } from "next/server";
import { syncAllClientsMetaSpend } from "@/lib/meta-sync";

// Cron automático fica para uma etapa futura — por enquanto essa rota só
// existe para ser chamada manualmente (ou por um cron externo) enquanto o
// botão "Atualizar dados do Meta" cobre o caso de uso principal.
//
// Para ativar um cron na Vercel, crie (ou descomente) em vercel.json:
//
// {
//   "crons": [{ "path": "/api/cron/sync-meta", "schedule": "0 */6 * * *" }]
// }
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const results = await syncAllClientsMetaSpend();
  return NextResponse.json({ results });
}
