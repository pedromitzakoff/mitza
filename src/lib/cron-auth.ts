import { timingSafeEqual } from "node:crypto";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Etapa 2A (Auditoria de Segurança — correções prioritárias): única
 * implementação da checagem de `CRON_SECRET` — as 5 rotas de cron/admin
 * (`/api/cron/*`, `/api/admin/sync-stract`) chamam esta função em vez de
 * cada uma reimplementar `if (cronSecret) { ... }`, que degradava pra
 * "aberto" quando a env var não existia (fail-open — a Vercel Cron sempre
 * envia o header quando a variável está configurada no projeto, então isso
 * só protegia quando alguém lembrava de configurar; nada no código IMPEDIA
 * rodar sem ela).
 *
 * Fail-closed: sem `CRON_SECRET` configurado, sem `Authorization`, ou com
 * `Bearer` incorreto, a resposta é sempre negar — nunca "deixa passar
 * porque não tinha o que comparar". Comparação em tempo constante
 * (`timingSafeEqual`, nativo do Node, nenhuma dependência nova) — nunca
 * `===` direto num valor que veio de fora comparado com um secret.
 *
 * Não expõe em log/resposta: o valor esperado, o token recebido, nem o
 * tamanho de nenhum dos dois — o chamador só recebe um `boolean`.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authHeader);
  if (expected.length !== received.length) return false;

  return timingSafeEqual(expected, received);
}

/** Generoso o bastante pro uso legítimo (1x/dia via Vercel Cron + eventuais
 * disparos manuais durante debug) e conservador o bastante pra travar um
 * replay/loop de quem tiver o `CRON_SECRET` (vazado ou não). */
const CRON_RATE_LIMIT = 5;
const CRON_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Guarda única das 5 rotas de cron/admin — auth SEMPRE primeiro, rate limit
 * depois: se checássemos o limite antes da autenticação, uma enxurrada de
 * chamadas SEM o segredo (nunca autorizadas de qualquer forma) consumiria a
 * cota do bucket e poderia bloquear a chamada legítima da Vercel Cron
 * chegando logo em seguida — uma auto-negação de serviço. Como só chamadas
 * já autenticadas contam pro limite, o "abuso" que o rate limit trava aqui é
 * sempre de quem já tem (ou roubou) o `CRON_SECRET`, nunca tráfego aleatório
 * da internet (esse já é rejeitado de graça pelo 401, sem custo nenhum).
 *
 * `routeName` é só o rótulo do bucket (ex.: "sync-meta") — nunca aparece em
 * nenhuma resposta.
 *
 * Retorna a `Response` de rejeição pronta (401, 429 ou 503 — ver
 * `enforceRateLimit`) quando a chamada deve ser barrada, ou `null` quando
 * pode prosseguir. Async desde a Etapa 2C: o rate limit distribuído
 * (Upstash) é uma chamada de rede, nunca mais uma checagem síncrona em
 * memória.
 */
export async function guardCronRequest(request: Request, routeName: string): Promise<Response | null> {
  if (!isAuthorizedCronRequest(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return enforceRateLimit({
    bucket: `cron:${routeName}`,
    key: "global",
    limit: CRON_RATE_LIMIT,
    windowMs: CRON_RATE_LIMIT_WINDOW_MS,
  });
}
