import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { resolveAnalyticsPeriod } from "@/lib/analytics";
import { todayDateString } from "@/lib/today";
import { buildPerformanceReportData } from "@/lib/performance-report/report-data";
import { buildPerformanceReportDocument } from "@/lib/performance-report/report-document";
import { renderPerformanceReportHtml } from "@/lib/performance-report/renderers/html-renderer";
import { renderReportPdf } from "@/lib/performance-report/renderers/pdf-renderer";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rate-limit";

/**
 * Gerador do PDF do Relatório de Performance — Route Handler (não Server
 * Action). Pipeline: dado → documento → HTML → PDF, cada camada só
 * conhecendo a de baixo — mesma Camada 1/2 (`report-data`/`report-document`)
 * usada pela página nativa (`/clients/[id]/relatorio`), nunca um segundo
 * cálculo de métricas.
 *
 * Etapa 2A (Auditoria de Segurança — correções prioritárias): esta rota não
 * está sob o `proxy.ts` (que só cobre páginas, nunca `/api/**` — decisão
 * documentada em `src/proxy.ts`), então até aqui ela dependia inteiramente
 * da RLS de `clients` pra negar acesso sem sessão — funcionava (RLS nega
 * `auth.uid()` nulo corretamente), mas sem nenhuma camada própria: uma
 * mudança futura na RLS de `clients` (inclusive pra viabilizar um link
 * externo do relatório) poderia abrir esta rota sem que o diff daquela
 * mudança parecesse tocá-la. `getCurrentProfile()` (mesmo helper canônico
 * de toda página/Server Action da MITZA, `lib/auth.ts`) adiciona a camada
 * que faltava — defesa em profundidade, nunca substitui a RLS abaixo:
 *   - sem sessão → 401, ANTES de qualquer consulta a `clients` ou início do
 *     Chromium (nunca gasta o custo de renderização sem usuário nenhum);
 *   - sessão válida mas sem acesso a este `clientId` → 404 "Cliente não
 *     encontrado", exatamente como já acontecia (mesmo texto/status de
 *     sempre, resolvido pela RLS de `clients` — is_admin()/is_client_manager()
 *     continuam sendo a autoridade sobre QUAL cliente cada gestor acessa,
 *     esta rota nunca reimplementa essa regra);
 *   - sessão válida com acesso → relatório normal, sem mudança nenhuma.
 * Nunca usa `createAdminClient()`/service role aqui — o client continua
 * sendo o cookie-bound de sempre, RLS continua valendo por baixo.
 *
 * Etapa "Relatório Nativo": esta rota deixou de servir HTML pra visualização
 * (`format=html`) — a experiência principal agora é a página nativa; aqui
 * sobra só a exportação em PDF, sempre binário com
 * `Content-Disposition: attachment`. `renderPerformanceReportHtml`
 * (`renderers/html-renderer.ts`) continua existindo como infraestrutura
 * interna — o PDF é gerado renderizando esse HTML em Chromium headless
 * (`renderers/pdf-renderer.ts`), nunca visível diretamente ao usuário. v1 é
 * Meta-only — nenhum parâmetro de plataforma aqui.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

/** Nunca cacheável por proxy/CDN/browser intermediário — cada resposta
 * (PDF de verdade ou erro) carrega dado específico da sessão/cliente que
 * fez a chamada. Aplicado a TODA resposta desta rota, não só ao 200 —
 * mesmo um 404 cacheado por engano poderia confundir "sem acesso agora"
 * com "nunca vai ter acesso" pra um cache compartilhado. */
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

/** Limite por (usuário, cliente): a Chromium sobe uma vez por PDF — 6 a
 * cada 60s cobre folgadamente alguém revisando/baixando o mesmo relatório
 * (trocar período, gerar de novo) sem abrir espaço pra um loop de abuso. */
const PER_USER_CLIENT_LIMIT = 6;
const PER_USER_CLIENT_WINDOW_MS = 60_000;
/** Limite mais amplo por usuário (todos os clientes somados) — cobre um
 * gestor/admin revisando vários relatórios em sequência (fim de mês, por
 * exemplo) sem deixar uma única identidade gerar Chromium sem limite. */
const PER_USER_LIMIT = 30;
const PER_USER_WINDOW_MS = 5 * 60_000;

export function buildPerformanceReportFileName(clientName: string, period: { start: string; end: string }): string {
  const safeName = clientName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `relatorio-performance-${safeName || "cliente"}-${period.start}-${period.end}.pdf`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Não autenticado." }, { status: 401, headers: NO_STORE_HEADERS });

  const { id } = await params;

  // Identidade do rate limit é sempre o usuário AUTENTICADO (profile.id,
  // já validado por getCurrentProfile() acima) combinado com o cliente —
  // nunca o `id` da URL sozinho, que qualquer um pode trocar (a checagem de
  // acesso de verdade continua sendo a RLS de `clients`, abaixo; o rate
  // limit é só defesa contra volume, não autorização).
  const perClient = checkRateLimit({
    bucket: "performance-report:user-client",
    key: `${profile.id}:${id}`,
    limit: PER_USER_CLIENT_LIMIT,
    windowMs: PER_USER_CLIENT_WINDOW_MS,
  });
  if (!perClient.allowed) {
    const res = rateLimitedResponse(perClient);
    for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.headers.set(k, v);
    return res;
  }

  const perUser = checkRateLimit({
    bucket: "performance-report:user",
    key: profile.id,
    limit: PER_USER_LIMIT,
    windowMs: PER_USER_WINDOW_MS,
  });
  if (!perUser.allowed) {
    const res = rateLimitedResponse(perUser);
    for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.headers.set(k, v);
    return res;
  }

  const supabase = await createSupabaseClient();

  const { data: client } = await supabase.from("clients").select("id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!client) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404, headers: NO_STORE_HEADERS });

  const url = new URL(request.url);
  const period = resolveAnalyticsPeriod(url.searchParams.get("analyticsPreset") ?? undefined, todayDateString(), {
    start: url.searchParams.get("analyticsStart") ?? undefined,
    end: url.searchParams.get("analyticsEnd") ?? undefined,
  });

  try {
    const data = await buildPerformanceReportData(supabase, id, period);
    const document = buildPerformanceReportDocument(data);
    const html = renderPerformanceReportHtml(document);
    const pdf = await renderReportPdf(html, null);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${buildPerformanceReportFileName(data.client.name, period)}"`,
        ...NO_STORE_HEADERS,
      },
    });
  } catch (err) {
    console.error("[performance-report]", err);
    return NextResponse.json({ error: "Não foi possível gerar o relatório." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
