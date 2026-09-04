import { NextResponse } from "next/server";
import { ensureAllClientsSprints } from "@/lib/sprint-generation";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

// Etapa 50 (correção): a geração de sprints deixou de rodar durante o
// carregamento de página (causava geração duplicada) — agora só acontece
// aqui, numa rota chamada por cron (ver vercel.json, 03:00 UTC diariamente).
//
// Achado no levantamento "estado geral do sistema": entre a correção acima e
// esta etapa, o cron nunca chegou a ser registrado em vercel.json — só o
// gatilho de criação de cliente (trg_create_initial_sprints, ver
// supabase/sprint-calendar-reconciliation.sql) cobria o horizonte de +2
// meses, e só no momento em que o cliente era criado. Sem esta rota rodando
// periodicamente, um cliente já existente parava de ganhar sprint nova
// conforme os meses passavam — corrigido registrando o cron aqui.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await ensureAllClientsSprints();
  return NextResponse.json({ results });
}
