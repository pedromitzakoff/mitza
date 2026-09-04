import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Etapa 2C (Rate Limit Distribuído em Produção) — substitui o contador em
 * memória da Etapa 2B (que não compartilha estado entre instâncias
 * serverless da Vercel) por Upstash Redis + `@upstash/ratelimit`: HTTP REST
 * API (sem TCP persistente, compatível com qualquer runtime serverless,
 * inclusive Node.js — nunca exige Edge Runtime), credenciais só server-side
 * (`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, nunca
 * `NEXT_PUBLIC_*`), sem SDK nenhum enviado ao browser.
 *
 * FAIL-CLOSED EM PRODUÇÃO, EXPLÍCITO (decisão consciente, não acidente):
 * se as credenciais do Redis estiverem ausentes, ou a chamada ao Upstash
 * falhar (timeout, erro de rede, serviço fora do ar), em produção
 * (`NODE_ENV === "production"` — cobre build de produção da Vercel,
 * Preview E Production, e `next build && next start` local; só `next dev`
 * é "não produção") a requisição é NEGADA (`RateLimitUnavailableError` →
 * 503), nunca "deixa passar sem limite" — a alternativa (fail-open)
 * silenciaria exatamente a falha de configuração que mais importa detectar
 * antes do link externo existir. Em desenvolvimento/teste, cai num
 * fallback em memória isolado e claramente rotulado
 * (`InMemorySlidingWindowRateLimitBackend`) — só por ergonomia (`next dev`
 * sem precisar de uma conta Upstash de verdade) — NUNCA usado em produção.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Segundos até o próximo request ter alguma chance de passar — só
   * significativo quando `allowed` é `false`. */
  retryAfterSeconds: number;
}

export interface RateLimitInput {
  /** Namespace lógico — ex.: "performance-report:user-client",
   * "cron:sync-meta". A mesma `key` em `bucket`s diferentes nunca
   * compartilha contador. */
  bucket: string;
  /** Identidade dentro do bucket — nunca um `clientId` cru de URL sozinho
   * como identidade confiável (decisão de quem chama, ver cada rota). */
  key: string;
  limit: number;
  windowMs: number;
  /** Só para testes — `InMemorySlidingWindowRateLimitBackend` usa isto no
   * lugar de `Date.now()` quando presente (determinismo, sem `sleep`
   * real). O backend de produção (Upstash) ignora este campo — o relógio
   * de verdade é sempre o do Redis. Nunca definido em código de aplicação. */
  now?: number;
}

/** Abstração de backend — única forma de as rotas/o helper de cron falarem
 * com "o rate limiter", nunca conhecem Upstash nem o fallback em memória
 * diretamente. Permite injetar um backend determinístico nos testes (ver
 * `__setRateLimitBackendForTests`) sem tocar rede/Upstash real. */
export interface RateLimitBackend {
  limit(input: RateLimitInput): Promise<RateLimitResult>;
}

export class RateLimitUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitUnavailableError";
  }
}

function windowMsToDuration(windowMs: number): `${number} s` {
  if (windowMs <= 0 || windowMs % 1000 !== 0) {
    throw new Error(`windowMs precisa ser um múltiplo positivo de 1000 (recebido ${windowMs})`);
  }
  return `${windowMs / 1000} s`;
}

/**
 * Backend real de produção — HTTP REST, sem conexão persistente. Um
 * `Ratelimit` (biblioteca) é criado por combinação distinta de
 * (limit, windowMs) e cacheado (a lib crava o algoritmo na construção); o
 * `bucket`/`key` da MITZA viram o `identifier` único passado pra
 * `ratelimit.limit(...)`, então buckets diferentes nunca compartilham
 * contador mesmo reaproveitando a mesma instância de `Ratelimit`.
 */
class UpstashRateLimitBackend implements RateLimitBackend {
  private readonly redis: Redis;
  private readonly limiters = new Map<string, Ratelimit>();

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }

  private getLimiter(limit: number, windowMs: number): Ratelimit {
    const cacheKey = `${limit}:${windowMs}`;
    let limiter = this.limiters.get(cacheKey);
    if (!limiter) {
      limiter = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(limit, windowMsToDuration(windowMs)),
        prefix: "mitza-rl",
        analytics: false,
      });
      this.limiters.set(cacheKey, limiter);
    }
    return limiter;
  }

  async limit({ bucket, key, limit, windowMs }: RateLimitInput): Promise<RateLimitResult> {
    const identifier = `${bucket}:${key}`;
    let response;
    try {
      response = await this.getLimiter(limit, windowMs).limit(identifier);
    } catch (err) {
      // Nunca deixa um erro de rede/Upstash virar "sem querer, passou" —
      // vira RateLimitUnavailableError, tratado por checkRateLimit()
      // (fail-closed em produção). O erro completo fica só no log do
      // servidor, nunca em nenhuma resposta HTTP.
      console.error("[rate-limit] falha ao consultar o Upstash", err);
      throw new RateLimitUnavailableError("Falha ao consultar o serviço de rate limit.");
    }

    return {
      allowed: response.success,
      limit: response.limit,
      remaining: response.remaining,
      // `reset` do Upstash é timestamp Unix em milissegundos.
      retryAfterSeconds: response.success ? 0 : Math.max(1, Math.ceil((response.reset - Date.now()) / 1000)),
    };
  }
}

/**
 * Fallback isolado de desenvolvimento/teste — janela deslizante em memória
 * (mesma lógica, comprovada, da Etapa 2B). NUNCA usado em produção
 * (`resolveBackend()` abaixo só cai aqui fora de produção). Aceita `now`
 * explícito por chamada — é isso que torna os testes determinísticos, sem
 * `sleep` real; em uso de desenvolvimento de verdade (`next dev`), quem
 * chama nunca passa `now`, e o relógio real (`Date.now()`) é usado.
 */
export class InMemorySlidingWindowRateLimitBackend implements RateLimitBackend {
  private readonly buckets = new Map<string, number[]>();

  async limit(input: RateLimitInput): Promise<RateLimitResult> {
    const { bucket, key, limit, windowMs, now = Date.now() } = input;
    const mapKey = `${bucket}:${key}`;
    const windowStart = now - windowMs;
    const withinWindow = (this.buckets.get(mapKey) ?? []).filter((t) => t > windowStart);

    if (withinWindow.length >= limit) {
      const retryAfterMs = withinWindow[0] + windowMs - now;
      this.buckets.set(mapKey, withinWindow);
      return { allowed: false, limit, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }

    withinWindow.push(now);
    this.buckets.set(mapKey, withinWindow);
    return { allowed: true, limit, remaining: limit - withinWindow.length, retryAfterSeconds: 0 };
  }
}

let cachedUpstashBackend: UpstashRateLimitBackend | null = null;
let cachedDevBackend: InMemorySlidingWindowRateLimitBackend | null = null;
let testBackendOverride: RateLimitBackend | null = null;

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

function resolveBackend(): RateLimitBackend {
  if (testBackendOverride) return testBackendOverride;

  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (url && token) {
    if (!cachedUpstashBackend) cachedUpstashBackend = new UpstashRateLimitBackend(url, token);
    return cachedUpstashBackend;
  }

  if (isProductionRuntime()) {
    throw new RateLimitUnavailableError(
      "UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN ausentes em produção — rate limit fail-closed.",
    );
  }

  // Fora de produção (next dev, ou scripts/test-*.ts sem backend injetado):
  // fallback isolado, nunca usado em produção.
  if (!cachedDevBackend) cachedDevBackend = new InMemorySlidingWindowRateLimitBackend();
  return cachedDevBackend;
}

/** Único ponto de entrada pra checar rate limit — nunca lança em caso de
 * limite excedido (retorna `allowed: false`), mas PODE lançar
 * `RateLimitUnavailableError` quando o backend não está disponível
 * (produção sem Redis configurado, ou o Upstash falhou) — quem chama
 * decide o que fazer (ver `enforceRateLimit`, abaixo, usado por toda
 * rota). */
export async function checkRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  return resolveBackend().limit(input);
}

/** Resposta 429 padrão — nunca expõe o `key`/identidade usada internamente,
 * só o essencial (`Retry-After`, mensagem genérica). */
export function rateLimitedResponse(result: RateLimitResult): Response {
  return new Response(JSON.stringify({ error: "Muitas requisições. Tente novamente em instantes." }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(result.retryAfterSeconds),
    },
  });
}

/** Resposta quando o PRÓPRIO rate limiter está indisponível (nunca
 * confundida com 429 — isso esconderia um problema de configuração atrás
 * de uma mensagem que parece tráfego normal sendo limitado). Nunca expõe
 * detalhe de infraestrutura/Redis na resposta — só no log do servidor
 * (já registrado dentro do backend, ver `UpstashRateLimitBackend.limit`). */
export function rateLimitUnavailableResponse(): Response {
  return new Response(JSON.stringify({ error: "Serviço temporariamente indisponível. Tente novamente em instantes." }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Ponto único que toda rota protegida chama — combina `checkRateLimit` +
 * o tratamento de erro (503) + a resposta de limite excedido (429) numa
 * função só, pra nenhuma rota reimplementar esse `try/catch`. Retorna a
 * `Response` de rejeição pronta, ou `null` quando pode prosseguir.
 */
export async function enforceRateLimit(input: RateLimitInput): Promise<Response | null> {
  let result: RateLimitResult;
  try {
    result = await checkRateLimit(input);
  } catch (err) {
    if (err instanceof RateLimitUnavailableError) return rateLimitUnavailableResponse();
    throw err;
  }
  return result.allowed ? null : rateLimitedResponse(result);
}

/**
 * Só pra testes — instala um backend determinístico (normalmente
 * `InMemorySlidingWindowRateLimitBackend`, com `now` explícito por
 * chamada) no lugar da resolução real (Upstash/fallback de dev). Chamar
 * com `null` restaura a resolução normal. Nunca chamado pela aplicação.
 */
export function __setRateLimitBackendForTests(backend: RateLimitBackend | null) {
  testBackendOverride = backend;
}
