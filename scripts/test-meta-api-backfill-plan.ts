/**
 * Testes puros do planejamento de lotes do backfill histórico (ponto 3 do
 * pedido de migração) — `planBackfillBatches` (`lib/meta-api-backfill.ts`).
 * Cobre:
 *  - divisão correta em lotes de N dias, do mais antigo pro mais recente;
 *  - último lote nunca passa da data final pedida (clamping);
 *  - intervalo de 1 dia só só produz 1 lote;
 *  - datas inválidas e intervalo invertido são rejeitados;
 *  - teto de segurança (`BACKFILL_MAX_TOTAL_DAYS`) rejeita intervalos
 *    absurdamente longos.
 *
 * Nunca testa `runMetaApiBackfill` em si (faria chamada real à Graph API/
 * Supabase) — pedido explícito do usuário: "Não execute backfill real sem
 * minha autorização." A orquestração foi revisada manualmente (ver relato
 * final), nunca executada nesta sessão.
 *
 * Rodar: npx tsx scripts/test-meta-api-backfill-plan.ts
 */
import assert from "node:assert/strict";
import { planBackfillBatches, BACKFILL_MAX_TOTAL_DAYS } from "../src/lib/meta-api-backfill";

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

// ---------------------------------------------------------------------------
console.log("1 — Intervalo de 65 dias em lotes de 30: 3 lotes, último clampado\n");
{
  const plan = planBackfillBatches("2026-01-01", "2026-03-06", 30);
  ok("plano válido", plan.ok);
  if (plan.ok) {
    check("3 lotes", plan.batches.length, 3);
    check("lote 1: 2026-01-01 a 2026-01-30", plan.batches[0], { since: "2026-01-01", until: "2026-01-30" });
    check("lote 2: 2026-01-31 a 2026-03-01", plan.batches[1], { since: "2026-01-31", until: "2026-03-01" });
    check("lote 3 (clampado): 2026-03-02 a 2026-03-06", plan.batches[2], { since: "2026-03-02", until: "2026-03-06" });
  }
}

// ---------------------------------------------------------------------------
console.log("\n2 — Intervalo de 1 dia: 1 lote só\n");
{
  const plan = planBackfillBatches("2026-05-10", "2026-05-10", 30);
  ok("plano válido", plan.ok);
  if (plan.ok) check("1 lote, mesma data início/fim", plan.batches, [{ since: "2026-05-10", until: "2026-05-10" }]);
}

// ---------------------------------------------------------------------------
console.log("\n3 — Intervalo invertido (until antes de since): rejeitado\n");
{
  const plan = planBackfillBatches("2026-06-01", "2026-05-01", 30);
  check("rejeitado", plan.ok, false);
}

// ---------------------------------------------------------------------------
console.log("\n4 — Datas malformadas: rejeitado\n");
{
  const plan = planBackfillBatches("not-a-date", "2026-05-01", 30);
  check("rejeitado", plan.ok, false);
}

// ---------------------------------------------------------------------------
console.log(`\n5 — Teto de segurança (${BACKFILL_MAX_TOTAL_DAYS} dias): intervalo maior é rejeitado\n`);
{
  const tooLong = planBackfillBatches("2020-01-01", "2026-01-01", 30);
  check("rejeitado (muito longo)", tooLong.ok, false);

  const atLimit = planBackfillBatches("2024-01-01", "2024-01-01", 30);
  ok("intervalo pequeno dentro do teto continua aceito", atLimit.ok);
}

// ---------------------------------------------------------------------------
console.log("\n6 — Lotes cobrem o intervalo inteiro sem buraco nem overlap\n");
{
  const plan = planBackfillBatches("2026-01-01", "2026-04-15", 10);
  ok("plano válido", plan.ok);
  if (plan.ok) {
    for (let i = 1; i < plan.batches.length; i++) {
      const prevUntil = new Date(`${plan.batches[i - 1].until}T00:00:00Z`);
      const currSince = new Date(`${plan.batches[i].since}T00:00:00Z`);
      const expectedCurrSince = new Date(prevUntil);
      expectedCurrSince.setUTCDate(expectedCurrSince.getUTCDate() + 1);
      ok(`lote ${i}: começa exatamente 1 dia depois do fim do lote anterior (sem buraco, sem overlap)`, currSince.getTime() === expectedCurrSince.getTime());
    }
    check("último lote termina exatamente na data pedida", plan.batches[plan.batches.length - 1].until, "2026-04-15");
  }
}

console.log(`\nTodos os ${passed} testes passaram.`);
