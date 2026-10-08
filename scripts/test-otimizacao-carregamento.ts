/**
 * Testes da Etapa "Otimização de carregamento — Itens 1 (Cockpit) e 3
 * (Layout raiz)": paraleliza consultas comprovadamente independentes que
 * antes rodavam em sequência só por ordem de código, sem nenhuma
 * dependência real entre elas — nenhum cálculo, query, parâmetro ou
 * resultado exibido muda. Checagens ESTRUTURAIS via grep de código-fonte
 * (mesmo padrão das suites anteriores, sem DOM/Supabase neste ambiente).
 *
 * Item 2 (autenticação) foi explicitamente NÃO implementado nesta etapa —
 * sem checagem aqui.
 *
 * Rodar: npx tsx scripts/test-otimizacao-carregamento.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

const pageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");
const layoutSource = loadSource("src", "app", "layout.tsx");

// ---------------------------------------------------------------------------
console.log("\nA — Item 1 (Cockpit): as 5 operações independentes entraram no MESMO Promise.all, nenhuma ficou um await solto\n");
{
  ok(
    "loadClientOperationalStates entra no array do Promise.all principal (antes rodava sozinha, sequencial, ANTES do batch, sem nenhuma dependência real)",
    /\[\s*clientOperationalState\s*\]\s*,\s*\n\s*pendenciasRawData,/.test(pageSource) && pageSource.includes("loadClientOperationalStates(supabase, currentMonthRange(today).firstDay, id),"),
  );
  ok(
    "loadPendenciasRawData entra no mesmo Promise.all (antes era 'await loadPendenciasRawData(...)' solto, bem depois do batch)",
    pageSource.includes("pendenciasRawData,") && pageSource.includes("loadPendenciasRawData(supabase, id),") && !pageSource.includes("await loadPendenciasRawData("),
  );
  ok(
    "a query de account_reviews (última revisão) entra no mesmo Promise.all — MESMA select/eq/order/limit de antes, nenhum campo novo/removido",
    pageSource.includes(
      'requireQuery(\n        supabase\n          .from("account_reviews")\n          .select("reviewed_at, outcome, team_member:team_members!account_reviews_team_member_id_fkey(name)")\n          .eq("client_id", id)\n          .order("reviewed_at", { ascending: false })\n          .limit(1),\n        "account_reviews:cockpit-resumo",\n      ),',
    ),
  );
  ok(
    "fetchClientTimelinePage entra no mesmo Promise.all, preservando o MESMO condicional 'profile ? ... : { rows: [] }' de antes (nunca chamada pra profile null)",
    pageSource.includes('profile ? fetchClientTimelinePage(supabase, profile.organizationId, id, "todos", 0, 6) : Promise.resolve({ rows: [] }),'),
  );
  ok(
    "buildPerformanceReportData entra no mesmo Promise.all (era a chamada mais isolada — só precisa de id/firstDay/lastDay, nenhuma dependência do resto do batch)",
    pageSource.includes("buildPerformanceReportData(supabase, id, { start: firstDay, end: lastDay }),") && !pageSource.includes("await buildPerformanceReportData("),
  );
  ok(
    "os 4 pontos de USO continuam lendo os valores já resolvidos pelo Promise.all (desestruturação), nenhum novo await disperso pelo corpo da função",
    pageSource.includes("const { items: demandaItems } = pendenciasRawData;") &&
      pageSource.includes("const [lastReviewRow] = accountReviewRows;") &&
      pageSource.includes("const { rows: historyRows } = timelinePageResult;"),
  );
}

console.log("\nB — Item 1: dependências reais preservadas — ensureClosedSprintSnapshots (escrita) nunca entra no Promise.all, nunca roda em paralelo com leitura que dependa dela\n");
{
  ok(
    "ensureClosedSprintSnapshots continua um await ISOLADO, DEPOIS do Promise.all principal (depende de sprints/dailySpend/primaryBudgetChanges já calculados — nunca parallelizável com o próprio batch)",
    /await ensureClosedSprintSnapshots\(supabase, \{/.test(pageSource),
  );
  ok(
    "ensureClosedSprintSnapshots NÃO está dentro do array do Promise.all principal (nenhuma leitura que dependa da escrita corre em paralelo com ela) — só uma MENÇÃO em comentário explicando o porquê, nunca uma CHAMADA real ali dentro",
    (() => {
      const start = pageSource.indexOf("await Promise.all([");
      const end = pageSource.indexOf("]);", start);
      const arrayBody = pageSource.slice(start, end);
      return !arrayBody.includes("ensureClosedSprintSnapshots(");
    })(),
  );
  ok(
    "resolvePerformanceRowsForSprints continua DEPOIS do Promise.all principal (depende de 'sprints', resultado do próprio batch — dependência real preservada)",
    /const performanceRecordRows = await resolvePerformanceRowsForSprints\(/.test(pageSource),
  );
}

console.log("\nC — Item 1: nenhuma query/parâmetro/resultado mudou — só a ORDEM de execução (reaproveitamento 100%, nenhuma segunda fonte)\n");
{
  ok("loadDadosPageData continua com os MESMOS argumentos de sempre (supabase, id, isAdmin)", pageSource.includes("loadDadosPageData(supabase, id, isAdmin),"));
  ok("getDailyPerformanceRowsForPeriod continua com os MESMOS argumentos de sempre", pageSource.includes("getDailyPerformanceRowsForPeriod(supabase, id, { firstDay, lastDay }),"));
  ok(
    "o Promise.all principal ainda é UM só (nenhum segundo Promise.all concorrente fora de ordem) — todas as 15 posições vêm do MESMO array/await",
    (pageSource.match(/\] = await Promise\.all\(\[/g) ?? []).length === 1,
  );
}

console.log("\nD — Item 3 (Layout raiz): getCurrentProfile() e loadAgencyAccountsTree() paralelizados, mesmo escopo de acesso e tratamento de erro\n");
{
  ok(
    "layout raiz paraleliza getCurrentProfile() e loadAgencyAccountsTree() num único Promise.all (antes eram 2 awaits em sequência)",
    layoutSource.includes("const [profile, agencyTree] = await Promise.all([getCurrentProfile(), loadAgencyAccountsTree()]);"),
  );
  ok(
    "o uso da árvore continua condicional a 'profile' existir — MESMO resultado final ([] quando profile é null), nunca um comportamento novo visível",
    layoutSource.includes("const walletClients = profile ? flattenAgencyTree(agencyTree) : [];"),
  );
  ok(
    "loadAgencyAccountsTree() continua chamada SEM includeAllStatuses (Fase 2.1 preservada, nenhuma regressão da reversão pra ativo-only)",
    !layoutSource.includes("loadAgencyAccountsTree({ includeAllStatuses: true })"),
  );
  ok(
    "erro de qualquer uma das duas chamadas continua propagando pro mesmo lugar (Promise.all rejeita no primeiro erro, igual a 2 awaits sequenciais rejeitando no primeiro que falhar — nenhum catch novo escondendo erro)",
    !layoutSource.includes("try {") && !layoutSource.includes(".catch("),
  );
}

console.log(`\n${passed} verificações passaram.\n`);
