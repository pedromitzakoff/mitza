import { NextResponse } from "next/server";
import { runAchievementEvaluation } from "@/lib/achievement-engine";
import { guardCronRequest } from "@/lib/cron-auth";
import { toUserFacingError } from "@/lib/user-facing-error";

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
  const rejection = guardCronRequest(request, "evaluate-achievements");
  if (rejection) return rejection;

  try {
    const summary = await runAchievementEvaluation();
    return NextResponse.json({ summary });
  } catch (err) {
    // Falha catastrófica (ex.: banco fora do ar) — isolada aqui, nunca
    // propagada além desta rota. Erros por cliente/pessoa/organização
    // individual já são capturados dentro de `runAchievementEvaluation`.
    // Etapa 2B: erro completo continua logado server-side
    // (toUserFacingError), a resposta HTTP nunca mais devolve `err.message`
    // cru (poderia vazar detalhe de schema/infra pra quem tiver o
    // CRON_SECRET vazado) — status 500 preservado, só a mensagem mudou.
    return NextResponse.json(
      { error: toUserFacingError(err, "Falha desconhecida ao avaliar conquistas.") },
      { status: 500 },
    );
  }
}
