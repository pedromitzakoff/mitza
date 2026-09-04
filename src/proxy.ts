import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Etapa "Link Externo V1": `/r/[token]` é uma página (Server Component),
 * não uma Route Handler — não dá pra retornar um 429 de dentro do próprio
 * `page.tsx` (a única forma nativa do App Router de customizar o status é
 * `notFound()`/erro). O `proxy` é o único lugar antes da renderização que
 * pode devolver uma `Response` arbitrária, e nesta versão do Next.js ele
 * SEMPRE roda em runtime Node.js (nunca Edge — `node_modules/next/dist/docs/
 * .../version-16.md`), então reaproveitar `enforceRateLimit` (Upstash,
 * mesma abstração de `/api/clients/[id]/performance-report` e das rotas de
 * cron) aqui é seguro, sem nenhuma segunda implementação de rate limit.
 *
 * Identidade = IP (nunca usuário — não há sessão nesta superfície):
 * `x-forwarded-for` é o header padrão que a Vercel envia com o IP real do
 * visitante; limite generoso o bastante pro cliente trocar de período
 * repetidamente, conservador o bastante pra travar scraping/tentativa de
 * adivinhar tokens por força bruta (que já é inviável pela entropia do
 * token — isto é só uma camada extra).
 */
const PUBLIC_REPORT_PREFIX = "/r/";
const PUBLIC_REPORT_RATE_LIMIT = 60;
const PUBLIC_REPORT_RATE_LIMIT_WINDOW_MS = 5 * 60_000;

/** Estrutural (não `NextRequest` inteiro) só pra `scripts/test-report-share-links.ts`
 * conseguir chamar `checkPublicReportRateLimit` com um objeto simples, sem
 * precisar construir um `NextRequest` real. `NextRequest` satisfaz esta
 * interface normalmente, então a produção não muda nada. */
interface RateLimitableRequest {
  nextUrl: { pathname: string };
  headers: Headers;
}

function resolveClientIp(request: RateLimitableRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(",");
    if (firstIp?.trim()) return firstIp.trim();
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** Extraído do `proxy` principal só pra ser testável isoladamente — nunca
 * chama `updateSession` (que precisa de uma sessão Supabase real), então o
 * teste de rate limit nunca toca rede/Supabase, só o backend de rate limit
 * injetado (`__setRateLimitBackendForTests`). */
export async function checkPublicReportRateLimit(request: RateLimitableRequest): Promise<Response | null> {
  if (!request.nextUrl.pathname.startsWith(PUBLIC_REPORT_PREFIX)) return null;

  return enforceRateLimit({
    bucket: "public-report",
    key: resolveClientIp(request),
    limit: PUBLIC_REPORT_RATE_LIMIT,
    windowMs: PUBLIC_REPORT_RATE_LIMIT_WINDOW_MS,
  });
}

export async function proxy(request: NextRequest) {
  const rejection = await checkPublicReportRateLimit(request);
  if (rejection) return rejection;

  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Roda em todas as rotas, exceto assets estáticos, a própria imagem
     * otimizada do Next.js e rotas de API (`/api/*`) — essas nunca são
     * chamadas por um navegador com sessão de gestor logado (são
     * server-to-server: cron da Vercel, integrações, chamadas
     * administrativas diretas) e já têm sua própria proteção
     * (`CRON_SECRET`, ver `/api/cron/*` e `/api/admin/*`). Bug descoberto na
     * validação da integração Stract: sem esta exclusão, toda chamada sem
     * cookie de sessão a `/api/*` era redirecionada pro `/login` antes de
     * chegar no handler — isso já afetava silenciosamente `/api/cron/sync-meta`
     * também, só nunca detectado porque aquele cron nunca chegou a ser
     * ativado de verdade em produção.
     */
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
