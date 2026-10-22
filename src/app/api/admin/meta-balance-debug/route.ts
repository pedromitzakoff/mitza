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
 * `raw=1`: achado real (Helping Hand, Outubro/2026) — o valor convertido
 * (`balance`, já ÷100 e só pra conta pré-paga) bateu muito abaixo do saldo
 * real visto no Gerenciador de Anúncios, numa proporção que não corresponde
 * a nenhum erro de unidade conhecido (não é x10/x100/x1000). A documentação
 * oficial da Graph API descreve `balance` como "Bill amount due" (valor A
 * FATURAR), não "saldo disponível pra gastar" — pode não ser o campo certo
 * pra contas com linha de crédito compartilhada no Business Manager. Este
 * modo busca o nó da conta DIRETO (sem passar por `mapMetaAccountBalanceResponse`),
 * incluindo `spend_cap`/`amount_spent`, pra comparar o valor bruto que a
 * Meta devolve antes de qualquer conversão.
 *
 * Uso: GET /api/admin/meta-balance-debug?accountId=act_...
 * Uso (bruto): GET /api/admin/meta-balance-debug?accountId=act_...&raw=1
 * Admin-only (sessão), nunca gravação — só leitura da Graph API.
 */
const META_GRAPH_API_VERSION = "v25.0";

export async function GET(request: Request) {
  await requireAdmin();

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const raw = searchParams.get("raw") === "1";

  if (!accountId) {
    return NextResponse.json({ error: "Parâmetro obrigatório: accountId (ex.: act_123456789)." }, { status: 400 });
  }

  if (raw) {
    const accessToken = process.env.META_API_ACCESS_TOKEN;
    if (!accessToken) return NextResponse.json({ accountId, error: "META_API_ACCESS_TOKEN não configurado" }, { status: 500 });

    const url = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${accountId}`);
    url.searchParams.set("fields", "balance,is_prepay_account,currency,spend_cap,amount_spent,funding_source_details");
    url.searchParams.set("access_token", accessToken);

    try {
      const response = await fetch(url.toString());
      const json = await response.json();
      return NextResponse.json({ accountId, httpStatus: response.status, raw: json });
    } catch (err) {
      return NextResponse.json({ accountId, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  try {
    const row = await fetchMetaApiAccountBalance(accountId);
    return NextResponse.json({ accountId, row });
  } catch (err) {
    return NextResponse.json({ accountId, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
