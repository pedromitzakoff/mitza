/**
 * Testes da Etapa "Preview de criativos" — pedido explícito do usuário
 * ("o meta não disponibiliza o link do criativo?"), com 3 decisões de
 * design negociadas em conversa: nunca baixar/guardar a imagem (só o link
 * que a Meta devolve), busca sob demanda com TTL de 24h (nunca cron, nunca
 * botão manual), e nunca bloquear a tela (via `after()`). Cobre o núcleo
 * puro (`isCreativePreviewRefreshStale`, sem Supabase/rede) e confirma, por
 * conteúdo de arquivo, que cada uma dessas 3 decisões está de fato
 * implementada — nunca redescoberta/reimplementada numa segunda vez.
 *
 * Rodar: npx tsx scripts/test-koff-creative-preview.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isCreativePreviewRefreshStale, CREATIVE_PREVIEW_REFRESH_TTL_MS } from "../src/lib/creative-preview-refresh";
import { fetchMetaApiAdCreativePreviews } from "../src/lib/meta-api-fetch";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}
/** Corpo de UMA função a partir do texto onde ela começa (ex.: o índice de
 * `export async function nome`) até o `}` que fecha, contando chaves —
 * nunca uma janela de tamanho fixo (quebra toda vez que a função cresce). */
function sliceFunctionBody(src: string, startIndex: number): string {
  const firstBrace = src.indexOf("{", startIndex);
  let depth = 0;
  for (let i = firstBrace; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(startIndex, i + 1);
    }
  }
  return src.slice(startIndex);
}

// ---------------------------------------------------------------------------
console.log("\nA — isCreativePreviewRefreshStale: núcleo puro\n");
{
  const now = new Date("2026-11-11T12:00:00.000Z");

  ok("nunca buscado (null) -> sempre velho", isCreativePreviewRefreshStale(null, now) === true);

  ok(
    "buscado há 1h (dentro do TTL de 24h) -> fresco",
    isCreativePreviewRefreshStale(new Date(now.getTime() - 60 * 60 * 1000).toISOString(), now) === false,
  );

  ok(
    "buscado há 25h (fora do TTL de 24h) -> velho",
    isCreativePreviewRefreshStale(new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(), now) === true,
  );

  ok(
    "TTL customizado é respeitado (não só o padrão de 24h)",
    isCreativePreviewRefreshStale(new Date(now.getTime() - 10 * 60 * 1000).toISOString(), now, 5 * 60 * 1000) === true,
  );

  ok("TTL padrão exportado é 24h em milissegundos", CREATIVE_PREVIEW_REFRESH_TTL_MS === 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
console.log("\nB — decisão 1: nunca baixar/guardar a imagem, só o link da Meta\n");
{
  const refreshSrc = loadSource("src", "lib", "creative-preview-refresh.ts");
  const fetchFullSrc = loadSource("src", "lib", "meta-api-fetch.ts");
  const fnStart = fetchFullSrc.indexOf("export async function fetchMetaApiAdCreativePreviews");
  const fetchFnSrc = sliceFunctionBody(fetchFullSrc, fnStart);

  ok(
    "fetchMetaApiAdCreativePreviews busca thumbnail_url/image_url (nunca baixa o arquivo)",
    fetchFnSrc.includes("thumbnail_url") && fetchFnSrc.includes("image_url") && !fetchFullSrc.includes("supabase.storage"),
  );

  ok(
    "refreshCreativePreviews grava preview_image_url (coluna já existente, nunca um novo bucket de storage)",
    refreshSrc.includes('.update({ preview_image_url: thumbnailUrl })') && !refreshSrc.includes("storage"),
  );

  ok(
    "agrupamento por NOME do criativo (identidade canônica), nunca por ad_id/creative_id",
    fnStart !== -1 &&
      fetchFnSrc.includes("row.name") &&
      !fetchFnSrc.includes("row.id") &&
      !/\bad_id\b|\bcreative_id\b/.test(fetchFnSrc),
  );
}

// ---------------------------------------------------------------------------
console.log("\nC — decisão 2: busca sob demanda com TTL de 24h (nunca cron, nunca botão manual)\n");
{
  const refreshSrc = loadSource("src", "lib", "creative-preview-refresh.ts");

  ok(
    "scheduleCreativePreviewRefreshIfStale consulta o log antes de decidir (nunca busca incondicional)",
    refreshSrc.includes("creative_preview_refresh_log") && refreshSrc.includes("isCreativePreviewRefreshStale"),
  );

  ok(
    "cliente sem conta Meta conectada nunca agenda nada",
    /if \(!accountId\) return;/.test(refreshSrc),
  );

  ok(
    "tolerante à tabela de log ainda não existir (migração pendente, Postgres 42P01) — nunca derruba a tela",
    refreshSrc.includes('"42P01"'),
  );

  // Achado real em produção: gravar o log só em caso de SUCESSO fazia
  // cada reload numa conta já sem orçamento de rate limit disparar uma
  // tentativa NOVA inteira (empilhando mais chamadas na mesma conta já no
  // limite). Corrigido: grava ANTES de tentar, garantindo intervalo
  // mínimo entre TENTATIVAS, dê certo ou não.
  const scheduleFnStart = refreshSrc.indexOf("export async function scheduleCreativePreviewRefreshIfStale");
  const scheduleFnSrc = sliceFunctionBody(refreshSrc, scheduleFnStart);
  const afterCallIndex = scheduleFnSrc.indexOf("after(() => refreshCreativePreviews(");
  const logUpsertIndex = scheduleFnSrc.indexOf('.from("creative_preview_refresh_log")\n    .upsert(');

  ok(
    "scheduleCreativePreviewRefreshIfStale grava o log ANTES de agendar a busca de verdade (after())",
    scheduleFnStart !== -1 && logUpsertIndex !== -1 && afterCallIndex !== -1 && logUpsertIndex < afterCallIndex,
  );

  const refreshFnSrc = sliceFunctionBody(refreshSrc, refreshSrc.indexOf("export async function refreshCreativePreviews"));
  ok(
    "refreshCreativePreviews NÃO grava mais o log (só quem chama grava, antes de chamar)",
    !refreshFnSrc.includes("creative_preview_refresh_log"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nD — decisão 3: nunca bloqueia a tela (after(), nunca aguardado no caminho de render)\n");
{
  const refreshSrc = loadSource("src", "lib", "creative-preview-refresh.ts");

  ok('usa after() do "next/server" pra rodar a busca DEPOIS da resposta', refreshSrc.includes('from "next/server"') && refreshSrc.includes("after("));

  ok(
    "a busca de verdade (refreshCreativePreviews) só é chamada dentro de after(), nunca aguardada (await) direto",
    /after\(\(\) => refreshCreativePreviews\(/.test(refreshSrc) && !/await refreshCreativePreviews\(/.test(refreshSrc),
  );

  ok(
    "refreshCreativePreviews usa o client ADMIN (fora do ciclo da requisição original), nunca o client de sessão do usuário",
    refreshSrc.includes("createAdminClient()"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nE — wiring: as duas páginas que mostram Anúncios agendam o refresh\n");
{
  const explorationPageData = loadSource("src", "lib", "cockpit-exploration-page-data.ts");
  const cockpitPage = loadSource("src", "app", "clients", "[id]", "page.tsx");

  ok(
    "Campanhas/Anúncios (/clients/[id]/campanhas e /anuncios, camada compartilhada) agenda o refresh",
    explorationPageData.includes("scheduleCreativePreviewRefreshIfStale"),
  );

  ok(
    "Cockpit principal (aba de Anúncios embutida em /clients/[id]) também agenda o refresh",
    cockpitPage.includes("scheduleCreativePreviewRefreshIfStale"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nF — UI: o card de anúncio mostra a imagem real quando existe, com fallback\n");
{
  const cardSrc = loadSource("src", "app", "clients", "ad-card-grid.tsx");

  ok(
    "AdCard renderiza <img> com row.previewImageUrl quando presente",
    /row\.previewImageUrl \?[\s\S]{0,200}<img src=\{row\.previewImageUrl\}/.test(cardSrc),
  );

  ok("PlaceholderIcon continua sendo o fallback (nunca removido)", cardSrc.includes("<PlaceholderIcon />"));
}

// ---------------------------------------------------------------------------
console.log("\nG2 — achado real de produção: limit=500 é rejeitado pela Graph API neste campo\n");
{
  const fetchFullSrc = loadSource("src", "lib", "meta-api-fetch.ts");
  const fieldsStart = fetchFullSrc.indexOf("CREATIVE_PREVIEW_FIELDS");
  const fnStart = fetchFullSrc.indexOf("export async function fetchMetaApiAdCreativePreviews");
  const constsSrc = fetchFullSrc.slice(fieldsStart, fnStart);

  ok(
    "fetchMetaApiAdCreativePreviews usa limit=50, nunca 500 (500 causava 'Please reduce the amount of data you're asking for' em conta real)",
    fieldsStart !== -1 && /CREATIVE_PREVIEW_PAGE_LIMIT = 50;/.test(constsSrc) && !/CREATIVE_PREVIEW_PAGE_LIMIT = 500;/.test(constsSrc),
  );
}

console.log("\nG3 — achado real de produção: sem effective_status, anúncios arquivados somem silenciosamente\n");
{
  const fetchFullSrc = loadSource("src", "lib", "meta-api-fetch.ts");

  ok(
    "effective_status inclui ARCHIVED (anúncio de campanha antiga encerrada continua tendo preview buscado)",
    fetchFullSrc.includes("CREATIVE_PREVIEW_EFFECTIVE_STATUS") && /"ARCHIVED"/.test(fetchFullSrc),
  );

  ok(
    "DELETED nunca está na lista (apagado de verdade não deveria ter preview buscado)",
    !/"DELETED"/.test(fetchFullSrc.slice(fetchFullSrc.indexOf("CREATIVE_PREVIEW_EFFECTIVE_STATUS"), fetchFullSrc.indexOf("CREATIVE_PREVIEW_EFFECTIVE_STATUS") + 700)),
  );

  ok(
    "o parâmetro effective_status é de fato enviado na URL da chamada",
    fetchFullSrc.includes('url.searchParams.set("effective_status", CREATIVE_PREVIEW_EFFECTIVE_STATUS)'),
  );
}

console.log("\nG4 — achado real de produção: qualidade ruim — image_url (original) deve vencer thumbnail_url (miniatura)\n");
{
  const fetchFullSrc = loadSource("src", "lib", "meta-api-fetch.ts");
  const fnStart = fetchFullSrc.indexOf("export async function fetchMetaApiAdCreativePreviews");
  const fnSrc = sliceFunctionBody(fetchFullSrc, fnStart);

  ok(
    "pedido explícito do usuário: SÓ image_url (imagem original) — nunca thumbnail_url (miniatura) como alternativa",
    fnSrc.includes("row.creative?.image_url") && !/thumbnailUrl:\s*row\.creative\?\.image_url\s*\?\?\s*row\.creative\?\.thumbnail_url/.test(fnSrc),
  );

  ok(
    "sem image_url, o anúncio simplesmente não entra (nunca um preview de baixa qualidade)",
    /if \(row\.creative\?\.image_url\) rows\.push/.test(fnSrc),
  );
}

console.log("\nG — migração: tabela mínima (1 linha por cliente, nunca a imagem em si)\n");
{
  const sql = loadSource("supabase", "creative-preview-refresh-log.sql");

  ok(
    "cria creative_preview_refresh_log com client_id (PK, FK pra clients) + refreshed_at, nada além disso",
    sql.includes("create table if not exists creative_preview_refresh_log") &&
      sql.includes("client_id uuid primary key references clients(id)") &&
      sql.includes("refreshed_at timestamptz not null default now()"),
  );
}

console.log("\nH — achado real de produção (conta Helping Hand): rate limit por conta é transitório, deve ter retry\n");
{
  async function main() {
    const originalFetch = globalThis.fetch;
    const originalSetTimeout = globalThis.setTimeout;
    process.env.META_API_ACCESS_TOKEN = "token-de-teste";
    // Acelera o backoff real (10s/30s/60s/90s) pro teste não esperar de
    // verdade — mesma ideia de qualquer outro teste de timing, só troca o
    // relógio.
    globalThis.setTimeout = ((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;

    const rateLimitBody = JSON.stringify({ error: { message: "There have been too many calls to this ad-account. Wait a bit and try again." } });
    const successBody = JSON.stringify({ data: [{ name: "ad-real-de-producao", creative: { image_url: "https://scontent.fbcdn.net/real.jpg" } }] });

    // H1 — erro de rate limit (achado real) some sozinho na 2ª tentativa.
    {
      let callCount = 0;
      globalThis.fetch = (async () => {
        callCount++;
        if (callCount === 1) return new Response(rateLimitBody, { status: 400 });
        return new Response(successBody, { status: 200 });
      }) as typeof fetch;

      const rows = await fetchMetaApiAdCreativePreviews("act_rate_limit_test");
      ok("depois do rate limit, uma 2ª tentativa com sucesso retorna os dados normalmente", rows.length === 1 && rows[0].thumbnailUrl === "https://scontent.fbcdn.net/real.jpg");
      ok("fez exatamente 2 chamadas (1 que falhou + 1 retry que funcionou), nunca mais que o necessário", callCount === 2);
    }

    // H2 — erro DIFERENTE de rate limit nunca tenta de novo (nunca mascarar um erro de verdade atrás de uma espera).
    {
      let callCount = 0;
      globalThis.fetch = (async () => {
        callCount++;
        return new Response(JSON.stringify({ error: { message: "Invalid OAuth access token." } }), { status: 400 });
      }) as typeof fetch;

      await assert.rejects(() => fetchMetaApiAdCreativePreviews("act_other_error_test"));
      ok("erro que NÃO é rate limit nunca tenta de novo — 1 chamada só, falha na hora", callCount === 1);
    }

    // H3 — achado real de produção (2ª e 3ª ocorrência, depois do fix H1):
    // o rate limit persistiu MESMO com o backoff mais longo, em duas
    // contas diferentes, e numa delas chegou a derrubar outra função que
    // já funcionava (busca de saldo, mesmo orçamento por conta). Esgotadas
    // as tentativas, a função agora devolve o que já capturou em vez de
    // jogar tudo fora — nunca lança nesse caso específico.
    {
      let callCount = 0;
      globalThis.fetch = (async () => {
        callCount++;
        return new Response(rateLimitBody, { status: 400 });
      }) as typeof fetch;

      const rows = await fetchMetaApiAdCreativePreviews("act_persistent_rate_limit_test");
      ok("esgota as 4 tentativas de retry (1 inicial + 4) antes de desistir, nunca menos nem mais", callCount === 5);
      ok("NUNCA lança quando o rate limit persiste — devolve o que capturou (vazio aqui, já que a 1ª página nunca respondeu) em vez de derrubar o resto da página", Array.isArray(rows) && rows.length === 0);
    }

    // H4 — a página 1 (com sucesso) nunca é jogada fora só porque a
    // página 2 bateu no limite persistente — progresso real é preservado.
    {
      let pageRequests = 0;
      const page1Url = "https://graph.facebook.com/v1/act_partial_progress_test/ads?after=page1";
      const page1Body = JSON.stringify({
        data: [{ name: "ad-pagina-1", creative: { image_url: "https://scontent.fbcdn.net/pagina1.jpg" } }],
        paging: { next: page1Url },
      });

      globalThis.fetch = (async () => {
        pageRequests++;
        if (pageRequests === 1) return new Response(page1Body, { status: 200 });
        return new Response(rateLimitBody, { status: 400 }); // página 2 em diante: sempre rate limit.
      }) as typeof fetch;

      const rows = await fetchMetaApiAdCreativePreviews("act_partial_progress_test");
      ok(
        "progresso de página(s) anteriores bem-sucedidas é preservado mesmo quando uma página seguinte esgota o rate limit",
        rows.length === 1 && rows[0].adName === "ad-pagina-1",
      );
    }

    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
  main().then(() => {
    console.log(`\n${passed} verificações passaram.\n`);
  });
}
