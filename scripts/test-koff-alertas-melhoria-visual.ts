/**
 * Testes da melhoria visual da aba "Alertas" (pedido do usuário): abas
 * com contagem (substituem o Kanban), card mais compacto com valor
 * observado/previsto/diferença em destaque + contexto do mês, priorização
 * por maior desvio absoluto em reais, ações "Em acompanhamento"/
 * "Resolvido" direto no card, atalho pra editar orçamento.
 *
 * `compareAlertsByPriority`/`countAlertsByStatus` são puras — testadas
 * com chamada direta. O resto (orquestração/UI, dependentes de Supabase/
 * React) é verificado estruturalmente via grep de código-fonte, mesmo
 * padrão já usado pelas suites anteriores desta aba.
 *
 * Rodar: npx tsx scripts/test-koff-alertas-melhoria-visual.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareAlertsByPriority, countAlertsByStatus, type SortableAlert } from "../src/lib/alerts/alert-list-view";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

function alert(overrides: Partial<SortableAlert>): SortableAlert {
  return { severity: "atencao", diffReais: null, lastEvaluatedAt: "2026-11-17T12:00:00.000Z", ...overrides };
}

// ---------------------------------------------------------------------------
console.log("\nA — compareAlertsByPriority: gravidade > desvio absoluto em reais > data\n");
{
  const critico = alert({ severity: "critico", diffReais: 10 });
  const atencao = alert({ severity: "atencao", diffReais: 10000 });
  ok("crítico sempre antes de atenção, não importa o tamanho do desvio", compareAlertsByPriority(critico, atencao) < 0);

  const bigOverspend = alert({ severity: "critico", diffReais: 1000 });
  const bigUnderspend = alert({ severity: "critico", diffReais: -1500 });
  ok(
    "dentro da MESMA gravidade, o MAIOR desvio absoluto vem primeiro — mesmo sendo 'abaixo' (sinal negativo)",
    compareAlertsByPriority(bigUnderspend, bigOverspend) < 0,
  );

  const small = alert({ severity: "critico", diffReais: 50 });
  const sortedBySign = [small, bigOverspend].sort(compareAlertsByPriority);
  ok("o sinal nunca entra na ordenação, só o valor absoluto (+R$1000 vem antes de +R$50)", sortedBySign[0] === bigOverspend);

  const older = alert({ severity: "critico", diffReais: 500, lastEvaluatedAt: "2026-11-10T08:00:00.000Z" });
  const newer = alert({ severity: "critico", diffReais: 500, lastEvaluatedAt: "2026-11-17T08:00:00.000Z" });
  ok("desvio absoluto empatado -> desempate pela data mais recente primeiro", compareAlertsByPriority(newer, older) < 0);

  const noDiff = alert({ severity: "critico", diffReais: null });
  const withDiff = alert({ severity: "critico", diffReais: 5 });
  ok(
    "alerta sem diffReais (tipo futuro, ou alerta antigo sem essa métrica) vai pro FIM da sua faixa de gravidade, nunca antes de um com desvio conhecido",
    compareAlertsByPriority(withDiff, noDiff) < 0,
  );
}

// ---------------------------------------------------------------------------
console.log("\nB — countAlertsByStatus: sempre as 3 situações, mesmo com 0\n");
{
  const counts = countAlertsByStatus([
    { status: "precisa_atencao" },
    { status: "precisa_atencao" },
    { status: "acompanhamento" },
  ]);
  ok("contagem correta por situação", counts.precisa_atencao === 2 && counts.acompanhamento === 1 && counts.resolvido === 0);
  ok("'resolvido' aparece com 0, nunca omitido do objeto", "resolvido" in counts);
}

// ---------------------------------------------------------------------------
console.log("\nC — page.tsx/alerts-tabs.tsx: abas substituem o Kanban, 'Precisa de atenção' é o padrão\n");
{
  const pageSource = loadSource("src", "app", "alerts", "page.tsx");
  const tabsSource = loadSource("src", "app", "alerts", "alerts-tabs.tsx");

  ok("page.tsx não importa mais AlertsBoard/Kanban", !pageSource.includes("AlertsBoard") && !pageSource.includes("alerts-board"));
  ok("page.tsx usa AlertsTabs", pageSource.includes("<AlertsTabs"));
  ok(
    "aba ativa default é 'precisa_atencao' quando ?aba= não é 'acompanhamento'/'resolvido'",
    pageSource.includes('params.aba === "acompanhamento" || params.aba === "resolvido" ? params.aba : "precisa_atencao"'),
  );
  ok(
    "estado vazio tem uma frase CURTA e DIFERENTE pra cada uma das 3 abas (nunca a mesma frase genérica)",
    pageSource.includes("Nenhum alerta precisa de atenção agora.") &&
      pageSource.includes("Nenhum alerta em acompanhamento.") &&
      pageSource.includes("Nenhum alerta resolvido ainda."),
  );
  ok("as abas mostram contagem ao lado do rótulo", tabsSource.includes("({counts[tab]})"));
  ok("'Resolvidos' no plural (pedido), as outras mantêm o rótulo do Status Registry", tabsSource.includes('"Resolvidos"'));
}

// ---------------------------------------------------------------------------
console.log("\nD — alerts-filters.tsx: só cliente/gravidade/tipo, 'Situação' saiu (virou aba)\n");
{
  const filtersSource = loadSource("src", "app", "alerts", "alerts-filters.tsx");
  ok("filtro 'Situação' (<select> de status) foi removido — select de Situação não existe mais", !filtersSource.includes("Situação: todas"));
  ok("filtros continuam preservando a ABA ativa na URL ao trocar cliente/gravidade/tipo", filtersSource.includes('params.set("aba", activeTab)'));
}

// ---------------------------------------------------------------------------
console.log("\nE — alerts-data.ts: contexto do mês, diffReais, compatibilidade com alertas antigos\n");
{
  const dataSource = loadSource("src", "app", "alerts", "alerts-data.ts");
  ok(
    "diffReais/monthActual/monthExpectedToDate extraídos de `detail` com guarda de tipo (nunca quebra num alerta antigo sem essas chaves)",
    dataSource.includes('typeof detail.diffReais === "number"') &&
      dataSource.includes('typeof detail.monthActual === "number"') &&
      dataSource.includes('typeof detail.monthExpectedToDate === "number"'),
  );
  ok("busca TODAS as situações de uma vez (nunca filtra por status na query) — contagem das 3 abas vem do mesmo fetch", !dataSource.includes('query.eq("status"'));
  ok("usa compareAlertsByPriority/countAlertsByStatus (núcleo puro), nunca uma ordenação duplicada aqui", dataSource.includes("compareAlertsByPriority") && dataSource.includes("countAlertsByStatus"));
}

// ---------------------------------------------------------------------------
console.log("\nF — evaluate-spend-pace.ts: contexto 'mês até aqui' gravado em detail, janela cobre o mês inteiro\n");
{
  const evalSource = loadSource("src", "lib", "alerts", "evaluate-spend-pace.ts");
  ok(
    "reaproveita a MESMA função canônica de 'Esperado até hoje' (nunca uma 2ª implementação da divisão orçamento÷dias)",
    evalSource.includes("computeMonthlyExpectedToDateByCalendar"),
  );
  ok(
    "monthExpectedToDate é null quando não há orçamento mensal configurado (nunca fabrica uma referência)",
    /monthlyBudget !== null && monthlyBudget > 0\s*\n\s*\? computeMonthlyExpectedToDateByCalendar/.test(evalSource),
  );
  ok("janela de busca cobre o início do mês (nunca só os 14 dias de histórico, que ficaria curta depois do dia 15)", evalSource.includes("monthToDateWindowStart"));
  ok("contexto do mês é gravado em candidate.detail, nunca interfere na SEVERIDADE/detecção (critérios preservados)", evalSource.includes("candidate.detail = { ...candidate.detail, monthActual, monthExpectedToDate, monthlyBudget }"));
}

// ---------------------------------------------------------------------------
console.log("\nG — alert-card.tsx: card compacto, valor em destaque, detalhes recolhidos, ações à vista\n");
{
  const cardSource = loadSource("src", "app", "alerts", "alert-card.tsx");

  ok("valor observado/previsto aparecem com 'gastos'/'previstos' (formato do pedido)", cardSource.includes("gastos ·") && cardSource.includes("previstos"));
  ok("diferença em reais usa sinal explícito (+/-) preservado na exibição", cardSource.includes("formatSignedCurrency"));
  ok("contexto do mês só aparece quando monthActual E monthExpectedToDate existem (nunca um 0 fabricado)", cardSource.includes("hasMonthContext"));
  ok("explicação do cálculo foi movida pra dentro de <details> (nunca mais sempre visível)", /<details[^>]*>[\s\S]*Ver detalhes do cálculo[\s\S]*<\/details>/.test(cardSource));
  ok("badge de status (precisa de atenção/em acompanhamento/resolvido) saiu do card — a ABA já diz a situação", !cardSource.includes("ALERT_STATUS_BADGE_CLASSES[alert.status]"));
  ok("'Dado parcial' sinaliza dia em andamento, sem comparar com previsão até o mesmo horário (não existe referência intradiária confiável)", cardSource.includes("Dado parcial"));
  ok("'Em acompanhamento' mostra responsável e próxima checagem quando preenchidos", cardSource.includes("Responsável:") && cardSource.includes("Próxima checagem:"));
  ok("'Resolvido' preserva quem resolveu e quando, ou sinaliza resolução automática", cardSource.includes("Resolvido automaticamente"));
  ok("atalho 'Editar orçamento' aponta pra tela de Metas já existente (nunca uma ação automática de ajuste)", cardSource.includes('buildWorkspaceHref(alert.clientId, "/metas", null)') && cardSource.includes("Editar orçamento"));
  ok("ações 'Em acompanhamento'/'Resolvido' aparecem direto no card (AlertActionButtons), nunca atrás de um menu", cardSource.includes("<AlertActionButtons"));
  ok("'Ver cliente'/'Ver campanhas' preservados", cardSource.includes("Ver cliente") && cardSource.includes("Ver campanhas"));
}

// ---------------------------------------------------------------------------
console.log("\nH — alert-action-buttons.tsx: 2 botões inline (nunca mais um menu '•••'), nomeados pelo estado\n");
{
  const actionsSource = loadSource("src", "app", "alerts", "alert-action-buttons.tsx");
  ok("nunca mais um <details>/<summary> de menu kebab (virou botões inline)", !actionsSource.includes("<details") && !actionsSource.includes("<summary"));
  ok("botões nomeados 'Em acompanhamento'/'Resolvido' (mesmo vocabulário das abas/badges)", actionsSource.includes(">\n            Em acompanhamento") || actionsSource.includes("Em acompanhamento\n          </button>"));
  ok("cor de cada botão reaproveita a MESMA classe do badge de status (nunca uma paleta nova)", actionsSource.includes("ALERT_STATUS_BADGE_CLASSES.acompanhamento") && actionsSource.includes("ALERT_STATUS_BADGE_CLASSES.resolvido"));
  ok("botão 'Resolvido' menciona o atalho de editar orçamento pra aumento planejado, sem disparar o ajuste automaticamente", actionsSource.includes("ajuste de orçamento é sempre uma ação separada e explícita"));
}

console.log(`\n${passed} verificações OK.\n`);
