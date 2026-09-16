/**
 * Testes da Etapa "Comunicação de Conquistas" — mensagem pronta pra copiar e
 * enviar direto ao cliente (`achievement-messages.ts`), sem tocar em
 * detecção/thresholds/amostra/Destaque/Evolução/cap/granularidade/cron/
 * persistência/filtros (intocados nesta etapa, cobertos por
 * `test-achievements-granularity.ts`/`test-achievement-backfill.ts`).
 *
 * Mesmo padrão dos demais testes desta sessão: fixtures em memória chamando
 * a função de produção real (`buildClientMessage`), mais checagem ESTRUTURAL
 * do código-fonte pra garantir que o botão de copiar só recebe a mensagem
 * (nunca nome do cliente/metadados) e que o drawer não perdeu nenhuma seção
 * técnica existente.
 *
 * Rodar: npx tsx scripts/test-achievement-messages.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildClientMessage } from "../src/lib/achievement-messages";
import { formatCurrency, formatPercent } from "../src/lib/format";
import type { AchievementRow } from "../src/lib/achievements-data";
import type { AchievementMetricSnapshot } from "../src/lib/achievement-types";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n");
}

function baseRow(overrides: Partial<AchievementRow>): AchievementRow {
  return {
    id: "evt-1",
    occurredAt: "2026-08-19T12:00:00-03:00",
    detectedAt: "2026-08-20T11:30:00Z",
    scope: "client",
    family: "consistencia",
    severity: "highlight",
    type: "client_consistency_cpa_below_target",
    clientId: "c1",
    clientName: "Leonardo Darcadia",
    clientPerformanceGoal: null,
    actorTeamMemberId: null,
    actorTeamMemberName: null,
    level: "account",
    entityName: null,
    headline: "7 dias consecutivos abaixo da meta de CPA",
    detail: "CPA de R$ 29,17 · Meta R$ 33,33",
    metric: null,
    source: null,
    ...overrides,
  };
}

const CLIENT_NAME = "Leonardo Darcadia";

// ---------------------------------------------------------------------------
// 1 — Consistência (conta)
// ---------------------------------------------------------------------------
console.log("1 — Mensagem de Consistência (conta)\n");
{
  const metric: AchievementMetricSnapshot = { metric: "cpa", actual: 29.17, unit: "currency", target: 33.33, streakDays: 7 };
  const row = baseRow({ type: "client_consistency_cpa_below_target", family: "consistencia", clientPerformanceGoal: "sales", metric });
  const message = buildClientMessage(row);
  const expected = `Ótimo resultado nos últimos dias! 🚀\n\nCompletamos 7 dias consecutivos com o CPA abaixo da meta. No período, ficamos em ${formatCurrency(29.17)} por venda, contra uma meta de ${formatCurrency(33.33)}.`;
  check("mensagem de consistência (sales) usa CPA/venda com os números reais", message, expected);

  const noTargetRow = baseRow({ type: "client_consistency_cpa_below_target", clientPerformanceGoal: "sales", metric: { metric: "cpa", actual: 29.17, unit: "currency", streakDays: 7 } });
  const degraded = buildClientMessage(noTargetRow);
  ok("sem meta configurada (legado), mensagem degrada sem inventar o número da meta", degraded !== null && !degraded.includes("contra uma meta"));
}

// ---------------------------------------------------------------------------
// 2 — Evolução (conta) — leads usa CPL
// ---------------------------------------------------------------------------
console.log("\n2 — Mensagem de Evolução (conta) — leads usa CPL\n");
{
  const metric: AchievementMetricSnapshot = { metric: "cpa", actual: 26.49, unit: "currency", comparisonActual: 33.44 };
  const row = baseRow({ type: "client_evolution_cpa_improved", family: "evolucao", clientPerformanceGoal: "leads", metric });
  const message = buildClientMessage(row);
  const pct = (33.44 - 26.49) / 33.44;
  const expected = `Boa evolução de performance nos últimos 7 dias! 📈\n\nO CPL caiu ${formatPercent(pct * 100)}, saindo de ${formatCurrency(33.44)} para ${formatCurrency(26.49)} no período atual.`;
  check("mensagem de evolução (leads) usa CPL, nunca CPA", message, expected);
  ok("mensagem de evolução nunca escreve CPA numa conta de leads", !message!.includes("CPA"));
}

// ---------------------------------------------------------------------------
// 3 — Escala (conta)
// ---------------------------------------------------------------------------
console.log("\n3 — Mensagem de Escala (conta)\n");
{
  const metric: AchievementMetricSnapshot = { metric: "investment", actual: 1250, unit: "currency", comparisonActual: 1000, target: 30, sampleResultCount: 70 };
  const row = baseRow({ type: "client_scale_investment_growth_with_efficiency", family: "escala", clientPerformanceGoal: "sales", metric });
  const message = buildClientMessage(row);
  const derivedCpa = 1250 / 70;
  const expected = `Conseguimos aumentar o investimento mantendo uma boa eficiência. 🚀\n\nO investimento cresceu ${formatPercent(25)} e o CPA permaneceu dentro da meta, em ${formatCurrency(derivedCpa)} frente à meta de ${formatCurrency(30)}.`;
  check("mensagem de escala reconstrói o CPA real (investimento/resultados) sem número inventado", message, expected);
}

// ---------------------------------------------------------------------------
// 4 — Meta mensal (conta)
// ---------------------------------------------------------------------------
console.log("\n4 — Mensagem de Meta mensal (conta) — leads usa 'leads'\n");
{
  const overMetric: AchievementMetricSnapshot = { metric: "result_count", actual: 185, unit: "count", target: 148 };
  const overRow = baseRow({ type: "client_goal_monthly_result_reached", family: "metas", clientPerformanceGoal: "leads", metric: overMetric });
  const overMessage = buildClientMessage(overRow);
  check(
    "meta superada (125%) mostra o percentual acima e a contagem em 'leads'",
    overMessage,
    `Superamos a meta do mês! 🚀\n\n185 leads no mês, ${formatPercent(25)} acima da meta de 148.`,
  );

  const exactMetric: AchievementMetricSnapshot = { metric: "result_count", actual: 150, unit: "count", target: 150 };
  const exactRow = baseRow({ type: "client_goal_monthly_result_reached", family: "metas", clientPerformanceGoal: "leads", metric: exactMetric });
  check("meta atingida exatamente (100%) não inventa um percentual acima", buildClientMessage(exactRow), `Batemos a meta do mês! 🚀\n\n150 leads no mês, atingindo a meta de 150.`);
}

// ---------------------------------------------------------------------------
// 5 — Recorde (conta)
// ---------------------------------------------------------------------------
console.log("\n5 — Mensagem de Recorde (conta)\n");
{
  const metric: AchievementMetricSnapshot = { metric: "cpa", actual: 25, unit: "currency", comparisonActual: 30 };
  const row = baseRow({ type: "client_record_best_cpa_week", family: "recordes", severity: "record", clientPerformanceGoal: "sales", metric });
  const message = buildClientMessage(row);
  check(
    "mensagem de recorde de CPA usa os valores reais da semana e da marca anterior",
    message,
    `Novo recorde por aqui! 🚀\n\nTivemos a melhor semana de CPA da nossa história: ${formatCurrency(25)} na semana, superando a marca anterior de ${formatCurrency(30)}.`,
  );
}

// ---------------------------------------------------------------------------
// 6 — Recuperação (conta)
// ---------------------------------------------------------------------------
console.log("\n6 — Mensagem de Recuperação (conta)\n");
{
  const metric: AchievementMetricSnapshot = { metric: "cpa", actual: 28, unit: "currency", target: 30 };
  const row = baseRow({ type: "client_recovery_cpa_back_within_target", family: "recuperacao", clientPerformanceGoal: "sales", metric });
  check(
    "mensagem de recuperação mostra o CPA real de volta à meta",
    buildClientMessage(row),
    `Voltamos a performar dentro da meta! 🚀\n\nO CPA voltou a ${formatCurrency(28)}, abaixo da meta de ${formatCurrency(30)}, após um período fora da meta.`,
  );

  const legacyRow = baseRow({ type: "client_recovery_cpa_back_within_target", clientPerformanceGoal: "sales", metric: { metric: "cpa", actual: 28, unit: "currency" } });
  check(
    "evento legado sem meta registrada degrada pra frase sem número inventado",
    buildClientMessage(legacyRow),
    `Voltamos a performar dentro da meta! 🚀\n\nO CPA voltou a ficar dentro da meta após um período fora dela.`,
  );
}

// ---------------------------------------------------------------------------
// 7/8 — Campanha: Destaque e Evolução
// ---------------------------------------------------------------------------
console.log("\n7/8 — Campanha: Destaque e Evolução\n");
{
  const destaqueMetric: AchievementMetricSnapshot = { metric: "cpa", actual: 20, unit: "currency", comparisonActual: 30, sampleResultCount: 5 };
  const destaqueRow = baseRow({
    type: "campaign_destaque_best_cpa",
    family: "destaque",
    level: "campaign",
    entityName: "Prospecção",
    clientPerformanceGoal: "sales",
    metric: destaqueMetric,
  });
  const destaqueMessage = buildClientMessage(destaqueRow);
  const advantagePct = (30 - 20) / 30;
  check(
    "mensagem de Destaque de campanha cita o nome da campanha e os números reais",
    destaqueMessage,
    `Uma das campanhas se destacou nos últimos dias! 🚀\n\nA campanha "Prospecção" gerou 5 vendas com CPA de ${formatCurrency(20)}, ${formatPercent(advantagePct * 100)} mais eficiente que as demais campanhas analisadas.`,
  );

  const evolutionMetric: AchievementMetricSnapshot = { metric: "cpa", actual: 22.46, unit: "currency", comparisonActual: 31.2 };
  const evolutionRow = baseRow({
    type: "campaign_evolution_cpa_improved",
    family: "evolucao",
    level: "campaign",
    entityName: "Prospecção | Meta",
    clientPerformanceGoal: "sales",
    metric: evolutionMetric,
  });
  const evolutionMessage = buildClientMessage(evolutionRow);
  const improvementPct = (31.2 - 22.46) / 31.2;
  check(
    "mensagem de Evolução de campanha cita o nome da campanha e os números reais",
    evolutionMessage,
    `Boa evolução em uma das campanhas! 📈\n\nA campanha "Prospecção | Meta" reduziu o CPA em ${formatPercent(improvementPct * 100)}, saindo de ${formatCurrency(31.2)} para ${formatCurrency(22.46)} nos últimos 7 dias.`,
  );
}

// ---------------------------------------------------------------------------
// 9/10 — Público: Destaque e Evolução
// ---------------------------------------------------------------------------
console.log("\n9/10 — Público: Destaque e Evolução\n");
{
  const destaqueMetric: AchievementMetricSnapshot = { metric: "cpa", actual: 6, unit: "currency", comparisonActual: 8, sampleResultCount: 32 };
  const destaqueRow = baseRow({
    type: "ad_set_destaque_best_cpa",
    family: "destaque",
    level: "ad_set",
    entityName: "Paulínia + 10 km",
    clientPerformanceGoal: "leads",
    metric: destaqueMetric,
  });
  const destaqueMessage = buildClientMessage(destaqueRow);
  ok("mensagem de Destaque de público não usa emoji (mesmo tom do exemplo aprovado)", destaqueMessage !== null && !/[\u{1F300}-\u{1FAFF}]/u.test(destaqueMessage));
  ok('mensagem de Destaque de público cita o nome do público entre aspas', destaqueMessage!.includes('"Paulínia + 10 km"'));
  ok("mensagem de Destaque de público (leads) usa CPL, nunca CPA", destaqueMessage!.includes("CPL") && !destaqueMessage!.includes("CPA"));

  const evolutionMetric: AchievementMetricSnapshot = { metric: "cpa", actual: 6.5, unit: "currency", comparisonActual: 9 };
  const evolutionRow = baseRow({
    type: "ad_set_evolution_cpa_improved",
    family: "evolucao",
    level: "ad_set",
    entityName: "Interesse Amplo",
    clientPerformanceGoal: "leads",
    metric: evolutionMetric,
  });
  const evolutionMessage = buildClientMessage(evolutionRow);
  ok("mensagem de Evolução de público abre com o tom certo (📈)", evolutionMessage !== null && evolutionMessage.startsWith("Boa evolução em um dos públicos! 📈"));
  ok('mensagem de Evolução de público cita o nome do público entre aspas', evolutionMessage!.includes('"Interesse Amplo"'));
}

// ---------------------------------------------------------------------------
// 11/12 — Criativo: Destaque e Evolução
// ---------------------------------------------------------------------------
console.log("\n11/12 — Criativo: Destaque e Evolução\n");
{
  const destaqueMetric: AchievementMetricSnapshot = { metric: "cpa", actual: 8, unit: "currency", comparisonActual: 10, sampleResultCount: 18 };
  const destaqueRow = baseRow({
    type: "creative_destaque_best_cpa",
    family: "destaque",
    level: "creative",
    entityName: "Advogado 03",
    clientPerformanceGoal: "leads",
    metric: destaqueMetric,
  });
  const destaqueMessage = buildClientMessage(destaqueRow);
  check(
    "mensagem de Destaque de criativo bate com o exemplo aprovado (18 leads · CPL · % de vantagem)",
    destaqueMessage,
    `Temos um novo destaque entre os criativos! 🚀\n\nO criativo "Advogado 03" gerou 18 leads com CPL de ${formatCurrency(8)}, ${formatPercent(20)} mais eficiente que os demais criativos analisados.`,
  );

  const evolutionMetric: AchievementMetricSnapshot = { metric: "cpa", actual: 7, unit: "currency", comparisonActual: 10 };
  const evolutionRow = baseRow({
    type: "creative_evolution_cpa_improved",
    family: "evolucao",
    level: "creative",
    entityName: "Depoimento 02",
    clientPerformanceGoal: "leads",
    metric: evolutionMetric,
  });
  const evolutionMessage = buildClientMessage(evolutionRow);
  check(
    "mensagem de Evolução de criativo cita o nome do criativo e os números reais",
    evolutionMessage,
    `Boa evolução em um dos criativos! 📈\n\nO criativo "Depoimento 02" reduziu o CPL em ${formatPercent(30)}, saindo de ${formatCurrency(10)} para ${formatCurrency(7)} nos últimos 7 dias.`,
  );
}

// ---------------------------------------------------------------------------
// 13 — Followers usa "custo por novo seguidor"/"seguidores"
// ---------------------------------------------------------------------------
console.log("\n13 — Followers usa custo por novo seguidor / seguidores\n");
{
  const evolutionMetric: AchievementMetricSnapshot = { metric: "cpa", actual: 12, unit: "currency", comparisonActual: 15 };
  const evolutionRow = baseRow({ type: "client_evolution_cpa_improved", family: "evolucao", clientPerformanceGoal: "followers", metric: evolutionMetric });
  const evolutionMessage = buildClientMessage(evolutionRow);
  ok("conta de seguidores usa 'Custo por novo seguidor' (nunca CPA/CPL)", evolutionMessage !== null && evolutionMessage.includes("Custo por novo seguidor") && !/\bCPA\b|\bCPL\b/.test(evolutionMessage));

  const recordMetric: AchievementMetricSnapshot = { metric: "result_count", actual: 50, unit: "count", comparisonActual: 40 };
  const recordRow = baseRow({ type: "client_record_best_results_week", family: "recordes", severity: "record", clientPerformanceGoal: "followers", metric: recordMetric });
  const recordMessage = buildClientMessage(recordRow);
  ok("recorde de resultados numa conta de seguidores fala em 'novos seguidores'", recordMessage !== null && recordMessage.includes("novos seguidores"));
}

// ---------------------------------------------------------------------------
// 14 — Nome do cliente NUNCA aparece na mensagem copiável
// ---------------------------------------------------------------------------
console.log("\n14 — Nome do cliente nunca aparece na mensagem copiável\n");
{
  const fixtures: AchievementRow[] = [
    baseRow({ type: "client_consistency_cpa_below_target", clientPerformanceGoal: "sales", metric: { metric: "cpa", actual: 10, unit: "currency", target: 15, streakDays: 7 } }),
    baseRow({
      type: "campaign_destaque_best_cpa",
      family: "destaque",
      level: "campaign",
      entityName: "Campanha X",
      clientPerformanceGoal: "leads",
      metric: { metric: "cpa", actual: 5, unit: "currency", comparisonActual: 10, sampleResultCount: 10 },
    }),
  ];
  for (const row of fixtures) {
    const message = buildClientMessage(row);
    ok(`mensagem (${row.type}) não contém o nome do cliente ("${CLIENT_NAME}")`, message !== null && !message.includes(CLIENT_NAME));
    ok(`mensagem (${row.type}) não contém o id interno do evento`, message !== null && !message.includes(row.id));
    ok(`mensagem (${row.type}) não contém o código da família ("${row.family}")`, message !== null && !message.toLowerCase().includes(row.family));
  }
}

// ---------------------------------------------------------------------------
// 15 — Fallback seguro pra histórico
// ---------------------------------------------------------------------------
console.log("\n15 — Fallback seguro para eventos antigos / dados incompletos\n");
{
  check("evento sem metric nenhum (legado extremo) não gera mensagem (nunca quebra)", buildClientMessage(baseRow({ metric: null })), null);

  check(
    "escopo agência nunca gera mensagem (mensagem é só pra escopo cliente)",
    buildClientMessage(baseRow({ scope: "agency", metric: { metric: "count", actual: 10, unit: "count" } })),
    null,
  );
  check(
    "escopo pessoa nunca gera mensagem",
    buildClientMessage(baseRow({ scope: "person", metric: { metric: "count", actual: 10, unit: "count" } })),
    null,
  );

  check(
    "tipo de conquista desconhecido (nunca visto) não gera mensagem — cai pro texto técnico existente",
    buildClientMessage(baseRow({ type: "client_some_future_type_not_yet_supported", metric: { metric: "cpa", actual: 10, unit: "currency" } })),
    null,
  );

  check(
    "Evolução sem comparisonActual (evento antigo incompleto) não inventa a comparação",
    buildClientMessage(baseRow({ type: "client_evolution_cpa_improved", metric: { metric: "cpa", actual: 10, unit: "currency" } })),
    null,
  );

  check(
    "Destaque de sub-entidade sem entityName (dado corrompido) não gera mensagem sem nome pra citar",
    buildClientMessage(
      baseRow({
        type: "campaign_destaque_best_cpa",
        family: "destaque",
        level: "campaign",
        entityName: null,
        metric: { metric: "cpa", actual: 10, unit: "currency", comparisonActual: 15, sampleResultCount: 5 },
      }),
    ),
    null,
  );

  const row1 = baseRow({ type: "client_consistency_cpa_below_target", clientPerformanceGoal: "sales", metric: { metric: "cpa", actual: 10, unit: "currency", target: 15, streakDays: 7 } });
  check("mesma entrada sempre produz a mesma mensagem (determinístico, sem chamada de LLM)", buildClientMessage(row1), buildClientMessage(row1));
}

// ---------------------------------------------------------------------------
// 16 — Botão copiar: copia exatamente a mensagem, nada além disso
// ---------------------------------------------------------------------------
console.log("\n16 — Botão 'Copiar mensagem' — só a mensagem, nunca metadado interno\n");
{
  const buttonCode = stripComments(loadSource("src", "app", "achievements", "copy-message-button.tsx"));
  ok("componente recebe só `message: string` como prop (nenhum outro dado do evento)", /\{\s*message\s*\}:\s*\{\s*message:\s*string\s*\}/.test(buttonCode));
  ok("clipboard recebe exatamente `message`, nunca uma string montada com outros campos", /navigator\.clipboard\.writeText\(message\)/.test(buttonCode));
  ok("componente nunca referencia nome do cliente/tags/data/metadados (clientName, level, type, family, occurredAt)", !/clientName|\blevel\b|achievement_type|\bfamily\b|occurredAt/.test(buttonCode));
  ok("feedback é o texto discreto 'Copiado' (sem modal)", /"Copiado"/.test(buttonCode) && !/Modal|Dialog/.test(buttonCode));

  const feedCode = stripComments(loadSource("src", "app", "achievements", "achievements-feed.tsx"));
  ok("feed só mostra o botão de copiar quando existe clientMessage (nunca nos eventos sem mensagem segura)", /\{clientMessage &&[\s\S]*CopyMessageButton/.test(feedCode));

  const drawerCode = stripComments(loadSource("src", "app", "achievements", "achievement-detail-drawer.tsx"));
  ok("drawer também oferece o botão de copiar quando há mensagem", /CopyMessageButton message=\{clientMessage\}/.test(drawerCode));
}

// ---------------------------------------------------------------------------
// 17 — Drawer preserva TODOS os dados técnicos existentes (auditoria)
// ---------------------------------------------------------------------------
console.log("\n17 — Drawer continua com todos os dados técnicos (auditoria intacta)\n");
{
  const drawerCode = stripComments(loadSource("src", "app", "achievements", "achievement-detail-drawer.tsx"));
  for (const title of ["Período analisado", "Comparação", "Meta", "Dados que formaram o indicador", "Histórico considerado", "Sequência", "Origem", "Quando"]) {
    ok(`drawer ainda tem a seção técnica "${title}"`, drawerCode.includes(title));
  }
  ok("drawer ainda mostra o headline técnico no cabeçalho (auditoria, nunca substituído)", /achievement\.headline/.test(drawerCode));
}

// ---------------------------------------------------------------------------
// 18 — Nenhuma chamada de LLM/API pra gerar mensagem (determinístico)
// ---------------------------------------------------------------------------
console.log("\n18 — Nenhuma chamada de LLM/API — templates determinísticos\n");
{
  const messagesCode = stripComments(loadSource("src", "lib", "achievement-messages.ts"));
  ok("achievement-messages.ts nunca faz fetch/chamada de rede", !/fetch\(|anthropic|openai/i.test(messagesCode));
}

console.log(`\n${passed} verificações passaram.`);
