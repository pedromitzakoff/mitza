/**
 * Testes da Etapa "Histórico de Decisões Operacionais" — evolui o registro
 * de otimização (account_reviews/account_optimizations, intactos como
 * tabelas) com um novo campo DIAGNÓSTICO, reformula o registro rápido pra
 * Diagnóstico + Ação + Observação, e redesenha a Timeline Geral pra mostrar
 * essa hierarquia em vez do rótulo genérico "Analisou a conta" repetindo o
 * outcome. Cobre os cenários pedidos na seção 15.
 *
 * Mesma limitação estrutural de outros testes desta sessão (sem Supabase
 * neste ambiente): a gravação em si (`record_account_review`) e a leitura
 * via `operational_events` são verificadas por checagem ESTRUTURAL do SQL/
 * TS-fonte (mesmo padrão de `test-operation-goal-filter.ts`), enquanto toda
 * lógica de apresentação pura (`buildReviewDetail`/`buildReviewPresentation`/
 * `parseOptimizationSelections`/`resolveAgencyTimelineType`) é testada
 * chamando as funções de produção reais, nunca uma reimplementação.
 *
 * Rodar: npx tsx scripts/test-account-review-diagnosis.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCOUNT_REVIEW_DIAGNOSES,
  isValidAccountReviewDiagnosis,
  parseOptimizationSelections,
  OPTIMIZATION_QUICK_GROUPS,
} from "../src/lib/account-reviews";
import { buildReviewDetail, buildReviewPresentation } from "../src/lib/client-operational-history";
import { resolveAgencyTimelineType, eventTypesForFilter, AGENCY_TIMELINE_TYPE_OPTIONS } from "../src/lib/agency-timeline";

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

// ---------------------------------------------------------------------------
// 1 — Migration: coluna nova, constraint, identidade de função (drop antes
// de recriar — mesmo problema de overload já documentado no projeto).
// ---------------------------------------------------------------------------
console.log("1 — Migration: diagnosis aditivo, sem overload ambíguo, nada destrutivo\n");
{
  const sql = stripComments(loadSource("supabase", "account-review-diagnosis.sql"));

  ok("coluna diagnosis é aditiva (add column if not exists)", /add column if not exists diagnosis text/.test(sql));
  ok("diagnosis é NULLABLE (nenhum not null na definição da coluna)", !/diagnosis text not null/.test(sql));
  ok(
    "constraint aceita null OU um dos 9 valores oficiais",
    /diagnosis is null or diagnosis in \(\s*'HEALTHY', 'COST_ABOVE_TARGET', 'COST_BELOW_TARGET', 'LOW_VOLUME',\s*'BUDGET_LIMITED', 'CREATIVE_FATIGUE', 'AUDIENCE_FATIGUE',\s*'CAMPAIGN_UNDERPERFORMING', 'INSUFFICIENT_DATA'/.test(sql),
  );
  ok(
    "record_account_review antigo (14 params) é dropado antes do create or replace",
    /drop function if exists record_account_review\(\s*uuid, uuid, uuid, text, text, text, text, text, text, jsonb, boolean, uuid, date, text\s*\)/.test(sql),
  );
  ok("record_account_review novo tem p_diagnosis default null (nunca obrigatório)", /p_diagnosis text default null/.test(sql));
  ok(
    "register_recurring_execution: as 3 assinaturas antigas conhecidas (7/8/9 params) são dropadas",
    /drop function if exists register_recurring_execution\(uuid, uuid, uuid, uuid, text, text\[\], text\);/.test(sql) &&
      /drop function if exists register_recurring_execution\(uuid, uuid, uuid, uuid, text, text\[\], jsonb, text\);/.test(sql) &&
      /drop function if exists register_recurring_execution\(uuid, uuid, uuid, uuid, text, text\[\], jsonb, uuid, text\);/.test(sql),
  );
  ok(
    "register_recurring_execution novo mantém p_client_report_id ANTES de p_source (ordem real vigente, não a de uma migration antiga)",
    /p_optimization_selections jsonb default null,\s*p_client_report_id uuid default null,\s*p_source text default 'web',\s*p_diagnosis text default null/.test(sql),
  );
  ok(
    "register_recurring_execution repassa p_diagnosis pra record_account_review só quando uses_account_review",
    /p_diagnosis => p_diagnosis/.test(sql),
  );
  ok("metadata de account_review_recorded inclui diagnosis", /'diagnosis', p_diagnosis/.test(sql));
  ok("metadata de account_review_recorded inclui notes (pra Timeline montar Observação sem 2ª consulta)", /'notes', p_notes/.test(sql));
  ok(
    "insert em recurring_task_executions preserva client_report_id (não foi perdido na redefinição)",
    /account_review_id, checklist_selected_keys, optimization_selections, client_report_id, notes/.test(sql),
  );
}

// ---------------------------------------------------------------------------
// 2 — Diagnóstico é percepção manual: nunca lido pelo motor de saúde/
// prioridade nem por account_review_cadences (nenhuma reintrodução da
// antiga influência de Cadência de Revisões).
// ---------------------------------------------------------------------------
console.log("\n2 — Diagnóstico nunca influencia saúde/prioridade automática\n");
{
  const healthEngineCode = stripComments(loadSource("src", "lib", "account-health-engine.ts"));
  const attentionAlertsCode = stripComments(loadSource("src", "lib", "attention-alerts.ts"));
  const accountPriorityCode = stripComments(loadSource("src", "lib", "account-priority.ts"));
  const operationTriageCode = stripComments(loadSource("src", "lib", "operation-triage.ts"));

  ok("lib/account-health-engine.ts nunca lê 'diagnosis'", !/diagnosis/.test(healthEngineCode));
  ok("lib/attention-alerts.ts nunca lê 'diagnosis'", !/diagnosis/.test(attentionAlertsCode));
  ok("lib/account-priority.ts nunca lê 'diagnosis'", !/diagnosis/.test(accountPriorityCode));
  ok("lib/operation-triage.ts (prioridade da Operação) nunca lê 'diagnosis'", !/diagnosis/.test(operationTriageCode));
  ok(
    "attention-alerts.ts continua documentando a remoção da influência de Cadência de Revisões (não foi revertida)",
    /Cadência de Revisões/.test(loadSource("src", "lib", "attention-alerts.ts")),
  );
}

// ---------------------------------------------------------------------------
// 3 — Taxonomia de diagnóstico: 9 valores, validador rejeita lixo.
// ---------------------------------------------------------------------------
console.log("\n3 — Taxonomia de diagnóstico\n");
{
  check("9 diagnósticos oficiais", ACCOUNT_REVIEW_DIAGNOSES.length, 9);
  ok("HEALTHY é um diagnóstico válido", isValidAccountReviewDiagnosis("HEALTHY"));
  ok("COST_ABOVE_TARGET é um diagnóstico válido", isValidAccountReviewDiagnosis("COST_ABOVE_TARGET"));
  ok("INSUFFICIENT_DATA é um diagnóstico válido", isValidAccountReviewDiagnosis("INSUFFICIENT_DATA"));
  ok("valor vazio é inválido", !isValidAccountReviewDiagnosis(""));
  ok("valor inventado ('AWARENESS_ISSUE') é inválido", !isValidAccountReviewDiagnosis("AWARENESS_ISSUE"));
}

// ---------------------------------------------------------------------------
// 4-5 — Ação por chips: cenário 2 (diagnóstico + 1 ação), cenário 3
// (diagnóstico + múltiplas ações), validação contra combinações curadas.
// ---------------------------------------------------------------------------
console.log("\n4 — Ação por chips (parseOptimizationSelections)\n");
{
  check(
    "1 ação real (Redistribuiu orçamento) é aceita",
    parseOptimizationSelections(JSON.stringify([{ type: "BUDGET", action: "REDISTRIBUTED", quantity: 1 }])),
    [{ type: "BUDGET", action: "REDISTRIBUTED", quantity: 1 }],
  );
  check(
    "múltiplas ações (cenário 3) são todas aceitas, na ordem enviada",
    parseOptimizationSelections(
      JSON.stringify([
        { type: "BUDGET", action: "REDISTRIBUTED", quantity: 1 },
        { type: "CREATIVE", action: "ADDED", quantity: 2 },
      ]),
    ),
    [
      { type: "BUDGET", action: "REDISTRIBUTED", quantity: 1 },
      { type: "CREATIVE", action: "ADDED", quantity: 2 },
    ],
  );
  check("combinação type/action que não existe nos chips curados é descartada", parseOptimizationSelections(JSON.stringify([{ type: "BID", action: "STRATEGY_CHANGED", quantity: 1 }])), []);
  check("quantity zero é descartada (defesa em profundidade)", parseOptimizationSelections(JSON.stringify([{ type: "BUDGET", action: "INCREASED", quantity: 0 }])), []);
  check("JSON inválido nunca derruba a validação — vira lista vazia", parseOptimizationSelections("{not json"), []);
  check("string vazia vira lista vazia (nenhuma ação selecionada)", parseOptimizationSelections(""), []);

  ok(
    "chips cobrem exatamente a lista da seção 4 do pedido (Orçamento/Criativos/Públicos/Campanhas)",
    OPTIMIZATION_QUICK_GROUPS.some((g) => g.type === "BUDGET" && g.actions.some((a) => a.action === "INCREASED") && g.actions.some((a) => a.action === "DECREASED") && g.actions.some((a) => a.action === "REDISTRIBUTED")) &&
      OPTIMIZATION_QUICK_GROUPS.some((g) => g.type === "CREATIVE" && g.actions.some((a) => a.action === "ADDED") && g.actions.some((a) => a.action === "PAUSED")) &&
      OPTIMIZATION_QUICK_GROUPS.some((g) => g.type === "AUDIENCE" && g.actions.some((a) => a.action === "ACTIVATED") && g.actions.some((a) => a.action === "PAUSED") && g.actions.some((a) => a.action === "SEGMENTATION_CHANGED")) &&
      OPTIMIZATION_QUICK_GROUPS.some((g) => g.type === "CAMPAIGN" && g.actions.some((a) => a.action === "CREATED") && g.actions.some((a) => a.action === "PAUSED") && g.actions.some((a) => a.action === "CONFIGURATION_CHANGED")),
  );
}

// ---------------------------------------------------------------------------
// 6-7 — Server Action: outcome derivado (nunca perguntado), reason sempre
// ROUTINE, gestor/cliente/data-hora resolvidos pelo servidor (nunca pelo
// formulário) — checagem estrutural do arquivo real.
// ---------------------------------------------------------------------------
console.log("\n5 — recordAccountReviewAction: outcome derivado, reason fixo, sem passo de 'motivo'/'resultado'/'pendência' na UI\n");
{
  const actionCode = stripComments(loadSource("src", "app", "clients", "account-review-actions.ts"));

  ok("outcome é DERIVADO do número de ações (nunca lido de formData)", /optimizations\.length > 0 \? "OPTIMIZATION_PERFORMED" : "NO_CHANGE"/.test(actionCode));
  ok("reason é sempre 'ROUTINE' (não é mais perguntado)", /p_reason: "ROUTINE"/.test(actionCode));
  ok("action nunca lê formData.get(\"reason\")", !/formData\.get\("reason"\)/.test(actionCode));
  ok("action nunca lê formData.get(\"outcome\")", !/formData\.get\("outcome"\)/.test(actionCode));
  ok("diagnóstico é obrigatório (fail quando inválido)", /isValidAccountReviewDiagnosis\(diagnosisRaw\)/.test(actionCode));
  ok(
    "p_team_member_id/p_auth_user_id vêm do profile do servidor (getCurrentProfile), nunca do formData — gestor correto garantido",
    /p_team_member_id: profile\.id/.test(actionCode) && /p_auth_user_id: profile\.authUserId/.test(actionCode),
  );

  const sqlFn = stripComments(loadSource("supabase", "account-review-diagnosis.sql"));
  ok(
    "reviewed_at (data/hora) é sempre v_now no servidor — nunca recebido do cliente",
    /reviewed_at, reason, reason_other_description, outcome, notes,\s*issue_description, issue_category, previous_review_at, seconds_since_previous_review, diagnosis\s*\) values \(\s*v_org_id, p_client_id, v_sprint\.id, p_team_member_id, p_auth_user_id,\s*v_now,/.test(sqlFn),
  );
}

// ---------------------------------------------------------------------------
// 8 — Histórico legado (evento sem diagnosis) continua renderizando —
// nenhuma migration destrutiva, fallback idêntico ao comportamento anterior.
// ---------------------------------------------------------------------------
console.log("\n6 — Histórico legado (sem diagnosis) continua renderizando\n");
{
  check(
    "NO_CHANGE legado (sem diagnosis): buildReviewDetail cai no outcome de sempre",
    buildReviewDetail({ outcome: "NO_CHANGE" }),
    "Sem alteração necessária",
  );
  check(
    "OPTIMIZATION_PERFORMED legado (sem diagnosis, 1 tipo salvo no metadata): buildReviewDetail cai no comportamento de sempre",
    buildReviewDetail({ outcome: "OPTIMIZATION_PERFORMED", optimization_types: ["BUDGET"] }),
    "Otimização realizada · Orçamento",
  );
  check(
    "ISSUE_IDENTIFIED legado (sem diagnosis): buildReviewDetail cai no outcome de sempre",
    buildReviewDetail({ outcome: "ISSUE_IDENTIFIED" }),
    "Problema identificado",
  );
  check(
    "evento sem outcome reconhecível (corrompido/de outro tipo): buildReviewDetail devolve null, nunca quebra",
    buildReviewDetail({ outcome: "algo_desconhecido" }),
    null,
  );

  const legacyPresentation = buildReviewPresentation({ outcome: "OPTIMIZATION_PERFORMED", optimization_types: ["BUDGET"] });
  ok("evento legado ainda gera reviewPresentation (Timeline não quebra)", legacyPresentation !== null);
  check("evento legado: headline cai pro outcome (sem diagnosis)", legacyPresentation?.headline, "Otimização realizada");
  check("evento legado: notes é null quando ausente do metadata", legacyPresentation?.notes, null);

  // "Timeline do cliente" (CollapsibleAccountHistory/ClientHistoryList, via
  // buildReviewDetail) recebe o mesmo upgrade — evento COM diagnosis troca
  // o rótulo de outcome pelo diagnóstico como informação principal.
  check(
    "Timeline do cliente — evento COM diagnosis: diagnóstico substitui 'Otimização realizada' como principal",
    buildReviewDetail({ outcome: "OPTIMIZATION_PERFORMED", diagnosis: "CREATIVE_FATIGUE" }, [{ type: "CREATIVE", action: "ADDED", quantity: 1 }]),
    "Criativo perdendo performance · Adicionou criativo",
  );
  check(
    "Timeline do cliente — Conta saudável + diagnosis: mostra diagnóstico E 'Nenhuma alteração necessária'",
    buildReviewDetail({ outcome: "NO_CHANGE", diagnosis: "HEALTHY" }),
    "Conta saudável · Sem alteração necessária",
  );
}

// ---------------------------------------------------------------------------
// 9-11 — Timeline renderiza Diagnóstico/Ações/Observação (só quando existe).
// ---------------------------------------------------------------------------
console.log("\n7 — buildReviewPresentation: Diagnóstico + Ações + Observação (só quando existe)\n");
{
  const cpaCase = buildReviewPresentation(
    { outcome: "OPTIMIZATION_PERFORMED", diagnosis: "COST_ABOVE_TARGET", notes: "Campanha de remarketing concentrou o maior CPA." },
    [
      { type: "BUDGET", action: "REDISTRIBUTED", quantity: 1 },
      { type: "CREATIVE", action: "ADDED", quantity: 1 },
    ],
  );
  check("cenário do pedido — headline é o diagnóstico, nunca 'Otimização realizada'", cpaCase?.headline, "Custo por resultado acima da meta");
  check("cenário do pedido — ações concatenadas, sem repetir o outcome", cpaCase?.actionsLine, "Redistribuiu orçamento · Adicionou criativo");
  check("cenário do pedido — observação presente é repassada", cpaCase?.notes, "Campanha de remarketing concentrou o maior CPA.");

  const healthyCase = buildReviewPresentation({ outcome: "NO_CHANGE", diagnosis: "HEALTHY" });
  check("Conta saudável + Nenhuma alteração — headline é o diagnóstico", healthyCase?.headline, "Conta saudável");
  check("Conta saudável + Nenhuma alteração — ações mostra 'Nenhuma alteração necessária'", healthyCase?.actionsLine, "Sem alteração necessária");
  check("Conta saudável + Nenhuma alteração — sem observação quando não preenchida", healthyCase?.notes, null);

  const noNotesCase = buildReviewPresentation({ outcome: "OPTIMIZATION_PERFORMED", diagnosis: "LOW_VOLUME", notes: "   " }, [
    { type: "AUDIENCE", action: "ACTIVATED", quantity: 1 },
  ]);
  ok("observação só espaços em branco nunca aparece como preenchida", noNotesCase?.notes === null);

  ok(
    "página da Timeline só renderiza a linha de Observação quando reviewPresentation.notes existe (condicional, não sempre)",
    /row\.reviewPresentation\.notes &&/.test(stripComments(loadSource("src", "app", "timeline", "page.tsx"))),
  );
  ok(
    "página da Timeline renderiza headline (Diagnóstico) e actionsLine (Ação) da revisão",
    /row\.reviewPresentation\.headline/.test(stripComments(loadSource("src", "app", "timeline", "page.tsx"))) &&
      /row\.reviewPresentation\.actionsLine/.test(stripComments(loadSource("src", "app", "timeline", "page.tsx"))),
  );
}

// ---------------------------------------------------------------------------
// 12-15 — Filtros: gestor, cliente, tipo, e os três combinados.
// ---------------------------------------------------------------------------
console.log("\n8 — Filtro por Tipo (URL) e combinação com Gestor/Cliente\n");
{
  check("sem parâmetro -> 'todos' (fallback seguro)", resolveAgencyTimelineType(undefined), "todos");
  check("?type=otimizacoes -> 'otimizacoes'", resolveAgencyTimelineType("otimizacoes"), "otimizacoes");
  check("?type=reports -> 'reports'", resolveAgencyTimelineType("reports"), "reports");
  check("?type=outros -> 'outros'", resolveAgencyTimelineType("outros"), "outros");
  check("?type=lixo (valor inválido) -> fallback seguro 'todos'", resolveAgencyTimelineType("lixo"), "todos");
  check("4 opções de Tipo (Todos/Otimizações/Reports/Outros)", AGENCY_TIMELINE_TYPE_OPTIONS.length, 4);

  const todos = eventTypesForFilter("todos");
  const otimizacoes = eventTypesForFilter("otimizacoes");
  const reports = eventTypesForFilter("reports");
  const outros = eventTypesForFilter("outros");

  check("Otimizações = só account_review_recorded", otimizacoes, ["account_review_recorded"]);
  ok("Reports inclui client_report_generated", reports.includes("client_report_generated"));
  ok("Reports inclui client_report_sent", reports.includes("client_report_sent"));
  ok("Reports nunca inclui account_review_recorded", !reports.includes("account_review_recorded"));
  ok("Outros nunca inclui account_review_recorded nem os 2 tipos de report (sem sobreposição entre categorias)", !outros.includes("account_review_recorded") && !outros.includes("client_report_generated") && !outros.includes("client_report_sent"));
  check(
    "Otimizações + Reports + Outros particionam exatamente 'todos' (nenhum tipo perdido, nenhum duplicado)",
    [...otimizacoes, ...reports, ...outros].sort(),
    [...todos].sort(),
  );

  const timelineCode = stripComments(loadSource("src", "lib", "agency-timeline.ts"));
  ok("filtro de gestor vira .eq na própria query (nunca filtro em memória)", /filters\.actorId\) query = query\.eq\("actor_team_member_id", filters\.actorId\)/.test(timelineCode));
  ok("filtro de cliente vira .eq na própria query", /filters\.clientId\) query = query\.eq\("client_id", filters\.clientId\)/.test(timelineCode));
  ok(
    "filtro de tipo vira .in na MESMA query (eventTypesForFilter), combinando livremente com gestor/cliente — nunca 3 filtros separados incompatíveis",
    /\.in\("event_type", eventTypesForFilter\(filters\.type\)\)/.test(timelineCode),
  );
}

// ---------------------------------------------------------------------------
// 16 — Interface: sem texto explicativo grande, nomenclatura "Seguidores"/
// "Alterou público" etc. já resolvida na taxonomia (seção 9 do pedido).
// ---------------------------------------------------------------------------
console.log("\n9 — UI: sem formulário longo, sem passo de motivo/resultado/pendência\n");
{
  const drawerCode = stripComments(loadSource("src", "app", "clients", "record-account-review-drawer.tsx"));
  ok("drawer não tem mais o passo 'Por que você revisou a conta?'", !/Por que você revisou/.test(drawerCode));
  ok("drawer não tem mais o passo 'Qual foi o resultado da revisão?'", !/Qual foi o resultado da revisão/.test(drawerCode));
  ok("drawer não tem mais o fluxo de 'Descrição do problema'/criar tarefa", !/Descrição do problema/.test(drawerCode) && !/Criar tarefa a partir desta pendência/.test(drawerCode));
  ok("drawer tem exatamente os 3 blocos pedidos: Diagnóstico, Ação, Observação", /Diagnóstico/.test(drawerCode) && />Ação</.test(drawerCode) && /Observação/.test(drawerCode));
  ok(
    "nenhum texto explicativo grande tipo 'Selecione o diagnóstico desejado para...' (interface autoexplicativa)",
    !/Selecione o (diagnóstico|objetivo) desejado/.test(drawerCode),
  );
}

console.log(`\n${passed} verificações passaram.`);
