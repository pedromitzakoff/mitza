/**
 * Testes da Etapa "Filtro global respeita tudo" — achado real do usuário
 * (conta Helping Hand, filtro "contém: M.A", 15-21/11): Leads batiam
 * exatamente com o Meta (1.253 = 1.253), mas Investimento não (R$38.222,59
 * no sistema vs R$37.540,73 no Meta) — o card de Orçamento mostrava
 * deliberadamente o CLIENTE INTEIRO, ignorando o filtro de campanha ativo
 * (decisão de uma etapa anterior: "orçamentos e metas globais não devem
 * ser apresentados como metas do subconjunto filtrado"). Pedido explícito
 * do usuário, depois de entender a causa: "quando colocar o filtro de
 * contém eu quero que tudo seja atualizado, incluindo o investimento...
 * Todo dashboard inteiro deve respeitar o filtro que estiver sendo usado,
 * se não vou confundir meu cliente."
 *
 * Os cards de Resultado/Custo por resultado (CPL/CPA/etc.) JÁ respeitavam
 * o filtro desde a Etapa "Filtro global de performance" — confirmado por
 * leitura de código, não precisou de mudança nesta etapa.
 *
 * Cobre:
 *  A. `cockpit-view-data.ts`: `headline.monthActual` sob filtro soma só
 *     `filteredExplorationCampaigns` (as campanhas que batem o filtro),
 *     nunca o cliente inteiro.
 *  B. `monthPlanned`/`monthExpectedToDate`/`monthStatus`/`neededDailyRate`
 *     ficam suprimidos sob filtro (mesma razão de sempre: não existe uma
 *     fração do orçamento mensal "pertencente" a um recorte de campanhas —
 *     comparar actual filtrado com meta do cliente inteiro seria o MESMO
 *     erro, só invertido).
 *  C. `cockpit-meta-ritmo-section.tsx`: nota trocou de "cliente inteiro,
 *     não filtrado" pra "escopo filtrado por campanha"; a composição
 *     "Planejado" (edição do plano real) NUNCA zera sob filtro — lê
 *     `realMonthPlanned`, não `headline.monthPlanned`.
 *  D. Wiring: `cockpit-view.tsx` deriva `realMonthPlanned` da MESMA fonte
 *     (`model.budget.channels`) já usada por `DashboardBudget`, nenhuma
 *     consulta nova.
 *
 * Rodar: npx tsx scripts/test-koff-filtro-respeita-investimento.ts
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

const viewDataSource = loadSource("src", "lib", "cockpit-view-data.ts");
const sectionSource = loadSource("src", "app", "clients", "cockpit-meta-ritmo-section.tsx");
const viewSource = loadSource("src", "app", "clients", "cockpit-view.tsx");

// ---------------------------------------------------------------------------
console.log("\nA — cockpit-view-data.ts: headline.monthActual soma só as campanhas filtradas sob filtro\n");
{
  ok(
    "filteredCampaignInvestment soma totalSpend das campanhas JÁ filtradas (filteredExplorationCampaigns, nenhuma consulta nova)",
    viewDataSource.includes("const filteredCampaignInvestment = filteredExplorationCampaigns.reduce((sum, c) => sum + c.totalSpend, 0);"),
  );
  ok(
    "headline usa filteredCampaignInvestment quando cockpitFilter.isActive, nunca o cliente inteiro (monthActualForHeadline) nesse caso",
    /headline: cockpitFilter\.isActive\s*\?\s*\{\s*monthActual: filteredCampaignInvestment/.test(viewDataSource),
  );
}

console.log("\nB — Planejamento mensal suprimido sob filtro (mesma razão da seção 3 do pedido: nunca comparar filtrado com meta do cliente inteiro)\n");
{
  ok(
    "monthPlanned/monthExpectedToDate/neededDailyRate zerados/null sob filtro",
    /monthPlanned: 0, monthExpectedToDate: 0, monthStatus: "sem_meta", neededDailyRate: null/.test(viewDataSource),
  );
  ok(
    "fora do filtro, continua usando os valores reais de sempre (nenhuma mudança de comportamento pro caso comum)",
    viewDataSource.includes("{ monthActual: monthActualForHeadline, monthPlanned, monthExpectedToDate, monthStatus, neededDailyRate: budgetNeededDailyRate }"),
  );
}

console.log("\nC — cockpit-meta-ritmo-section.tsx: nota e composição 'Planejado'\n");
{
  ok("nota trocou de 'cliente inteiro, não filtrado' pra 'escopo filtrado por campanha'", sectionSource.includes("· escopo filtrado por campanha") && !sectionSource.includes("· cliente inteiro, não filtrado"));
  ok(
    "estado vazio (sem planejamento) ganhou uma 3ª frase específica pra quando o filtro está ativo",
    sectionSource.includes('isGlobalFilterActive ? "Sem comparação com meta — escopo filtrado por campanha."'),
  );
  ok(
    "DashboardBudget (composição 'Planejado', edição do plano real) lê realMonthPlanned — NUNCA headline.monthPlanned (que vira 0 sob filtro)",
    sectionSource.includes("<DashboardBudget clientId={clientId} monthParam={monthParam} total={realMonthPlanned} channels={channels} canEdit={canEdit} compact />"),
  );
  ok("realMonthPlanned é uma prop obrigatória nova (nunca opcional — sempre precisa vir de uma fonte real)", sectionSource.includes("realMonthPlanned: number;"));
}

console.log("\nD — Wiring: cockpit-view.tsx deriva realMonthPlanned da MESMA fonte que DashboardBudget já usa\n");
{
  ok(
    "realMonthPlanned = soma de model.budget.channels[].planned — mesma fonte que já alimenta a composição por canal, nenhuma consulta nova",
    viewSource.includes("realMonthPlanned={model.budget.channels.reduce((sum, c) => sum + (c.planned ?? 0), 0)}"),
  );
}

console.log(`\n${passed} verificações OK.\n`);
