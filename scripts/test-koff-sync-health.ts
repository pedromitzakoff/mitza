/**
 * Testes da Etapa "Diagnóstico de sincronização" — achado real de 11/2026:
 * o bug de schema do `link_clicks` ausente bloqueava toda gravação de
 * campanha/conjunto/criativo sem impedir a gravação de investimento
 * agregado, produzindo contas com investimento registrado num dia mas
 * nenhuma campanha no mesmo dia. `findCampaignDataGaps` é uma ferramenta
 * PERMANENTE (não um script de uso único) — estes testes cobrem o núcleo
 * puro (`detectGapRange`, sem Supabase) e confirmam, por conteúdo de
 * arquivo, que a correção de cada gap reaproveita o backfill já existente
 * (nunca uma segunda implementação de busca/gravação Meta API).
 *
 * Rodar: npx tsx scripts/test-koff-sync-health.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectGapRange, resolveGapScanWindow, clampGapToSafeSlice } from "../src/lib/meta-api-gap-detection";

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
console.log("\nA — detectGapRange: núcleo puro, sem Supabase\n");
{
  ok(
    "sem nenhum dia com investimento sem campanha -> null (nada a corrigir)",
    detectGapRange(["2026-11-01", "2026-11-02"], new Set(["2026-11-01", "2026-11-02"])) === null,
  );

  const gap = detectGapRange(
    ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"],
    new Set(["2026-11-01", "2026-11-04"]), // só 1 e 4 têm campanha — 2 e 3 faltam
  );
  ok("aponta o intervalo [primeiro, último] dia faltante", gap?.since === "2026-11-02" && gap?.until === "2026-11-03");
  ok("conta os dias faltantes certos (2)", gap?.missingDayCount === 2);

  const singleDayGap = detectGapRange(["2026-11-05"], new Set());
  ok("um único dia faltante -> since === until", singleDayGap?.since === "2026-11-05" && singleDayGap?.until === "2026-11-05");

  ok(
    "nenhum dia com investimento real -> null (nunca aponta gap sem nenhum spend > 0 no período)",
    detectGapRange([], new Set(["2026-11-01"])) === null,
  );

  // Gap "irregular" (dia do meio já certo) — intervalo cheio, nunca
  // sub-intervalos recortados (reexecutar backfill num dia já certo é
  // inofensivo, mesmo upsert idempotente de sempre).
  const irregular = detectGapRange(["2026-11-01", "2026-11-02", "2026-11-03"], new Set(["2026-11-02"]));
  ok("dia certo no meio do intervalo não quebra o cálculo do intervalo cheio", irregular?.since === "2026-11-01" && irregular?.until === "2026-11-03");
  ok("missingDayCount conta só os dias REALMENTE faltantes (2), não o tamanho do intervalo (3)", irregular?.missingDayCount === 2);
}

// ---------------------------------------------------------------------------
console.log("\nA2 — resolveGapScanWindow: nunca aponta os dias ainda em autocorreção\n");
{
  const w1 = resolveGapScanWindow("2026-11-11", 60, 3);
  ok("windowEnd exclui os últimos 3 dias (hoje=11, janela some até o dia 8)", w1.windowEnd === "2026-11-08");
  ok("windowStart respeita lookbackDays (60 dias antes de hoje)", w1.windowStart === "2026-09-12");

  const w2 = resolveGapScanWindow("2026-11-11", 60, 1);
  ok("syncWindowDays menor -> windowEnd mais próximo de hoje (exclui só ontem)", w2.windowEnd === "2026-11-10");
}

// ---------------------------------------------------------------------------
console.log("\nA3 — clampGapToSafeSlice: achado real de produção (timeout de 300s da Vercel numa conta grande)\n");
{
  const smallGap = clampGapToSafeSlice("2026-11-01", "2026-11-02", 3);
  ok("gap menor que a fatia segura -> passa intacto (since/until originais)", smallGap.since === "2026-11-01" && smallGap.until === "2026-11-02");

  const bigGap = clampGapToSafeSlice("2026-10-23", "2026-11-08", 3);
  ok("gap de 17 dias cortado em fatia de 3 (since + 2 dias)", bigGap.since === "2026-10-23" && bigGap.until === "2026-10-25");

  const exactGap = clampGapToSafeSlice("2026-11-01", "2026-11-03", 3);
  ok("gap do tamanho exato da fatia -> cobre o intervalo inteiro numa tacada só", exactGap.since === "2026-11-01" && exactGap.until === "2026-11-03");

  const oneDaySlice = clampGapToSafeSlice("2026-10-23", "2026-11-08", 1);
  ok("fatia de 1 dia -> since === until (nunca um intervalo invertido)", oneDaySlice.since === "2026-10-23" && oneDaySlice.until === "2026-10-23");
}

// ---------------------------------------------------------------------------
console.log("\nB — Wiring: a correção reaproveita o backfill já existente, nunca uma segunda implementação\n");
{
  const gapDetectionSource = loadSource("src", "lib", "meta-api-gap-detection.ts");
  const syncHealthPageSource = loadSource("src", "app", "settings", "sync-health", "page.tsx");
  const backfillActionsSource = loadSource("src", "app", "settings", "meta-connections", "actions.ts");
  const settingsIndexSource = loadSource("src", "app", "settings", "page.tsx");

  ok(
    "findCampaignDataGaps só LÊ (daily_spend/campaign_daily_metrics/import_sources/clients) — nenhum insert/update/upsert",
    gapDetectionSource.includes('.from("daily_spend")') &&
      gapDetectionSource.includes('.from("campaign_daily_metrics")') &&
      !gapDetectionSource.includes(".insert(") &&
      !gapDetectionSource.includes(".update(") &&
      !gapDetectionSource.includes(".upsert("),
  );
  ok(
    "a tela nova reaproveita runMetaApiBackfillAction (nunca uma segunda Server Action de busca/gravação Meta)",
    syncHealthPageSource.includes("runMetaApiBackfillAction") && syncHealthPageSource.includes('from "../meta-connections/actions"'),
  );
  ok(
    'a tela nova pré-preenche "since"/"until" a partir da FATIA segura (nunca o gap inteiro, nunca pede o admin digitar)',
    syncHealthPageSource.includes('name="since" value={slice.since}') && syncHealthPageSource.includes('name="until" value={slice.until}'),
  );
  ok(
    "a fatia reaproveita DIRECT_SYNC_WINDOW_DAYS (mesma janela já provada segura pela sincronização automática, nunca um número novo)",
    syncHealthPageSource.includes("clampGapToSafeSlice(gap.since, gap.until, DIRECT_SYNC_WINDOW_DAYS)"),
  );
  ok(
    "return_to opcional preserva o destino original (meta-connections) quando ausente — nunca quebra o formulário antigo",
    backfillActionsSource.includes('formData.get("return_to")') && backfillActionsSource.includes("returnTo.startsWith"),
  );
  ok('"Diagnóstico de sincronização" está registrado no índice de Configurações', settingsIndexSource.includes("/settings/sync-health"));
}

console.log(`\n${passed} verificações OK.\n`);
