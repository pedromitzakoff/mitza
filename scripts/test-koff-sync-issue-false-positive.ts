/**
 * Testes da correção "falso positivo no alerta 'Problema de dados ou
 * sincronização'" — achado real do usuário: várias contas (ex. Aibou,
 * Alliance Paraiso) mostrando "Dados faltantes" num período em que a
 * sincronização estava, de fato, ok.
 *
 * Causa raiz: `report_sync_coverage` (`supabase/weekly-reports-sync-
 * coverage.sql`) só considera um dia "coberto" quando existe uma linha em
 * `data_sync_runs` com `requested_since/until` preenchidos cobrindo esse
 * dia. `runMetaApiBackfill` (backfill administrativo) e o endpoint n8n
 * (`api/n8n/meta-insights/route.ts`) chamavam `ingestMetaApiPayload` SEM
 * passar essa janela — qualquer dado sincronizado por esses dois caminhos
 * ficava invisível pra `report_sync_coverage` e pro alerta
 * "Problema de dados ou sincronização" (`evaluate-sync-issues.ts`) pra
 * sempre, mesmo com os dados corretos já gravados.
 *
 * Cobre:
 *  A. `deriveWindowFromRows` (núcleo puro) — min/max das linhas, `undefined`
 *     pra payload vazio.
 *  B. `meta-api-backfill.ts` passa a janela EXPLÍCITA já conhecida (nunca
 *     derivada das linhas — um dia zerado também precisa contar como
 *     coberto).
 *  C. `ingestMetaApiPayload` usa o fallback derivado só quando quem chama
 *     não passa `requestedWindow` (nunca sobrescreve uma janela explícita).
 *
 * Rodar: npx tsx scripts/test-koff-sync-issue-false-positive.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveWindowFromRows } from "../src/lib/meta-api-ingest-run";
import type { MetaApiIngestRow } from "../src/lib/meta-api-ingest";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

function row(date: string): MetaApiIngestRow {
  return { date, campaignId: "c1", campaignName: "Campanha", spend: 10 };
}

// ---------------------------------------------------------------------------
console.log("\nA — deriveWindowFromRows: min/max das linhas, undefined pra vazio\n");
{
  const window = deriveWindowFromRows([row("2026-11-12"), row("2026-11-10"), row("2026-11-11")]);
  ok("since = a data mais antiga das linhas", window?.since === "2026-11-10");
  ok("until = a data mais recente das linhas", window?.until === "2026-11-12");

  const singleDay = deriveWindowFromRows([row("2026-11-10")]);
  ok("1 única linha -> since === until (mesma data)", singleDay?.since === "2026-11-10" && singleDay?.until === "2026-11-10");

  const empty = deriveWindowFromRows([]);
  ok("payload vazio -> undefined (nada a inferir, nunca uma janela fabricada)", empty === undefined);
}

// ---------------------------------------------------------------------------
console.log("\nB — meta-api-backfill.ts: passa a janela EXPLÍCITA do lote, nunca derivada das linhas\n");
{
  const backfillSource = loadSource("src", "lib", "meta-api-backfill.ts");
  ok(
    "ingestMetaApiPayload recebe { since: range.since, until: range.until } — mesma janela que meta-api-direct-sync.ts já passa, nunca omitida",
    backfillSource.includes("ingestMetaApiPayload({ accountId, rows }, { since: range.since, until: range.until });"),
  );
}

console.log("\nC — ingestMetaApiPayload: fallback derivado só quando quem chama não sabe o período\n");
{
  const ingestRunSource = loadSource("src", "lib", "meta-api-ingest-run.ts");
  ok(
    "effectiveWindow = requestedWindow (explícito) ?? deriveWindowFromRows (fallback) — nunca o contrário",
    ingestRunSource.includes("const effectiveWindow = requestedWindow ?? deriveWindowFromRows(payload.rows);"),
  );
  ok("insertRun/retry usam effectiveWindow (não mais a requestedWindow crua)", ingestRunSource.includes("insertRun(effectiveWindow)") && ingestRunSource.includes("effectiveWindow && runInsertError"));
  ok(
    "meta-api-direct-sync.ts continua passando a própria janela — nunca afetado (já era explícito)",
    loadSource("src", "lib", "meta-api-direct-sync.ts").includes("ingestMetaApiPayload({ accountId, rows }, { since, until });"),
  );
}

console.log(`\n${passed} verificações OK.\n`);
