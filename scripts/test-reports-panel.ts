/**
 * Etapa "Separação Relatório Operacional × Documento de Performance" —
 * testes puros do painel `/reports` (report-panel.ts). Nenhuma regra de
 * transição de status é testada aqui (isso é `updateReportStatusAction`/
 * `finalizeReportAction`/`reopenReportAction`, reutilizadas sem alteração —
 * validação dessas é operacional, ver relatório final).
 *
 * Rodar: npx tsx scripts/test-reports-panel.ts
 */
import assert from "node:assert/strict";
import { buildPerformanceReportHref, buildReportsRedirectHref, resolveMonthlyReportRow } from "../src/app/reports/report-panel";

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
console.log("1 — buildPerformanceReportHref: período exato do mês selecionado chega ao Relatório de Performance\n");

const septemberHref = buildPerformanceReportHref("client-1", { firstDay: "2026-09-01", lastDay: "2026-09-30" });
ok("usa analyticsPreset=custom (obrigatório pra resolveAnalyticsPeriod respeitar start/end)", septemberHref.includes("analyticsPreset=custom"));
ok("start = primeiro dia do mês selecionado", septemberHref.includes("analyticsStart=2026-09-01"));
ok("end = último dia do mês selecionado", septemberHref.includes("analyticsEnd=2026-09-30"));
ok("aponta pra página nativa existente do Relatório de Performance, nunca uma nova", septemberHref.startsWith("/clients/client-1/relatorio?"));

const februaryHref = buildPerformanceReportHref("client-2", { firstDay: "2026-02-01", lastDay: "2026-02-28" });
ok("mês diferente (fevereiro, ano não bissexto) usa exatamente o lastDay recebido, nunca recalculado", februaryHref.includes("analyticsEnd=2026-02-28"));

// ---------------------------------------------------------------------------
console.log("\n2 — buildReportsRedirectHref: /reports/[clientId] nunca 404, preserva mês e cliente\n");

check("com mês: preserva mês + cliente", buildReportsRedirectHref("client-1", "2026-09"), "/reports?month=2026-09&client=client-1");
check("sem mês: preserva só o cliente, nunca quebra por falta de mês", buildReportsRedirectHref("client-1", undefined), "/reports?client=client-1");

// ---------------------------------------------------------------------------
console.log("\n3 — resolveMonthlyReportRow: nunca fabrica dado ausente\n");

check(
  "cliente sem nenhuma linha em monthly_reports pro mês -> nao_iniciado, '—', sem finalizedLabel (mesmo default de getOrCreateReport)",
  resolveMonthlyReportRow(undefined),
  { status: "nao_iniciado", updatedAtLabel: "—", finalizedLabel: null },
);

const emAndamento = resolveMonthlyReportRow({
  status: "em_andamento",
  updated_at: "2026-09-02T14:30:00.000Z",
  finalized_at: null,
  finalized_by_profile: null,
});
check("em_andamento: finalizedLabel sempre null (só existe pra status finalizado)", emAndamento.finalizedLabel, null);
check("updatedAtLabel formatado a partir de updated_at real", emAndamento.updatedAtLabel, "02/09");

const semUpdatedAt = resolveMonthlyReportRow({
  status: "nao_iniciado",
  updated_at: null,
  finalized_at: null,
  finalized_by_profile: null,
});
check("linha existe mas updated_at é null -> '—', nunca uma data fabricada", semUpdatedAt.updatedAtLabel, "—");

const finalizadoComNome = resolveMonthlyReportRow({
  status: "finalizado",
  updated_at: "2026-09-03T10:00:00.000Z",
  finalized_at: "2026-09-03T09:00:00.000Z",
  finalized_by_profile: { name: "Pedro Mitzakoff" },
});
check("finalizado com nome disponível (objeto): 'DD/MM · Nome'", finalizadoComNome.finalizedLabel, "03/09 · Pedro Mitzakoff");

const finalizadoComNomeEmArray = resolveMonthlyReportRow({
  status: "finalizado",
  updated_at: "2026-09-03T10:00:00.000Z",
  finalized_at: "2026-09-03T09:00:00.000Z",
  finalized_by_profile: [{ name: "Pedro Mitzakoff" }],
});
check(
  "finalizado com nome disponível (Supabase às vezes devolve array pra join 1:1): mesmo resultado do formato objeto",
  finalizadoComNomeEmArray.finalizedLabel,
  "03/09 · Pedro Mitzakoff",
);

const finalizadoSemNome = resolveMonthlyReportRow({
  status: "finalizado",
  updated_at: "2026-09-03T10:00:00.000Z",
  finalized_at: "2026-09-03T09:00:00.000Z",
  finalized_by_profile: null,
});
check("finalizado sem nome disponível: só a data, nunca um nome fabricado", finalizadoSemNome.finalizedLabel, "03/09");

const finalizadoSemData = resolveMonthlyReportRow({
  status: "finalizado",
  updated_at: "2026-09-03T10:00:00.000Z",
  finalized_at: null,
  finalized_by_profile: { name: "Pedro Mitzakoff" },
});
check("finalizado sem finalized_at (não deveria acontecer, mas nunca quebra): só o nome", finalizadoSemData.finalizedLabel, "Pedro Mitzakoff");

console.log(`\nTodos os ${passed} testes passaram.`);
