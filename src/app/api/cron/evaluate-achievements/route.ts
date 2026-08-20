import { NextResponse } from "next/server";
import { runAchievementEvaluation } from "@/lib/achievement-engine";

// Sistema de Conquistas — motor de avaliação (aprovado após a Auditoria +
// as 4 determinações de amostra/recorde-mensal/frescor/streak). Roda
// depois do `sync-stract` (8h local) pra sempre avaliar sobre dado já
// sincronizado — nunca antes. Cron ligado em `vercel.json`:
//
// { "crons": [{ "path": "/api/cron/evaluate-achievements", "schedule": "30 11 * * *" }] }
//
// Vercel Cron sempre interpreta o schedule em UTC. `30 11 * * *` = 11h30
// UTC = 8h30 no fuso da agência (America/Sao_Paulo, UTC-3 o ano todo) —
// 30 minutos depois do `sync-stract` (8h local), dando folga pro Import
// Service terminar antes do motor de Conquistas ler os dados.
//
// Isolamento (salvaguarda de aprovação nº3): esta rota nunca toca
// `daily_spend`/`daily_performance`/`data_sync_runs` — só LÊ. Uma falha
// aqui nunca pode quebrar sync nem qualquer fluxo operacional; erro por
// cliente/pessoa/organização é isolado dentro de `runAchievementEvaluation`
// (um cliente com problema nunca aborta os demais).
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const summary = await runAchievementEvaluation();
    return NextResponse.json({ summary });
  } catch (err) {
    // Falha catastrófica (ex.: banco fora do ar) — isolada aqui, nunca
    // propagada além desta rota. Erros por cliente/pessoa/organização
    // individual já são capturados dentro de `runAchievementEvaluation`.
    return NextResponse.json({ error: err instanceof Error ? err.message : "Falha desconhecida ao avaliar conquistas." }, { status: 500 });
  }
}
