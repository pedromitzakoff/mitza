/**
 * Testes puros da migração Stract -> Meta API direta (ponto 2 do pedido do
 * usuário: "o sistema não pode somar métricas granulares do Stract e da
 * Meta API para a mesma conta e período"). Cobre exatamente os três
 * cenários que o usuário pediu, mais os dois casos de borda que o
 * `docs/STRACT_INTEGRATION_ARCHITECTURE.md` identificou como risco real:
 *
 *  - período com sobreposição (ambas as fontes escreveram o mesmo dia):
 *    só a linha `meta_api` sobrevive, a `stract` é descartada;
 *  - período só Stract (histórico anterior à migração de um cliente):
 *    preservado 100% intacto, nunca apagado nem somado com nada;
 *  - período só Meta API (depois da migração completa): intacto;
 *  - duas contas do mesmo cliente nunca se misturam — overlap numa conta
 *    não afeta a outra, mesmo na mesma data;
 *  - uma `import_source_id` que não existe no mapa (fonte excluída) nunca
 *    é misturada com nenhuma outra linha.
 *
 * Rodar: npx tsx scripts/test-granular-provider-dedup.ts
 */
import assert from "node:assert/strict";
import { dedupeRowsByProviderPreference, type ImportSourceProviderInfo } from "../src/lib/granular-provider-dedup";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

interface Row {
  importSourceId: string;
  date: string;
  spend: number;
  label: string;
}

function dedupe(rows: Row[], sourceById: Map<string, ImportSourceProviderInfo>): Row[] {
  return dedupeRowsByProviderPreference(rows, (r) => r.importSourceId, (r) => r.date, sourceById);
}

const STRACT_SOURCE = "stract-import-source";
const META_SOURCE = "meta-api-import-source";
const STRACT_SOURCE_ACCOUNT_B = "stract-import-source-b";

const sourceById = new Map<string, ImportSourceProviderInfo>([
  [STRACT_SOURCE, { provider: "stract", externalAccountId: "act_111" }],
  [META_SOURCE, { provider: "meta_api", externalAccountId: "act_111" }],
  [STRACT_SOURCE_ACCOUNT_B, { provider: "stract", externalAccountId: "act_222" }],
]);

// ---------------------------------------------------------------------------
console.log("1 — Período com sobreposição: só meta_api sobrevive, stract descartado\n");
{
  const rows: Row[] = [
    { importSourceId: STRACT_SOURCE, date: "2026-10-01", spend: 100, label: "stract-01" },
    { importSourceId: META_SOURCE, date: "2026-10-01", spend: 95, label: "meta-01" },
  ];
  const result = dedupe(rows, sourceById);
  check("overlap: devolve só 1 linha", result.length, 1);
  check("overlap: a linha mantida é a meta_api", result[0].label, "meta-01");
  ok("overlap: nenhuma soma (95, nunca 195)", result.reduce((sum, r) => sum + r.spend, 0) === 95);
}

// ---------------------------------------------------------------------------
console.log("\n2 — Período só Stract (antes da migração): preservado intacto\n");
{
  const rows: Row[] = [
    { importSourceId: STRACT_SOURCE, date: "2026-01-05", spend: 50, label: "stract-05" },
    { importSourceId: STRACT_SOURCE, date: "2026-01-06", spend: 60, label: "stract-06" },
  ];
  const result = dedupe(rows, sourceById);
  check("stract-only: nenhuma linha descartada", result.length, 2);
  check("stract-only: linhas idênticas às originais", result, rows);
}

// ---------------------------------------------------------------------------
console.log("\n3 — Período só Meta API (depois da migração completa): intacto\n");
{
  const rows: Row[] = [
    { importSourceId: META_SOURCE, date: "2026-11-01", spend: 70, label: "meta-11-01" },
    { importSourceId: META_SOURCE, date: "2026-11-02", spend: 80, label: "meta-11-02" },
  ];
  const result = dedupe(rows, sourceById);
  check("meta-only: nenhuma linha descartada", result.length, 2);
  check("meta-only: linhas idênticas às originais", result, rows);
}

// ---------------------------------------------------------------------------
console.log("\n4 — Duas contas do mesmo cliente: overlap numa conta não afeta a outra\n");
{
  const rows: Row[] = [
    // Conta A (act_111): overlap no mesmo dia -> só meta_api sobrevive.
    { importSourceId: STRACT_SOURCE, date: "2026-10-01", spend: 100, label: "A-stract" },
    { importSourceId: META_SOURCE, date: "2026-10-01", spend: 95, label: "A-meta" },
    // Conta B (act_222): só Stract, MESMA data -> preservada, nunca descartada
    // por causa do que aconteceu na conta A.
    { importSourceId: STRACT_SOURCE_ACCOUNT_B, date: "2026-10-01", spend: 40, label: "B-stract" },
  ];
  const result = dedupe(rows, sourceById);
  const labels = result.map((r) => r.label).sort();
  check("contas isoladas: conta B preservada, conta A deduplicada", labels, ["A-meta", "B-stract"]);
}

// ---------------------------------------------------------------------------
console.log("\n5 — import_source_id desconhecida (fonte excluída): nunca mistura com nada\n");
{
  const UNKNOWN_SOURCE = "deleted-source-id";
  const rows: Row[] = [
    { importSourceId: UNKNOWN_SOURCE, date: "2026-10-01", spend: 30, label: "unknown" },
    { importSourceId: META_SOURCE, date: "2026-10-01", spend: 95, label: "A-meta" },
  ];
  const result = dedupe(rows, sourceById);
  const labels = result.map((r) => r.label).sort();
  check("fonte desconhecida nunca é descartada nem mistura grupo", labels, ["A-meta", "unknown"]);
}

// ---------------------------------------------------------------------------
console.log("\n6 — Múltiplos dias, overlap só em alguns: cada dia decide por si\n");
{
  const rows: Row[] = [
    { importSourceId: STRACT_SOURCE, date: "2026-09-28", spend: 10, label: "s-28" },
    { importSourceId: STRACT_SOURCE, date: "2026-09-29", spend: 10, label: "s-29" },
    { importSourceId: META_SOURCE, date: "2026-09-29", spend: 11, label: "m-29" },
    { importSourceId: META_SOURCE, date: "2026-09-30", spend: 12, label: "m-30" },
  ];
  const result = dedupe(rows, sourceById);
  const labels = result.map((r) => r.label).sort();
  check("dia 28 (só stract) preservado, dia 29 (overlap) só meta, dia 30 (só meta) preservado", labels, ["m-29", "m-30", "s-28"]);
}

console.log(`\nTodos os ${passed} testes passaram.`);
