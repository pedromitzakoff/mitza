import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { fetchMetaApiAccountBalance } from "@/lib/meta-api-fetch";

/**
 * Diagnóstico pontual (reconfirmado após META_API_ACCESS_TOKEN ser
 * habilitado também pro ambiente Preview na Vercel — a variável só vale
 * pros deploys criados DEPOIS dessa mudança, nunca retroativamente) —
 * `fetchAccountBalanceSnapshot` (Cockpit) some em
 * silêncio em QUALQUER estado indisponível (`not_configured`/
 * `token_missing`/`timeout`/`fetch_error`, ver `CockpitAdAccountBalance`:
 * "qualquer estado indisponível... some por completo", decisão deliberada
 * pra não virar ruído pros clientes sem conta configurada). Isso é certo pro
 * usuário final, mas esconde a causa real quando uma conta QUE DEVERIA
 * mostrar saldo não mostra — este endpoint chama a MESMA função
 * (`fetchMetaApiAccountBalance`, `lib/meta-api-fetch.ts`) só que devolve o
 * erro cru da Graph API em vez de engolir.
 *
 * O nó de saldo (`/act_.../?fields=balance,is_prepay_account,currency`) usa
 * permissão distinta da leitura de insights (`fetchMetaApiInsightsForAccount`,
 * já diagnosticada por `/api/admin/meta-actions-debug`) — uma conta pode ter
 * investimento/leads sincronizando normalmente e MESMO ASSIM falhar aqui.
 *
 * Uso: GET /api/admin/meta-balance-debug?accountId=act_...
 * Admin-only (sessão), nunca gravação — só leitura da Graph API.
 */
export async function GET(request: Request) {
  await requireAdmin();

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");

  if (!accountId) {
    return NextResponse.json({ error: "Parâmetro obrigatório: accountId (ex.: act_123456789)." }, { status: 400 });
  }

  try {
    const row = await fetchMetaApiAccountBalance(accountId);
    return NextResponse.json({ accountId, row });
  } catch (err) {
    return NextResponse.json({ accountId, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
