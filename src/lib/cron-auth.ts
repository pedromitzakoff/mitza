import { timingSafeEqual } from "node:crypto";

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
