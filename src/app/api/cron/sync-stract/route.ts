import { NextResponse } from "next/server";
import { runImportForAllEnabledSources } from "@/lib/stract-sync";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

// Integração Stract (arquitetura aprovada — ver DECISIONS.md /
// docs/STRACT_INTEGRATION_ARCHITECTURE.md). Validação manual completa (2
// clientes reais, investimento + performance + custo por resultado +
// Dashboard + Sprint + idempotência + logs + bloqueio da sync nativa)
// confirmada — cron ligado em `vercel.json`:
//
// { "crons": [{ "path": "/api/cron/sync-stract", "schedule": "0 11 * * *" }] }
//
// Vercel Cron sempre interpreta o schedule em UTC. `0 11 * * *` = 11h UTC =
// 8h no fuso da agência (America/Sao_Paulo, UTC-3 o ano todo — Brasil não
// tem mais horário de verão desde 2019, então essa conversão nunca muda).
// Uma hora depois do horário em que o Stract já busca os dados do Meta (7h
// local), garantindo que o Import Service sempre leia dado fresco.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await runImportForAllEnabledSources();
  return NextResponse.json({ results });
}
