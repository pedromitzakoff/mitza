import { NextResponse } from "next/server";
import { ensureAllClientsSprints } from "@/lib/sprint-generation";

// Etapa 50 (correção): a geração de sprints deixou de rodar durante o
// carregamento de página (causava geração duplicada) — agora só acontece
// aqui, numa rota chamada sob demanda (manual ou por um cron externo),
// mesmo padrão já usado por /api/cron/sync-meta.
//
// Para ativar um cron na Vercel, adicione em vercel.json:
//
// {
//   "crons": [{ "path": "/api/cron/ensure-sprints", "schedule": "0 3 * * *" }]
// }
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const results = await ensureAllClientsSprints();
  return NextResponse.json({ results });
}
