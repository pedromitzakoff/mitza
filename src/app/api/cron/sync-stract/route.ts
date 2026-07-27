import { NextResponse } from "next/server";
import { runImportForAllEnabledSources } from "@/lib/stract-sync";

// Integração Stract (arquitetura aprovada — ver DECISIONS.md). Estratégia de
// rollout: só a conta de teste fica ativa (`import_sources.enabled`) até a
// validação manual completa (investimento, performance, custo por resultado,
// Dashboard, Sprint, reprocessamento, logs, idempotência, atualização
// retroativa) ser confirmada — por isso esta rota NÃO está ligada em
// `vercel.json` ainda, mesmo já existindo. Pra ativar depois da validação:
//
// {
//   "crons": [{ "path": "/api/cron/sync-stract", "schedule": "0 8 * * *" }]
// }
//
// (Sugestão: 8h, uma hora depois do horário em que o Stract já busca os
// dados do Meta, garantindo que o Import Service sempre leia dado fresco.)
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const results = await runImportForAllEnabledSources();
  return NextResponse.json({ results });
}
