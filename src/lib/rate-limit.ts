/**
 * Etapa 2B (Hardening antes do link externo) — rate limiting.
 *
 * Auditoria antes de escolher arquitetura: o deploy real é Vercel
 * (`vercel.json`, region `gru1`), serverless — não existe Redis, Upstash
 * nem Vercel KV configurado (nenhuma env var, nenhuma dependência, nenhuma
 * referência no projeto), e nenhuma lib de rate limiting está instalada.
 *
 * Um contador em memória (`Map` neste módulo) NÃO é um rate limit
 * distribuído de verdade em serverless: cada instância da função pode ter
 * sua própria memória, e sob carga a Vercel sobe múltiplas instâncias
 * concorrentes — um atacante distribuído entre instâncias pode ultrapassar
 * o limite nominal. Isto é uma limitação real, não escondida: este helper é
 * deliberadamente um "stopgap" seguro de implementar agora (falha de forma
 * previsível, nunca quebra a aplicação, nunca inventa infraestrutura nova
 * sem decisão do time), não a solução definitiva.
 *
 * ANTES do link externo (`/r/[token]`) — que expõe a mesma rota de PDF pra
 * quem não tem sessão, aumentando MUITO a superfície de abuso possível —
 * este limite em memória precisa ser substituído por um rate limit
 * distribuído de verdade: Upstash Redis (`@upstash/ratelimit` +
 * `@upstash/redis`, ambos com free tier compatível com Vercel serverless) ou
 * Vercel KV. Isso é uma decisão de infraestrutura (criar a conta/o recurso),
 * não uma mudança de código — por isso não foi feita nesta rodada.
 *
 * Janela deslizante simples (contagem de timestamps dentro da janela) — sem
 * dependência nova, sem `setInterval`/timer de fundo (nunca mantém a função
 * serverless "viva" à toa): a limpeza de entradas expiradas acontece de
 * forma preguiçosa, dentro da própria chamada de `checkRateLimit`.
 */

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

// Evita crescimento ilimitado do Map numa instância "quente" de longa
// duração (função serverless reaproveitada entre invocações) — varre e
// descarta buckets totalmente expirados a cada N chamadas, nunca a cada
// chamada (custo desprezível, não é um timer de fundo).
let callsSinceSweep = 0;
const SWEEP_EVERY_N_CALLS = 200;

function sweepExpired(now: number, maxWindowMs: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.timestamps.length === 0 || now - bucket.timestamps[bucket.timestamps.length - 1] > maxWindowMs) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Segundos até o próximo request ter alguma chance de passar — só
   * significativo quando `allowed` é `false`. */
  retryAfterSeconds: number;
}

/**
 * Janela deslizante: `key` pode combinar rota + identidade (usuário
 * autenticado, cliente, ou ambos) — nunca só um `clientId` cru vindo de
 * URL como identidade confiável (isso é decisão de quem chama, ver os
 * comentários em cada rota). `bucket` separa namespaces lógicos (ex.:
 * "performance-report:user", "performance-report:user-client",
 * "cron:sync-meta") — a mesma `key` em `bucket`s diferentes nunca
 * compartilha contador.
 */
export function checkRateLimit(input: { bucket: string; key: string; limit: number; windowMs: number; now?: number }): RateLimitResult {
  const { bucket, key, limit, windowMs, now = Date.now() } = input;

  callsSinceSweep++;
  if (callsSinceSweep >= SWEEP_EVERY_N_CALLS) {
    callsSinceSweep = 0;
    sweepExpired(now, windowMs);
  }

  const mapKey = `${bucket}:${key}`;
  const existing = buckets.get(mapKey) ?? { timestamps: [] };
  const windowStart = now - windowMs;
  const withinWindow = existing.timestamps.filter((t) => t > windowStart);

  if (withinWindow.length >= limit) {
    const oldest = withinWindow[0];
    const retryAfterMs = oldest + windowMs - now;
    buckets.set(mapKey, { timestamps: withinWindow });
    return { allowed: false, limit, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  withinWindow.push(now);
  buckets.set(mapKey, { timestamps: withinWindow });
  return { allowed: true, limit, remaining: limit - withinWindow.length, retryAfterSeconds: 0 };
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

/** Só pra testes — nunca chamado pela aplicação, evita que o estado de um
 * teste vaze pro próximo. */
export function __resetRateLimitStateForTests() {
  buckets.clear();
  callsSinceSweep = 0;
}
