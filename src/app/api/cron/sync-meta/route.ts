import { NextResponse } from "next/server";
import { syncAllClientsMetaSpend } from "@/lib/meta-sync";
import { guardCronRequest } from "@/lib/cron-auth";

// Achado real: sem este cron, `daily_spend` de qualquer cliente SEM
// integração Stract ativa (`import_sources.enabled`) só atualizava quando
// alguém entrava na página do cliente e clicava manualmente em "Atualizar
// dados do Meta" — sem rotina nenhuma disso acontecer todo dia, o investido
// exibido divergia cada vez mais do gasto real no Meta Ads Manager
// (auditoria "todas as contas com métricas erradas"). Cron ligado em
// `vercel.json`:
//
// { "crons": [{ "path": "/api/cron/sync-meta", "schedule": "0 10 * * *" }] }
//
// Vercel Cron sempre interpreta o schedule em UTC. `0 10 * * *` = 10h UTC =
// 7h no fuso da agência (America/Sao_Paulo, UTC-3 o ano todo) — uma hora
// antes do `sync-stract` (8h local), pra clientes só-Meta terem `daily_spend`
// fresco na mesma janela da manhã que os clientes Stract já tinham.
//
// Se o deploy falhar por limite de cron jobs/frequência do plano da Vercel,
// esse é o sinal de que o plano precisa de upgrade antes de continuar —
// nunca reduzir silenciosamente pra um schedule mais raro sem avisar.
export async function GET(request: Request) {
  const rejection = guardCronRequest(request, "sync-meta");
  if (rejection) return rejection;

  const results = await syncAllClientsMetaSpend();
  return NextResponse.json({ results });
}
