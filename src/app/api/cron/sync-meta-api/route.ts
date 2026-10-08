import { NextResponse } from "next/server";
import { syncAllMetaApiAccounts } from "@/lib/meta-api-direct-sync";
import { guardCronRequest } from "@/lib/cron-auth";

/**
 * MITZA ONE — Busca direta na Meta (pedido do usuário: app próprio no Meta
 * Developers, dados atualizados a cada 5 minutos). Substitui o papel que
 * `docs/N8N_META_INGESTION_GUIDE.md` descreve pro n8n — a MESMA gravação
 * (`ingestMetaApiPayload`, `lib/meta-api-ingest-run.ts`) continua sendo a
 * única implementação; só QUEM busca o dado bruto na Meta muda (o próprio
 * servidor da MITZA, via `lib/meta-api-fetch.ts`, em vez de um workflow
 * externo fazendo um POST). O caminho n8n continua existindo e funcional —
 * nenhum cliente que já usa esse caminho é afetado; registrar uma conta
 * aqui é o MESMO passo único de sempre (`import_sources`/`metric_mappings`,
 * seção 5 do guia n8n).
 *
 * Cron em `vercel.json` (path "/api/cron/sync-meta-api", schedule a cada 5
 * minutos, UTC) — exige plano Vercel com suporte a cron sub-diário (Hobby só
 * roda 1x/dia); se o deploy rejeitar esse schedule, é o sinal de que o
 * plano precisa de upgrade antes de continuar, nunca reduzir silenciosamente
 * pra um schedule mais raro sem avisar (mesma régua já documentada em
 * `sync-meta/route.ts`).
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const rejection = await guardCronRequest(request, "sync-meta-api");
  if (rejection) return rejection;

  const results = await syncAllMetaApiAccounts();
  return NextResponse.json({ results });
}
