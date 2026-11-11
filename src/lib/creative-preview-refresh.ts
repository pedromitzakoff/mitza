import { after } from "next/server";
import type { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchMetaApiAdCreativePreviews } from "@/lib/meta-api-fetch";

type Supabase = Awaited<ReturnType<typeof createSupabaseClient>>;

/**
 * Etapa "Preview de criativos nos cards de Anúncios" — pedido explícito do
 * usuário, com 3 decisões de design tomadas em conversa antes de
 * implementar:
 *
 * 1. NUNCA baixar/guardar a imagem (preocupação explícita: "vai pesar o
 *    Supabase") — só o LINK que a Meta devolve é escrito em
 *    `ad_creative_daily_metrics.preview_image_url` (coluna que já existe,
 *    só nunca teve um mecanismo de preenchimento). O navegador busca a
 *    imagem direto do servidor da Meta.
 * 2. Busca sob demanda (nunca um cron automático) — só quando a tela de
 *    Anúncios/Campanhas é aberta e o cache está velho (>24h, decisão
 *    explícita: "os anúncios dificilmente mudam... 1x por dia é
 *    suficiente").
 * 3. NUNCA bloqueia a tela — `scheduleCreativePreviewRefreshIfStale` usa
 *    `after()` (Next.js): a página renderiza na hora com o que já estiver
 *    gravado, e a busca acontece DEPOIS da resposta já ter sido enviada,
 *    sem ninguém esperar.
 */
export const CREATIVE_PREVIEW_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;

/** Núcleo puro — decide se o cache está velho o bastante pra justificar
 * uma nova busca. `null` (cliente nunca buscado) é sempre "velho". */
export function isCreativePreviewRefreshStale(refreshedAt: string | null, now: Date, ttlMs: number = CREATIVE_PREVIEW_REFRESH_TTL_MS): boolean {
  if (!refreshedAt) return true;
  return now.getTime() - new Date(refreshedAt).getTime() > ttlMs;
}

/**
 * Busca os previews da conta inteira e grava em `ad_creative_daily_metrics`
 * — por NOME de criativo (identidade canônica de sempre, nunca `ad_id`),
 * atualizando TODAS as linhas diárias existentes daquele criativo de uma
 * vez (uma linha por nome, não por `ad_id`: vários `ad_id` podem
 * compartilhar o mesmo criativo ao longo do tempo, ver
 * `fetchMetaApiAdCreativePreviews`). Roda com o client ADMIN — pensada pra
 * ser chamada de dentro de `after()`, fora do ciclo de vida da requisição
 * original (cookies da sessão do usuário não são confiáveis nesse ponto).
 *
 * Nunca lança — qualquer falha (Graph API fora do ar, token ausente) só
 * fica no log do servidor; a tela já renderizou com o que tinha antes de
 * chamar isto, então uma falha aqui nunca derruba nada visível pro
 * usuário (mesma filosofia de "falha de rede nunca quebra a tela" já
 * usada em `fetchAccountPeriodReachSnapshot`/`fetchAccountBalanceSnapshot`).
 *
 * NÃO grava `creative_preview_refresh_log` aqui — quem chama
 * (`scheduleCreativePreviewRefreshIfStale`) já grava ANTES de chamar esta
 * função (ver o comentário lá: garante um intervalo mínimo entre
 * TENTATIVAS, não só entre sucessos).
 */
export async function refreshCreativePreviews(clientId: string, accountId: string): Promise<void> {
  const admin = createAdminClient();
  try {
    const rows = await fetchMetaApiAdCreativePreviews(accountId);

    // Um nome pode aparecer em vários `ad_id` — primeiro link não-nulo
    // encontrado vence (mesma convenção de "primeiro valor real resolve",
    // nunca um segundo critério de desempate inventado).
    const urlByName = new Map<string, string>();
    for (const row of rows) {
      if (row.thumbnailUrl && !urlByName.has(row.adName)) urlByName.set(row.adName, row.thumbnailUrl);
    }

    for (const [creativeName, thumbnailUrl] of urlByName) {
      const { error } = await admin
        .from("ad_creative_daily_metrics")
        .update({ preview_image_url: thumbnailUrl })
        .eq("client_id", clientId)
        .eq("creative_name", creativeName);
      if (error) console.error(`[refreshCreativePreviews] falha ao gravar preview de "${creativeName}" (cliente ${clientId}):`, error);
    }
  } catch (err) {
    console.error(`[refreshCreativePreviews] falha ao buscar previews na Meta (cliente ${clientId}, conta ${accountId}):`, err);
  }
}

/**
 * Verifica o log (leitura rápida, com o client normal da requisição) e,
 * se estiver velho, agenda a atualização de verdade pra DEPOIS da resposta
 * já ter sido enviada (`after()`) — a página nunca espera por isto.
 * `accountId` ausente (cliente sem conta Meta direta conectada) nunca
 * agenda nada.
 *
 * Tolerante a `creative_preview_refresh_log` ainda não existir (migração
 * `supabase/creative-preview-refresh-log.sql` aplicada manualmente, mesmo
 * padrão de toda migração deste projeto — pode já estar publicado em
 * código antes de rodar) — Postgres `42P01` (tabela indefinida) nunca
 * agenda nada nem derruba a tela, igual ao que `requireQueryToleratingMissingColumn`
 * já faz pra coluna ausente (`lib/require-query.ts`). Qualquer outro erro
 * de leitura também nunca agenda (silencioso, só log) — uma falha aqui
 * nunca pode impedir a tela de carregar.
 *
 * Achado real em produção: antes, o log só era gravado em caso de SUCESSO
 * — então, numa conta cujo rate limit da Meta já esgotou (achado real:
 * contas grandes bateram nisso mais de uma vez), CADA reload da página
 * disparava uma tentativa NOVA inteira (mais uma rodada de chamadas numa
 * conta que já estava sem orçamento — piorando exatamente o problema que
 * se tentava esperar passar, e chegando a derrubar outra função que já
 * funcionava, `fetchAccountBalanceSnapshot`, que compartilha o mesmo
 * orçamento por conta). Agora o log é gravado JÁ AQUI, ANTES de sequer
 * tentar buscar na Meta — garante pelo menos 24h de intervalo entre
 * TENTATIVAS (não só entre sucessos), dê certo ou não.
 */
export async function scheduleCreativePreviewRefreshIfStale(supabase: Supabase, clientId: string, accountId: string | null): Promise<void> {
  if (!accountId) return;

  const { data, error } = await supabase.from("creative_preview_refresh_log").select("refreshed_at").eq("client_id", clientId);
  if (error) {
    if (error.code !== "42P01") console.error(`[scheduleCreativePreviewRefreshIfStale] falha ao ler log (cliente ${clientId}):`, error);
    return;
  }

  const refreshedAt = data?.[0]?.refreshed_at ?? null;
  if (!isCreativePreviewRefreshStale(refreshedAt, new Date())) return;

  const admin = createAdminClient();
  const { error: logError } = await admin
    .from("creative_preview_refresh_log")
    .upsert({ client_id: clientId, refreshed_at: new Date().toISOString() }, { onConflict: "client_id" });
  if (logError) {
    // Sem conseguir "reservar" a tentativa, não arrisca agendar mesmo
    // assim — poderia disparar junto com um reload concorrente.
    console.error(`[scheduleCreativePreviewRefreshIfStale] falha ao gravar log antes da busca (cliente ${clientId}):`, logError);
    return;
  }

  after(() => refreshCreativePreviews(clientId, accountId));
}
