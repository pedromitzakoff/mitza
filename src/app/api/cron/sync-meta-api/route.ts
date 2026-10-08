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
 * minutos, UTC). Achado real em produção (2026-10-08): o plano Vercel deste
 * projeto era Hobby quando essa entrada foi adicionada pela primeira vez —
 * Hobby só dispara Cron Jobs nativos 1x/dia, e declarar um schedule
 * sub-diário travava TODO o pipeline de deploy (nenhum build novo era
 * sequer tentado). A entrada só volta a funcionar de verdade depois do
 * projeto estar no plano Pro (ou superior) — se o deploy voltar a travar
 * sem nenhum build novo aparecendo, confira o plano antes de mexer em
 * qualquer outra coisa.
 */
export const runtime = "nodejs";
// MITZA ONE — rollout pra 23 clientes (2026-10-08): busca sequencial, uma
// conta de cada vez (de propósito, pra não estourar limite de taxa da Meta)
// — 60s não é suficiente com esse volume; contas no fim da fila corriam o
// risco de nunca serem sincronizadas em nenhuma execução antes do corte.
export const maxDuration = 300;

export async function GET(request: Request) {
  const rejection = await guardCronRequest(request, "sync-meta-api");
  if (rejection) return rejection;

  const results = await syncAllMetaApiAccounts();
  return NextResponse.json({ results });
}
