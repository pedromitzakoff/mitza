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

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
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
  const fetchFnSrc = fetchFullSrc.slice(fnStart, fnStart + 1500);

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

console.log(`\n${passed} verificações passaram.\n`);
