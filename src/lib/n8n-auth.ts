import { timingSafeEqual } from "node:crypto";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Etapa "Gestão de Funis Estratégicos por Cliente" — guarda de autenticação
 * do endpoint de ingestão n8n (`/api/n8n/meta-insights`), mesmo padrão de
 * `lib/cron-auth.ts` (fail-closed, comparação em tempo constante, rate
 * limit), só que pro segredo próprio deste canal (`N8N_INGEST_SECRET`) —
 * nunca reaproveita `CRON_SECRET` (canais diferentes, rotação independente).
 *
 * Fail-closed: sem `N8N_INGEST_SECRET` configurado, sem `Authorization`, ou
 * com `Bearer` incorreto, a resposta é sempre negar. Não expõe em log/
 * resposta o valor esperado, o token recebido, nem o tamanho de nenhum dos
 * dois — só um `boolean`.
 */
export function isAuthorizedN8nRequest(request: Request): boolean {
  const secret = process.env.N8N_INGEST_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authHeader);
  if (expected.length !== received.length) return false;

  return timingSafeEqual(expected, received);
}

/** Mais generoso que o cron (5/min) porque um pipeline n8n legítimo pode
 * rodar em lotes menores e mais frequentes (por conta, por granularidade,
 * durante um backfill) — ainda conservador o bastante pra travar um
 * replay/loop de quem tiver o segredo vazado. */
const N8N_RATE_LIMIT = 30;
const N8N_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Guarda única do endpoint de ingestão n8n — auth SEMPRE primeiro, rate
 * limit depois (mesmo raciocínio de `guardCronRequest`: só chamada já
 * autenticada consome cota, nunca tráfego aleatório sem o segredo).
 *
 * Retorna a `Response` de rejeição pronta (401, 429 ou 503) quando a
 * chamada deve ser barrada, ou `null` quando pode prosseguir.
 */
export async function guardN8nIngestRequest(request: Request): Promise<Response | null> {
  if (!isAuthorizedN8nRequest(request)) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return enforceRateLimit({
    bucket: "n8n:meta-insights",
    key: "global",
    limit: N8N_RATE_LIMIT,
    windowMs: N8N_RATE_LIMIT_WINDOW_MS,
  });
}
