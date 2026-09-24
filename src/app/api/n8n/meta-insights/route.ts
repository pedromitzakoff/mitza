import { NextResponse } from "next/server";
import { guardN8nIngestRequest } from "@/lib/n8n-auth";
import { validateMetaApiIngestPayload } from "@/lib/meta-api-ingest";
import { ingestMetaApiPayload } from "@/lib/meta-api-ingest-run";

/**
 * Endpoint de ingestão do pipeline n8n + API oficial da Meta (Etapa "Gestão
 * de Funis Estratégicos por Cliente" — decisão do usuário: extração via
 * n8n/mentor, MITZA continua Supabase + modelo interno). Contrato completo
 * de campos/autenticação/formato em `docs/N8N_META_INGESTION_GUIDE.md`.
 *
 * Responsabilidade estritamente dividida: o n8n busca dado bruto na Meta
 * Insights API e faz UM POST aqui — nunca escreve em nenhuma tabela do
 * Supabase diretamente, nunca decide objetivo/funil/agregação (isso é
 * sempre `lib/meta-api-ingest-run.ts`, que reaproveita as MESMAS funções de
 * agregação/upsert que o Stract já usa, `lib/import-sources.ts` — nenhuma
 * regra de negócio de relatório duplicada).
 *
 * Autenticação: `Authorization: Bearer <N8N_INGEST_SECRET>`, fail-closed
 * (`lib/n8n-auth.ts`, mesmo padrão de `lib/cron-auth.ts`). Conta precisa já
 * estar registrada em `import_sources` (`provider = 'meta_api'`,
 * `external_account_id = accountId`, `enabled = true`) — nunca cria uma
 * fonte nova silenciosamente a partir do payload; registro é sempre uma
 * ação explícita do admin (mesma disciplina de `import_sources` do Stract).
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: Request) {
  const rejection = await guardN8nIngestRequest(request);
  if (rejection) {
    for (const [key, value] of Object.entries(NO_STORE_HEADERS)) rejection.headers.set(key, value);
    return rejection;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Corpo da requisição precisa ser JSON válido." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const validation = validateMetaApiIngestPayload(body);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: "Payload inválido.", details: validation.errors }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const outcome = await ingestMetaApiPayload(validation.payload);

    if (outcome.kind === "unregistered_account") {
      return NextResponse.json(
        {
          ok: false,
          error: `Conta "${validation.payload.accountId}" não está registrada como fonte meta_api pra nenhum cliente — cadastre em import_sources antes de enviar dados (nunca criada automaticamente a partir do payload).`,
        },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    if (outcome.kind === "disabled_source") {
      return NextResponse.json(
        { ok: false, error: `Fonte registrada pra "${validation.payload.accountId}" está desativada (enabled = false) — reative antes de sincronizar.` },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    if (outcome.kind === "concurrent_run") {
      return NextResponse.json(
        { ok: false, error: "Já existe uma sincronização em andamento pra esta conta — tente novamente em instantes." },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    const { result } = outcome;
    return NextResponse.json(
      {
        ok: true,
        runId: result.runId,
        status: result.status,
        rowsRead: result.rowsRead,
        spendRowsWritten: result.spendRowsWritten,
        performanceRowsWritten: result.performanceRowsWritten,
        campaignRowsWritten: result.campaignRowsWritten,
        adSetRowsWritten: result.adSetRowsWritten,
        creativeRowsWritten: result.creativeRowsWritten,
        placementRowsWritten: result.placementRowsWritten,
        note: result.errorMessage,
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    console.error("[n8n/meta-insights]", err);
    return NextResponse.json({ ok: false, error: "Falha ao processar a sincronização." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
