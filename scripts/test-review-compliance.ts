/**
 * Testes da Convergência da Regra de Revisão de Conta — confirma que a
 * decisão "esta conta está em dia com a revisão?" agora tem UMA resposta
 * só, produzida pelo helper compartilhado extraído em
 * `account-health-engine.ts` (`resolveReviewDimension`/`isReviewOverdue`/
 * `resolveReviewCadenceInputs`/`resolveReviewComplianceStatus`), e
 * consumida igualmente pelo Motor de Saúde (Operação), pelo Dashboard e
 * pelo Sprints — em vez do antigo `OPTIMIZATION_LOOKBACK_DAYS` (14 dias
 * corridos fixos) que só o Motor legado usava.
 *
 * Cobre os 7 cenários pedidos (A-G): números exatos em dias úteis dados
 * pelo pedido de implementação.
 *
 * KOFF Analytics — Etapa 1.8: os testes de integração de ponta a ponta
 * (via `buildOperationClientCard`/`priorityTier`, `app/operation/operation-data.ts`/
 * `lib/account-priority.ts` — removidos junto com Operação/Sprints) saíram
 * deste arquivo — provavam que a revisão atrasada não influenciava mais
 * alertas/prioridade nesses módulos, que não existem mais. O núcleo puro
 * (`resolveReviewDimension`/`resolveReviewComplianceStatus`/etc., em
 * `account-health-engine.ts`) continua intocado e em uso real pelo Cockpit.
 *
 * Rodar: npx tsx scripts/test-review-compliance.ts
 */
import assert from "node:assert/strict";
import {
  resolveReviewDimension,
  resolveReviewCadenceInputs,
  resolveReviewComplianceStatus,
  isReviewOverdue,
  type AccountReviewCadenceRow,
} from "../src/lib/account-health-engine";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

const TODAY = new Date("2026-08-19T12:00:00Z"); // quarta-feira

function isoDaysAgo(days: number): string {
  return new Date(TODAY.getTime() - days * 86_400_000).toISOString();
}

// ---------------------------------------------------------------------------
// Núcleo puro — resolveReviewDimension/isReviewOverdue (A-D: números exatos
// em dias úteis, direto do pedido de implementação).
// ---------------------------------------------------------------------------

console.log("Cenário A — cadência 5 dias úteis, última revisão 6 dias úteis atrás -> atrasada\n");
{
  const review = resolveReviewDimension(6, 5);
  check("A — status leve (20% além do prazo)", review.status, "leve");
  check("A — isReviewOverdue = true", isReviewOverdue(review), true);
}

console.log("\nCenário B — cadência 15 dias úteis, última revisão 9 dias úteis atrás -> em dia\n");
{
  const review = resolveReviewDimension(9, 15);
  check("B — status nenhum (dentro do prazo)", review.status, "nenhum");
  check("B — isReviewOverdue = false", isReviewOverdue(review), false);
}

console.log("\nCenário C — cadência padrão 10 dias úteis, última revisão exatamente no prazo -> em dia\n");
{
  const review = resolveReviewDimension(10, 10);
  check("C — status nenhum (limite exato ainda não é atraso)", review.status, "nenhum");
  check("C — isReviewOverdue = false", isReviewOverdue(review), false);
}

console.log("\nCenário D — cadência 3 dias úteis, última revisão 5 dias úteis atrás -> atraso relevante\n");
{
  const review = resolveReviewDimension(5, 3);
  check("D — status relevante (66,7% além do prazo)", review.status, "relevante");
  check("D — isReviewOverdue = true (nunca 'em dia')", isReviewOverdue(review), true);
}

console.log("\nCenário E — nunca revisada -> comportamento oficial atual preservado\n");
{
  const withCadence: AccountReviewCadenceRow = { max_business_days_without_review: 10, is_active: true };
  const { review, isOverdue } = resolveReviewComplianceStatus(null, withCadence, TODAY);
  check("E — status grave (pior caso, sem depender de fração)", review.status, "grave");
  check("E — actual null (nunca revisada)", review.actual, null);
  check("E — isOverdue = true", isOverdue, true);

  // Sem nenhuma linha em account_review_cadences -> cai no fallback padrão
  // da agência (DEFAULT_REVIEW_MAX_BUSINESS_DAYS), continua grave.
  const { review: reviewNoRow } = resolveReviewComplianceStatus(null, null, TODAY);
  check("E — sem cadência configurada, ainda grave (fallback)", reviewNoRow.status, "grave");
  check("E — sem cadência configurada, planned = fallback (10)", reviewNoRow.planned, 10);
}

console.log("\nCenário F — is_active=false -> nenhum consumidor cobra revisão (nem nunca revisada)\n");
{
  const disabled: AccountReviewCadenceRow = { max_business_days_without_review: 5, is_active: false };
  const { review, isOverdue } = resolveReviewComplianceStatus(isoDaysAgo(30), disabled, TODAY);
  check("F — dimensão desabilitada (enabled=false)", review.enabled, false);
  check("F — status nenhum mesmo com 30 dias sem revisão", review.status, "nenhum");
  check("F — isOverdue = false", isOverdue, false);

  // Mesmo nunca revisada: is_active=false ainda assim silencia a dimensão —
  // não é um caso especial, é a MESMA regra (reviewMaxBusinessDays vira null).
  const { review: neverReviewedDisabled, isOverdue: neverReviewedOverdue } = resolveReviewComplianceStatus(null, disabled, TODAY);
  check("F — nunca revisada + desativada, ainda assim nenhum (não é grave)", neverReviewedDisabled.status, "nenhum");
  check("F — nunca revisada + desativada, isOverdue = false", neverReviewedOverdue, false);
}

console.log("\nCenário G — cadência mudou de 10 para 5 dias úteis -> a próxima avaliação usa 5\n");
{
  // Última revisão 7 dias úteis atrás: dentro da cadência antiga (10),
  // além da nova (5) — mesma revisão, mesma data, só o prazo mudou.
  const lastReviewAt = isoDaysAgo(9); // ~7 dias úteis atrás de 19/08 (qua)
  const { reviewBusinessDaysAgo } = resolveReviewCadenceInputs(lastReviewAt, null, TODAY);

  const oldCadence: AccountReviewCadenceRow = { max_business_days_without_review: 10, is_active: true };
  const newCadence: AccountReviewCadenceRow = { max_business_days_without_review: 5, is_active: true };

  const before = resolveReviewDimension(reviewBusinessDaysAgo, resolveReviewCadenceInputs(lastReviewAt, oldCadence, TODAY).reviewMaxBusinessDays);
  const after = resolveReviewDimension(reviewBusinessDaysAgo, resolveReviewCadenceInputs(lastReviewAt, newCadence, TODAY).reviewMaxBusinessDays);

  check("G — antes do aperto (prazo 10): em dia", before.status, "nenhum");
  check("G — depois do aperto (prazo 5): atrasada, sem nenhum cache do valor antigo", isReviewOverdue(after), true);
  check("G — o prazo usado (planned) reflete o valor NOVO imediatamente", after.planned, 5);
}

console.log(`\n${passed} verificações passaram.`);
