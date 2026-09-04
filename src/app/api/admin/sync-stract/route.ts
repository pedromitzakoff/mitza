import { NextResponse } from "next/server";
import { runImportForSource, type ImportDateRange } from "@/lib/stract-sync";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

/**
 * Gatilho manual do Import Service (integração Stract — arquitetura
 * aprovada, ver DECISIONS.md, ponto 11: "reprocessamento manual"). Reprocessa
 * UMA `import_source` — todo o histórico configurado (omitindo `since`/
 * `until`) ou um intervalo específico. Mesma função (`runImportForSource`)
 * usada pelo cron — nenhuma lógica duplicada, só varia o argumento.
 *
 * Sem interface visual nesta primeira versão (rollout aprovado: só a conta
 * de teste, validação manual antes de qualquer automação ampla) — chamada
 * via curl/Postman pelo admin. Mesma trava de `CRON_SECRET` da rota de cron,
 * reaproveitada por ser o mesmo limite de confiança (rotina administrativa,
 * nunca chamada pelo browser do gestor).
 *
 * Body: { "importSourceId": "uuid", "since"?: "YYYY-MM-DD", "until"?: "YYYY-MM-DD" }
 */
export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { importSourceId, since, until } = body as { importSourceId?: string; since?: string; until?: string };

  if (!importSourceId) {
    return NextResponse.json({ error: "importSourceId é obrigatório" }, { status: 400 });
  }

  const dateRange: ImportDateRange | undefined = since && until ? { since, until } : undefined;

  try {
    const result = await runImportForSource(importSourceId, dateRange);
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
