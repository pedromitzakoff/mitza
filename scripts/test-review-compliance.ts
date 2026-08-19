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
 * Cobre os 9 cenários pedidos (A-I): números exatos em dias úteis dados
 * pelo pedido de implementação, mais os testes de integração de ponta a
 * ponta (via `buildOperationClientCard`/`buildAttentionAlerts`/
 * `priorityTier`) que provam que Sprints e Operação chegam à MESMA
 * resposta.
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
import { buildOperationClientCard, type OperationClientRawData } from "../src/app/operation/operation-data";
import { priorityTier } from "../src/lib/account-priority";

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

function minimalRawClient(overrides: Partial<OperationClientRawData>): OperationClientRawData {
  return {
    id: "client-1",
    name: "Cliente Teste",
    metaAdAccountId: "act_1",
    managerNames: [],
    managerIds: [],
    sprints: [],
    dailySpend: [],
    plannedAllocations: [],
    monthlyBudgetChanges: [],
    tasks: [],
    // Ativo e sincronizado por padrão, pra nenhum alerta estranho (atividade/
    // sync) contaminar os testes que só querem isolar o sinal de revisão.
    clientLastActivityAt: TODAY.toISOString(),
    sprintLastActivityAt: null,
    lastSyncedAt: TODAY.toISOString(),
    lastReviewAt: null,
    reviewIsOverdue: false,
    ...overrides,
  };
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

// ---------------------------------------------------------------------------
// Integração — Sprints/Operação chegam à MESMA resposta via
// buildOperationClientCard (que agora aceita `reviewIsOverdue` já resolvido).
// ---------------------------------------------------------------------------

console.log("\nIntegração A/D — atraso de revisão gera o alerta legado e o tier 3 (mesma resposta da Operação)\n");
{
  const overdueClient = minimalRawClient({ reviewIsOverdue: true });
  const card = buildOperationClientCard(overdueClient, TODAY);
  check("A/D integração — alerta 'otimizacao' presente quando reviewIsOverdue=true", card.alerts.some((a) => a.kind === "otimizacao"), true);
  check("A/D integração — accountHealth não fica saudável (alerta atencao)", card.accountHealth, "atencao");
  check("A/D integração — priorityTier = 3 (tier de otimização)", priorityTier(card, "month", TODAY), 3);
}

console.log("\nIntegração B/C — em dia não gera alerta nem penaliza o tier\n");
{
  const compliantClient = minimalRawClient({ reviewIsOverdue: false });
  const card = buildOperationClientCard(compliantClient, TODAY);
  check("B/C integração — nenhum alerta 'otimizacao'", card.alerts.some((a) => a.kind === "otimizacao"), false);
  check("B/C integração — accountHealth saudável", card.accountHealth, "saudavel");
  check("B/C integração — priorityTier = 5 (sem nenhum sinal de atenção)", priorityTier(card, "month", TODAY), 5);
}

console.log("\nCenário F (integração) — cadência desativada: Sprints também não penaliza\n");
{
  // reviewIsOverdue já resolvido como false (é isso que a Etapa 5 garante:
  // vem naturalmente da regra compartilhada, nenhuma exceção manual aqui).
  const disabledCadenceClient = minimalRawClient({ lastReviewAt: isoDaysAgo(90), reviewIsOverdue: false });
  const card = buildOperationClientCard(disabledCadenceClient, TODAY);
  check("F integração — nenhum alerta 'otimizacao' mesmo com 90 dias sem revisão", card.alerts.some((a) => a.kind === "otimizacao"), false);
  check("F integração — priorityTier = 5", priorityTier(card, "month", TODAY), 5);
}

console.log("\nFechamento do último consumidor legado — clients/page.tsx também respeita a cadência oficial, nunca mais 14 dias corridos\n");
{
  // Mesmo cenário que já provava a divergência antes desta etapa: 8 dias
  // corridos é "recente" pra regra antiga (14 dias), mas já está ATRASADO
  // pra uma cadência de 5 dias úteis. `reviewIsOverdue` (obrigatório agora)
  // é sempre a decisão oficial — não existe mais nenhum cálculo de dias
  // corridos em `buildOperationClientCard` pra nenhum consumidor cair.
  const { isOverdue } = resolveReviewComplianceStatus(isoDaysAgo(8), { max_business_days_without_review: 5, is_active: true }, TODAY);
  check("fechamento — 8 dias corridos, cadência 5 dias úteis: oficial diz atrasada", isOverdue, true);

  const client = minimalRawClient({ lastReviewAt: isoDaysAgo(8), reviewIsOverdue: isOverdue });
  const card = buildOperationClientCard(client, TODAY);
  check("fechamento — card reflete atraso mesmo com 8 dias corridos (nunca mais 'recente' por estar < 14)", card.alerts.some((a) => a.kind === "otimizacao"), true);
}

console.log("\nCenário H — performance crítica (sinal mais urgente do motor legado) + revisão em dia -> prioridade não vem da revisão\n");
{
  // O motor legado (attention-alerts.ts) não avalia CPA/resultado (isso é
  // exclusivo do Motor de Saúde/Motor Único) — o sinal mais urgente
  // disponível aqui é tarefa atrasada, que já força accountHealth="critico"
  // exatamente como investimento acima do ritmo faria. O ponto do teste:
  // mesmo com um problema mais grave already ativo, revisão em dia nunca
  // aparece como a causa, e revisão atrasada não teria mudado o tier 0.
  const criticalClient = minimalRawClient({
    reviewIsOverdue: false,
    tasks: [
      {
        id: "t1",
        title: "Tarefa atrasada",
        type: "outro",
        due_date: "2026-08-01",
        status: "pendente",
        assignee: null,
        notes: null,
        sprint_id: null,
      },
    ],
  });
  const card = buildOperationClientCard(criticalClient, TODAY);
  check("H — accountHealth crítico (tarefa atrasada), não por revisão", card.accountHealth, "critico");
  check("H — priorityTier = 0 (accountHealth crítico vence, revisão nem é consultada)", priorityTier(card, "month", TODAY), 0);
}

console.log("\nCenário I — performance saudável + revisão atrasada -> revisão influencia a prioridade consistentemente\n");
{
  const healthyButOverdueClient = minimalRawClient({ reviewIsOverdue: true });
  const card = buildOperationClientCard(healthyButOverdueClient, TODAY);
  check("I — accountHealth não é crítico (nenhum outro problema)", card.accountHealth, "atencao");
  check("I — priorityTier = 3, revisão é o único motivo e influencia o tier", priorityTier(card, "month", TODAY), 3);
}

console.log(`\n${passed} verificações passaram.`);
