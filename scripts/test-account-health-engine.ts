/**
 * Testes do Motor de Saúde da Conta (`lib/account-health-engine.ts`) — o
 * módulo de maior risco real sem nenhum teste no levantamento "estado geral
 * do sistema": pontuação multi-dimensão (investimento/resultado/custo/
 * revisão/qualidade de dado), a saúde geral é sempre a PIOR dimensão (nunca
 * média/soma ponderada), com ordem de desempate e mensagens específicas por
 * dimensão. Cobre: cada dimensão isoladamente (incluindo os cortes exatos de
 * severidade leve/relevante/grave), os casos "desligado"/"amostra
 * insuficiente" de cada uma, a filosofia "pior dimensão vence" com desempate
 * por prioridade, e `collectAccountHealthReasons`.
 *
 * Rodar: npx tsx scripts/test-account-health-engine.ts
 */
import assert from "node:assert/strict";
import {
  evaluateAccountHealth,
  collectAccountHealthReasons,
  describeSecondaryOperationalContext,
  type AccountHealthInput,
} from "../src/lib/account-health-engine";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

/** Input "tudo limpo": nenhuma dimensão gera desvio nem issue de qualidade —
 * ponto de partida pra isolar UMA dimensão por vez, sobrescrevendo só os
 * campos relevantes do teste. */
function baseInput(overrides: Partial<AccountHealthInput> = {}): AccountHealthInput {
  return {
    investmentActual: 500,
    investmentPlanned: 1000,
    investmentHasSyncedData: true,
    resultActual: 10,
    resultPlanned: 10,
    hasPerformanceData: true,
    performanceGoalConfigured: true,
    costActual: 50,
    costPlanned: 50,
    monthExpectedPct: 50,
    reviewBusinessDaysAgo: 5,
    reviewMaxBusinessDays: 10,
    ...overrides,
  };
}

console.log("Caso base — tudo saudável (sanity check)\n");

{
  const evaluation = evaluateAccountHealth(baseInput());
  check("input totalmente limpo -> healthStatus 'saudavel'", evaluation.healthStatus, "saudavel");
  check("saudavel -> healthScore 100", evaluation.healthScore, 100);
  check("saudavel -> primaryReason genérico, nunca uma dimensão específica", evaluation.primaryReason, "Nenhum sinal de atenção no momento");
  check("saudavel -> primaryDimension null (nenhuma dimensão tem motivo pra ser principal)", evaluation.primaryDimension, null);
  check("todas as 5 dimensões -> status 'nenhum'", Object.values(evaluation.dimensions).map((d) => d.status), ["nenhum", "nenhum", "nenhum", "nenhum", "nenhum"]);
}

console.log("\nDimensão Investimento — desvio ABSOLUTO (acima e abaixo penalizam igual)\n");

{
  // planned=1000, monthExpectedPct=50 -> expected=500 em todos os casos abaixo.
  check("planned=null -> 'nenhum', deviation null (nunca avalia sem plano)", evaluateAccountHealth(baseInput({ investmentPlanned: null })).dimensions.investment, {
    status: "nenhum",
    deviation: null,
    actual: 500,
    planned: null,
    expected: null,
    hasSyncedData: true,
  });
  check("deviation exatamente 0.15 (borda) -> 'nenhum' (precisa ser MAIOR que o corte)", evaluateAccountHealth(baseInput({ investmentActual: 575 })).dimensions.investment.status, "nenhum");
  check("deviation 0.16 -> 'leve'", evaluateAccountHealth(baseInput({ investmentActual: 580 })).dimensions.investment.status, "leve");
  check("deviation exatamente 0.30 (borda) -> ainda 'leve'", evaluateAccountHealth(baseInput({ investmentActual: 650 })).dimensions.investment.status, "leve");
  check("deviation 0.31 -> 'relevante'", evaluateAccountHealth(baseInput({ investmentActual: 655 })).dimensions.investment.status, "relevante");
  check("deviation exatamente 0.50 (borda) -> ainda 'relevante'", evaluateAccountHealth(baseInput({ investmentActual: 750 })).dimensions.investment.status, "relevante");
  check("deviation 0.51 -> 'grave'", evaluateAccountHealth(baseInput({ investmentActual: 755 })).dimensions.investment.status, "grave");
  check("deviation -0.50 (investiu MENOS que o esperado) -> 'relevante', mesma magnitude que +0.50", evaluateAccountHealth(baseInput({ investmentActual: 250 })).dimensions.investment.status, "relevante");
  check("motivo do desvio acima descreve a direção certa", evaluateAccountHealth(baseInput({ investmentActual: 755 })).dimensions.investment.deviation, 0.51);
}

console.log("\nDimensão Resultado — só desvio ABAIXO do esperado penaliza\n");

{
  // planned=1000, monthExpectedPct=50 -> expected=500.
  check("performanceGoalConfigured=false -> 'nenhum' mesmo com resultado péssimo", evaluateAccountHealth(baseInput({ performanceGoalConfigured: false, resultPlanned: 1000, resultActual: 0 })).dimensions.results.status, "nenhum");
  check("resultPlanned=null -> 'nenhum'", evaluateAccountHealth(baseInput({ resultPlanned: null })).dimensions.results.status, "nenhum");
  check(
    "resultado 200% ACIMA do esperado -> 'nenhum' (superar meta nunca é penalizado, por maior que seja)",
    evaluateAccountHealth(baseInput({ resultPlanned: 1000, resultActual: 1500 })).dimensions.results.status,
    "nenhum",
  );
  check("deviation exatamente -0.15 (borda) -> 'nenhum'", evaluateAccountHealth(baseInput({ resultPlanned: 1000, resultActual: 425 })).dimensions.results.status, "nenhum");
  check("deviation -0.16 (abaixo do esperado) -> 'leve'", evaluateAccountHealth(baseInput({ resultPlanned: 1000, resultActual: 420 })).dimensions.results.status, "leve");
  check("deviation -0.31 -> 'relevante'", evaluateAccountHealth(baseInput({ resultPlanned: 1000, resultActual: 345 })).dimensions.results.status, "relevante");
  check("deviation -0.51 -> 'grave'", evaluateAccountHealth(baseInput({ resultPlanned: 1000, resultActual: 245 })).dimensions.results.status, "grave");
  check(
    "motivo cita só a magnitude abaixo, nunca 'acima' (resultado é sempre unidirecional)",
    evaluateAccountHealth(baseInput({ resultPlanned: 1000, resultActual: 245 })).primaryReason,
    "Resultado 51% abaixo do esperado",
  );
}

console.log("\nDimensão Custo por Resultado — 'menor é melhor', só desvio ACIMA da meta penaliza\n");

{
  check("costPlanned=null -> 'nenhum', hasReliableSample=true (falta de dado, não de amostra)", evaluateAccountHealth(baseInput({ costPlanned: null })).dimensions.cost, {
    status: "nenhum",
    deviation: null,
    actual: 50,
    planned: null,
    expected: null,
    sampleSize: 10,
    hasReliableSample: true,
    hasComparableScope: true,
  });
  check("costActual=null -> 'nenhum', hasReliableSample=true", evaluateAccountHealth(baseInput({ costActual: null })).dimensions.cost.hasReliableSample, true);
  check(
    "resultActual=2 (< MIN_RELIABLE_RESULT_COUNT=3), custo 3x acima da meta -> 'nenhum' mesmo assim (ausência de evidência nunca é performance ruim)",
    evaluateAccountHealth(baseInput({ resultActual: 2, costPlanned: 100, costActual: 300 })).dimensions.cost.status,
    "nenhum",
  );
  check("amostra insuficiente -> hasReliableSample=false", evaluateAccountHealth(baseInput({ resultActual: 2, costPlanned: 100, costActual: 300 })).dimensions.cost.hasReliableSample, false);
  check(
    "custo 50% ABAIXO da meta (mais barato que o previsto) -> 'nenhum' (nunca penaliza custo melhor que a meta)",
    evaluateAccountHealth(baseInput({ costPlanned: 100, costActual: 50 })).dimensions.cost.status,
    "nenhum",
  );
  check("deviation exatamente 0.10 (borda) -> 'nenhum'", evaluateAccountHealth(baseInput({ costPlanned: 100, costActual: 110 })).dimensions.cost.status, "nenhum");
  check("deviation 0.11 -> 'leve'", evaluateAccountHealth(baseInput({ costPlanned: 100, costActual: 111 })).dimensions.cost.status, "leve");
  check("deviation exatamente 0.30 (borda) -> ainda 'leve'", evaluateAccountHealth(baseInput({ costPlanned: 100, costActual: 130 })).dimensions.cost.status, "leve");
  check("deviation 0.31 -> 'relevante'", evaluateAccountHealth(baseInput({ costPlanned: 100, costActual: 131 })).dimensions.cost.status, "relevante");
  check("deviation exatamente 0.50 (borda) -> ainda 'relevante'", evaluateAccountHealth(baseInput({ costPlanned: 100, costActual: 150 })).dimensions.cost.status, "relevante");
  check("deviation 0.51 -> 'grave'", evaluateAccountHealth(baseInput({ costPlanned: 100, costActual: 151 })).dimensions.cost.status, "grave");
}

console.log(
  "\nCusto por Resultado — costScopeComparable (Etapa 'Comparabilidade de Escopo de Custo', Parte 3): escopo divergente nunca vira severidade\n",
);

{
  // Mesmo desvio grave de sempre (0.51, custo 151 vs meta 100) — a única
  // diferença é `costScopeComparable: false`. Continua travado em 'nenhum',
  // mesmo padrão de `hasReliableSample=false`: ausência de uma base
  // COMPARÁVEL nunca é tratada como desempenho ruim.
  const evaluation = evaluateAccountHealth(baseInput({ costPlanned: 100, costActual: 151, costScopeComparable: false }));
  check("escopo divergente -> status 'nenhum', nunca 'grave' mesmo com desvio de 51%", evaluation.dimensions.cost.status, "nenhum");
  check("escopo divergente -> deviation nunca chega a ser calculado (null, não escondido)", evaluation.dimensions.cost.deviation, null);
  check("escopo divergente -> hasReliableSample continua true (não é problema de amostra)", evaluation.dimensions.cost.hasReliableSample, true);
  check("escopo divergente -> hasComparableScope false", evaluation.dimensions.cost.hasComparableScope, false);
  check(
    "motivo é semanticamente 'sem base comparável', nunca um percentual de desvio",
    evaluation.primaryReason,
    "Custo por resultado sem base comparável — planejamento e realizado não cobrem os mesmos canais",
  );
  check("healthStatus não sobe por causa de um diagnóstico de custo que nem chegou a existir", evaluation.healthStatus, "saudavel");
}

{
  // costScopeComparable omitido (não passado) -> preserva o comportamento
  // de sempre (default true) — nenhum chamador existente que ainda não
  // sabe calcular isso quebra ou muda de resultado.
  const evaluation = evaluateAccountHealth(baseInput({ costPlanned: 100, costActual: 151 }));
  check("costScopeComparable omitido -> default true, comportamento de sempre preservado", evaluation.dimensions.cost.status, "grave");
  check("costScopeComparable omitido -> hasComparableScope true", evaluation.dimensions.cost.hasComparableScope, true);
}

{
  // costScopeComparable explicitamente true -> idêntico a omitir.
  const evaluation = evaluateAccountHealth(baseInput({ costPlanned: 100, costActual: 111, costScopeComparable: true }));
  check("costScopeComparable=true explícito -> thresholds de sempre, sem nenhuma mudança", evaluation.dimensions.cost.status, "leve");
}

{
  // Amostra insuficiente E escopo divergente ao mesmo tempo -> amostra vence
  // (checada primeiro), mesmo resultado final ('nenhum'), mas o motivo
  // reflete a causa mais fundamental. `resultPlanned: 2` (expected=1 com
  // monthExpectedPct=50) mantém a dimensão de Resultado em 'nenhum'
  // (resultActual=1 bate exatamente o esperado) — isola só o comportamento
  // de `cost` que este teste quer comprovar, sem a dimensão de resultado
  // nem `dataQuality` competindo pelo motivo principal.
  const evaluation = evaluateAccountHealth(
    baseInput({ resultPlanned: 2, resultActual: 1, costPlanned: 100, costActual: 300, costScopeComparable: false }),
  );
  check("amostra insuficiente + escopo divergente -> ainda 'nenhum'", evaluation.dimensions.cost.status, "nenhum");
  check("amostra insuficiente vence a checagem (ordem preservada) -> motivo é o de amostra, não o de escopo", evaluation.dimensions.cost.hasReliableSample, false);
  check("primaryReason cita amostra, não escopo, quando os dois problemas coexistem", evaluation.primaryReason, "Aguardando amostra suficiente para avaliar custo (1 de 3 resultados)");
}

console.log("\nDimensão Revisão — nunca revisada é sempre o pior caso; cadência desativada não participa\n");

{
  check("reviewMaxBusinessDays=null (cadência desativada) -> 'nenhum', enabled=false, mesmo sem nunca ter revisado", evaluateAccountHealth(baseInput({ reviewMaxBusinessDays: null, reviewBusinessDaysAgo: null })).dimensions.review, {
    status: "nenhum",
    deviation: null,
    actual: null,
    planned: 0,
    expected: 0,
    enabled: false,
  });
  check("reviewBusinessDaysAgo=null com cadência ativa -> sempre 'grave', independente do prazo configurado", evaluateAccountHealth(baseInput({ reviewBusinessDaysAgo: null, reviewMaxBusinessDays: 5 })).dimensions.review.status, "grave");
  check("nunca revisada -> motivo específico, nunca um percentual", evaluateAccountHealth(baseInput({ reviewBusinessDaysAgo: null })).primaryReason, "Nenhuma revisão registrada ainda");
  check("revisada ANTES do prazo (folga grande) -> 'nenhum' (revisar cedo nunca penaliza)", evaluateAccountHealth(baseInput({ reviewBusinessDaysAgo: 1, reviewMaxBusinessDays: 10 })).dimensions.review.status, "nenhum");
  check("revisada EXATAMENTE no prazo -> 'nenhum' (ainda não está atrasada)", evaluateAccountHealth(baseInput({ reviewBusinessDaysAgo: 10, reviewMaxBusinessDays: 10 })).dimensions.review.status, "nenhum");
  check(
    "1 dia útil além do prazo -> já conta como 'leve' (REVIEW_OVERDUE_LEVE=0, qualquer atraso conta)",
    evaluateAccountHealth(baseInput({ reviewBusinessDaysAgo: 11, reviewMaxBusinessDays: 10 })).dimensions.review.status,
    "leve",
  );
  check("deviation exatamente 0.50 (borda, 50% além do prazo) -> ainda 'leve'", evaluateAccountHealth(baseInput({ reviewBusinessDaysAgo: 15, reviewMaxBusinessDays: 10 })).dimensions.review.status, "leve");
  check("deviation 0.60 -> 'relevante'", evaluateAccountHealth(baseInput({ reviewBusinessDaysAgo: 16, reviewMaxBusinessDays: 10 })).dimensions.review.status, "relevante");
  check("deviation exatamente 1.0 (borda, o dobro do prazo) -> ainda 'relevante'", evaluateAccountHealth(baseInput({ reviewBusinessDaysAgo: 20, reviewMaxBusinessDays: 10 })).dimensions.review.status, "relevante");
  check("deviation 1.1 (mais que o dobro do prazo) -> 'grave'", evaluateAccountHealth(baseInput({ reviewBusinessDaysAgo: 21, reviewMaxBusinessDays: 10 })).dimensions.review.status, "grave");
}

console.log("\nDimensão Qualidade dos Dados — binária ('nenhum' ou 'grave'), nunca parcial\n");

{
  check(
    "investmentPlanned=null (recorte consolidado) -> issue 'Planejamento mensal não definido'",
    evaluateAccountHealth(baseInput({ investmentPlanned: null })).dimensions.dataQuality,
    { status: "grave", issues: ["Planejamento mensal não definido"] },
  );
  check(
    "investmentPlanned definido mas sem sincronização -> issue de sincronização, não de planejamento",
    evaluateAccountHealth(baseInput({ investmentHasSyncedData: false })).dimensions.dataQuality,
    { status: "grave", issues: ["Sem sincronização de investimento este mês"] },
  );
  check(
    "recorte por canal + investmentPlanned=null -> NUNCA gera issue (ausência de plano por canal é esperada, não lacuna)",
    evaluateAccountHealth(baseInput({ evaluationScope: "channel", investmentPlanned: null })).dimensions.dataQuality,
    { status: "nenhum", issues: [] },
  );
  check(
    "recorte por canal + sem sincronização -> ainda gera issue (isso não é exclusividade do consolidado)",
    evaluateAccountHealth(baseInput({ evaluationScope: "channel", investmentHasSyncedData: false })).dimensions.dataQuality,
    { status: "grave", issues: ["Sem sincronização de investimento este mês"] },
  );
  check(
    "performanceGoalConfigured=false -> só UMA issue (nunca também reclama de meta/dado/custo — ramo 'else' inteiro é pulado)",
    evaluateAccountHealth(baseInput({ performanceGoalConfigured: false, resultPlanned: null, hasPerformanceData: false, costPlanned: null })).dimensions.dataQuality,
    { status: "grave", issues: ["Objetivo de performance não configurado"] },
  );
  check(
    "resultPlanned=null (consolidado, objetivo configurado) -> issue 'Meta de resultado não definida'",
    evaluateAccountHealth(baseInput({ resultPlanned: null })).dimensions.dataQuality,
    { status: "grave", issues: ["Meta de resultado não definida"] },
  );
  check(
    "recorte por canal + resultPlanned=null -> NUNCA gera essa issue (meta de resultado também só existe no consolidado)",
    evaluateAccountHealth(baseInput({ evaluationScope: "channel", resultPlanned: null })).dimensions.dataQuality,
    { status: "nenhum", issues: [] },
  );
  check(
    "hasPerformanceData=false -> issue 'Sem dados de performance registrados este mês'",
    evaluateAccountHealth(baseInput({ hasPerformanceData: false })).dimensions.dataQuality,
    { status: "grave", issues: ["Sem dados de performance registrados este mês"] },
  );
  check(
    "costPlanned=null -> issue 'Meta de custo não definida'",
    evaluateAccountHealth(baseInput({ costPlanned: null })).dimensions.dataQuality,
    { status: "grave", issues: ["Meta de custo não definida"] },
  );
  check(
    "3 lacunas simultâneas -> issues acumula TODAS, na ordem investimento -> resultado -> performance -> custo",
    evaluateAccountHealth(baseInput({ investmentPlanned: null, resultPlanned: null, costPlanned: null })).dimensions.dataQuality,
    { status: "grave", issues: ["Planejamento mensal não definido", "Meta de resultado não definida", "Meta de custo não definida"] },
  );
}

console.log("\nFilosofia central: saúde geral é sempre a PIOR dimensão, nunca média/soma\n");

{
  // grave (investimento) + leve (revisão) -> geral é 'acao_necessaria' (grave), não uma média.
  const evaluation = evaluateAccountHealth(baseInput({ investmentActual: 755, reviewBusinessDaysAgo: 11 }));
  check("uma dimensão grave entre outras leves -> healthStatus reflete a PIOR (grave), nunca dilui", evaluation.healthStatus, "acao_necessaria");
  check("acao_necessaria -> healthScore 25", evaluation.healthScore, 25);
  check("em_risco (relevante) -> healthScore 50", evaluateAccountHealth(baseInput({ investmentActual: 655 })).healthScore, 50);
  check("em_acompanhamento (leve) -> healthScore 75", evaluateAccountHealth(baseInput({ investmentActual: 580 })).healthScore, 75);
}

console.log("\nDesempate de severidade: ordem de prioridade fixa (qualidade > custo > resultado > investimento > revisão)\n");

{
  // Custo E Investimento ambos 'grave' -> Custo vence (prioridade maior), nunca a ordem de definição do objeto.
  const evaluation = evaluateAccountHealth(baseInput({ investmentActual: 755, costPlanned: 100, costActual: 151 }));
  check("custo e investimento ambos 'grave' -> Custo vence o desempate (prioridade > Investimento)", evaluation.primaryDimension, "cost");
  check("motivo reflete a dimensão vencedora do desempate", evaluation.primaryReason, "Custo por resultado 51% acima da meta");
}

{
  // Sem empate real aqui — só reforça que "pior dimensão vence" já elege
  // Qualidade (grave) sobre Custo (relevante) antes mesmo de chegar no
  // desempate por prioridade (esse vem no próximo caso).
  const evaluation = evaluateAccountHealth(baseInput({ resultPlanned: null, costPlanned: 100, costActual: 131 }));
  check("qualidade dos dados (grave) é mais severa que custo (relevante) -> Qualidade vence, sem precisar de desempate", evaluation.primaryDimension, "dataQuality");
}

{
  // Qualidade dos dados 'grave' + Investimento TAMBÉM 'grave' -> Qualidade vence por prioridade, não por ser citada primeiro no objeto por acaso.
  const evaluation = evaluateAccountHealth(baseInput({ resultPlanned: null, investmentActual: 755 }));
  check("qualidade dos dados e investimento ambos 'grave' -> Qualidade vence (primeira na ordem de prioridade)", evaluation.primaryDimension, "dataQuality");
  check("motivo é o da qualidade dos dados, não o do investimento", evaluation.primaryReason, "Meta de resultado não definida");
}

console.log("\nCaso sutil: 'saudavel' pode ainda ter um motivo específico (amostra de custo insuficiente)\n");

{
  // Tudo limpo, MAS custo com amostra insuficiente — não conta como severidade
  // ('nenhum'), mas o motivo ainda é comunicado (comentário explícito no
  // código: "o motivo ainda é comunicado ao gestor, só não conta como
  // severidade"). Único jeito de badgeStatus continuar 'saudavel' e
  // primaryReason ainda assim citar uma dimensão específica.
  const evaluation = evaluateAccountHealth(baseInput({ resultPlanned: 2, resultActual: 2, costPlanned: 40, costActual: 50, reviewMaxBusinessDays: null }));
  check("healthStatus continua 'saudavel' (amostra insuficiente não é severidade)", evaluation.healthStatus, "saudavel");
  check("mas primaryReason cita a amostra insuficiente de custo, não o texto genérico", evaluation.primaryReason, "Aguardando amostra suficiente para avaliar custo (2 de 3 resultados)");
  check("primaryDimension aponta 'cost' mesmo com status 'saudavel'", evaluation.primaryDimension, "cost");
}

console.log("\ncollectAccountHealthReasons — todas as issues ativas, ordenadas por severidade\n");

{
  // grave (dataQuality) + grave (investimento) + leve (custo) -> ordenado por
  // severidade desc; empate entre os dois 'grave' resolvido pela MESMA ordem
  // de prioridade de primaryDimension (nunca uma ordem diferente).
  const evaluation = evaluateAccountHealth(
    baseInput({ investmentActual: 755, resultPlanned: null, costPlanned: 100, costActual: 111 }),
  );
  const reasons = collectAccountHealthReasons(evaluation);
  check("3 motivos ativos, ordenados: grave (qualidade) -> grave (investimento) -> leve (custo)", reasons, [
    "Meta de resultado não definida",
    "Investimento 51% acima do esperado",
    "Custo por resultado 11% acima da meta",
  ]);
  check("reasons[0] é SEMPRE igual a primaryReason (mesmo critério de desempate)", reasons[0], evaluation.primaryReason);
}

{
  const evaluation = evaluateAccountHealth(baseInput());
  check("nenhum motivo ativo -> lista vazia (nunca inclui o texto genérico 'saudavel')", collectAccountHealthReasons(evaluation), []);
}

console.log(
  "\ndescribeSecondaryOperationalContext — achado P0 da auditoria: 'Sem dados' não esconde mais uma dimensão operacional já avaliada\n",
);

{
  // Caso 1: dataQuality grave (sem meta de resultado) + investment grave
  // (755, mesmo caso do teste de desempate acima) -> balde continua 'Sem
  // dados' (primaryDimension não muda), mas o contexto secundário expõe o
  // motivo de investimento já calculado.
  const evaluation = evaluateAccountHealth(baseInput({ resultPlanned: null, investmentActual: 755 }));
  check("Caso 1 — primaryDimension continua 'dataQuality' (classificação principal não muda)", evaluation.primaryDimension, "dataQuality");
  check("Caso 1 — healthStatus continua 'acao_necessaria' (nada na severidade geral mudou)", evaluation.healthStatus, "acao_necessaria");
  check(
    "Caso 1 — contexto secundário mostra o motivo de investimento, já produzido pela própria dimensão",
    describeSecondaryOperationalContext(evaluation),
    "Investimento 51% acima do esperado",
  );
}

{
  // Caso 2: dataQuality grave (sem planejamento) + results relevante
  // (-0.31, mesmo corte do teste de Resultado acima) -> contexto secundário
  // mostra o motivo de resultado.
  const evaluation = evaluateAccountHealth(baseInput({ investmentPlanned: null, resultPlanned: 1000, resultActual: 345 }));
  check("Caso 2 — primaryDimension continua 'dataQuality'", evaluation.primaryDimension, "dataQuality");
  check(
    "Caso 2 — contexto secundário mostra o motivo de resultado (relevante)",
    describeSecondaryOperationalContext(evaluation),
    "Resultado 31% abaixo do esperado",
  );
}

{
  // Caso 3: dataQuality grave (sem planejamento) + todas as outras 'nenhum'
  // (input limpo, só sem plano) -> nenhuma dimensão passa de 'leve', sem
  // segunda linha.
  const evaluation = evaluateAccountHealth(baseInput({ investmentPlanned: null }));
  check("Caso 3 — primaryDimension 'dataQuality'", evaluation.primaryDimension, "dataQuality");
  check(
    "Caso 3 — todas as outras dimensões 'nenhum' -> nenhum contexto secundário",
    describeSecondaryOperationalContext(evaluation),
    null,
  );
}

{
  // Reforço do Caso 3: dimensão 'leve' sozinha também não deve aparecer
  // (o pedido é explícito: leve é ruído, não sinal) — investment em 'leve'
  // (580, mesmo corte do teste de Investimento acima), dataQuality grave
  // por falta de meta de resultado.
  const evaluation = evaluateAccountHealth(baseInput({ resultPlanned: null, investmentActual: 580 }));
  check("dataQuality grave + investment 'leve' -> primaryDimension ainda 'dataQuality'", evaluation.primaryDimension, "dataQuality");
  check("dimensão só 'leve' nunca aparece como contexto secundário (evita ruído)", describeSecondaryOperationalContext(evaluation), null);
}

{
  // Caso 4: conta Crítica "normal" (primaryDimension='cost', nenhuma issue
  // de dataQuality) -> comportamento idêntico a antes desta etapa, função
  // nova sempre null quando dataQuality não é a dimensão principal.
  const evaluation = evaluateAccountHealth(baseInput({ investmentActual: 755, costPlanned: 100, costActual: 151 }));
  check("Caso 4 — primaryDimension 'cost' (dataQuality nunca entrou nisso)", evaluation.primaryDimension, "cost");
  check("Caso 4 — describeSecondaryOperationalContext null quando a dimensão principal não é dataQuality", describeSecondaryOperationalContext(evaluation), null);
}

{
  // Caso 5: conta Saudável -> comportamento idêntico a antes desta etapa.
  const evaluation = evaluateAccountHealth(baseInput());
  check("Caso 5 — healthStatus 'saudavel'", evaluation.healthStatus, "saudavel");
  check("Caso 5 — describeSecondaryOperationalContext null numa conta saudável", describeSecondaryOperationalContext(evaluation), null);
}

{
  // Empate: cost E investment ambos 'grave' ao mesmo tempo que dataQuality
  // vence a classificação principal -> o desempate reaproveita a MESMA
  // DIMENSION_PRIORITY_ORDER do motor (cost antes de investment), nunca uma
  // ordem nova — mesmo padrão já coberto no teste de desempate de
  // primaryDimension acima, agora pro contexto secundário.
  const evaluation = evaluateAccountHealth(
    baseInput({ resultPlanned: null, investmentActual: 755, costPlanned: 100, costActual: 151 }),
  );
  check("empate cost/investment ambos 'grave' -> primaryDimension continua 'dataQuality'", evaluation.primaryDimension, "dataQuality");
  check(
    "empate resolvido pela mesma ordem de prioridade do motor (cost antes de investment) -> contexto secundário é o de custo",
    describeSecondaryOperationalContext(evaluation),
    "Custo por resultado 51% acima da meta",
  );
}

console.log(`\n${passed} verificações passaram.`);
