import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { fetchMetaApiInsightsForAccount } from "@/lib/meta-api-fetch";

/**
 * Diagnóstico pontual — descobrir quais `action_type` uma conta da Meta
 * realmente devolve (e com que contagem cada um), sem precisar de acesso ao
 * Meta Developers/Graph API Explorer (achado real: o admin da MITZA não tem
 * esse acesso, só quem criou o app). Reaproveita INTEGRALMENTE
 * `fetchMetaApiInsightsForAccount` (mesma busca que o cron/sincronização
 * manual já fazem) — só soma `actions`/`actionValues` por tipo em vez de
 * interpretar via `metric_mappings`, pra enxergar o dado bruto antes de
 * qualquer decisão de "o que conta como resultado".
 *
 * Uso: GET /api/admin/meta-actions-debug?accountId=act_...&since=2026-10-07&until=2026-10-07
 * Admin-only (sessão), nunca gravação — só leitura da Graph API.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  await requireAdmin();

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const since = searchParams.get("since");
  const until = searchParams.get("until");

  if (!accountId || !since || !until) {
    return NextResponse.json({ error: "Parâmetros obrigatórios: accountId, since, until (YYYY-MM-DD)." }, { status: 400 });
  }

  try {
    const rows = await fetchMetaApiInsightsForAccount(accountId, since, until);

    const actionsTotals: Record<string, number> = {};
    const actionValuesTotals: Record<string, number> = {};
    let totalSpend = 0;

    for (const row of rows) {
      totalSpend += row.spend;
      for (const [actionType, value] of Object.entries(row.actions ?? {})) {
        actionsTotals[actionType] = (actionsTotals[actionType] ?? 0) + value;
      }
      for (const [actionType, value] of Object.entries(row.actionValues ?? {})) {
        actionValuesTotals[actionType] = (actionValuesTotals[actionType] ?? 0) + value;
      }
    }

    return NextResponse.json({
      accountId,
      since,
      until,
      rowCount: rows.length,
      totalSpend,
      actionsTotals,
      actionValuesTotals,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
