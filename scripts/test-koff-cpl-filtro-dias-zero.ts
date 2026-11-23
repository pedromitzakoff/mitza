/**
 * Testes da correção "CPL não bate no escopo filtrado quando há dias com
 * zero resultados" — achado real do usuário (conta Helping Hand, filtro
 * "contém: M.A", 15-21/11, depois da correção "Filtro global respeita
 * tudo"): Investimento (R$37.540,73) e Leads (1.253) já batiam exatamente
 * com o Meta, mas CPL não — sistema mostrava R$29,02, Meta mostrava
 * R$29,96 (= 37540,73 ÷ 1253).
 *
 * Causa raiz: `resolveFilteredExecutiveCardOverride` somava o investimento
 * do CPL só das linhas diárias com `resultType` batendo o objetivo
 * (`rowsForGoal`) — mas um dia de uma campanha com ZERO resultados chega
 * com `resultType: null` (a Graph API não devolve o tipo de ação quando a
 * contagem é zero), excluído dessa soma mesmo batendo o filtro de nome e
 * tendo investimento real. O card de Investimento, por sua vez, soma
 * TODAS as linhas que batem o filtro, independente de `resultType`
 * (`filteredCampaignInvestment`, Etapa "Filtro global respeita tudo") —
 * por isso o CPL filtrado ficava sistematicamente mais baixo que
 * Investimento ÷ Leads. Mesma família de bug já corrigida em
 * `exploration-data.ts` (Total da tabela de exploração, conta Darcadia).
 *
 * Correção: com um ÚNICO objetivo no escopo filtrado (o caso comum), o
 * CPL/CPA/ROAS usa o MESMO investimento total filtrado do card de
 * Investimento — nunca um subconjunto silenciosamente menor. Com MAIS de
 * um objetivo no mesmo escopo filtrado (conta genuinamente
 * multi-objetivo), mantém o recorte estrito de sempre — nunca mistura
 * investimento de um objetivo diferente no CPL/CPA do outro (coberto já
 * por `scripts/test-koff-filtro-global-cockpit.ts`, seção E — intocado).
 *
 * Rodar: npx tsx scripts/test-koff-cpl-filtro-dias-zero.ts
 */
import assert from "node:assert/strict";
import { resolveCockpitFilterState, resolveFilteredExecutiveCardOverride } from "../src/lib/cockpit-global-filter";
import type { CampaignDailyMetricRow } from "../src/lib/campaign-analytics";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function campaignRow(overrides: Partial<CampaignDailyMetricRow>): CampaignDailyMetricRow {
  return {
    date: "2026-11-15",
    channel: "meta",
    campaignName: "Campanha",
    campaignId: null,
    spend: 100,
    impressions: 1000,
    reach: 500,
    clicks: 10,
    linkClicks: 8,
    resultType: "leads",
    resultCount: 5,
    revenue: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
console.log("\nA — Reproduz o achado real: dia com zero leads (resultType null) não pode sumir do investimento do CPL\n");
{
  const filter = resolveCockpitFilterState("m.a", "contains");
  const rows: CampaignDailyMetricRow[] = [
    // Dias com leads — contribuem pro resultCount normalmente.
    campaignRow({ campaignName: "M.A Campanha 1", date: "2026-11-15", spend: 200, resultType: "leads", resultCount: 7 }),
    campaignRow({ campaignName: "M.A Campanha 1", date: "2026-11-16", spend: 150, resultType: "leads", resultCount: 3 }),
    // Dia com ZERO leads — achado real: resultType vem `null` da Graph
    // API (nunca "leads" com resultCount 0), mas o investimento é real e
    // a campanha bate o filtro de nome. Isto não pode desaparecer do CPL.
    campaignRow({ campaignName: "M.A Campanha 1", date: "2026-11-17", spend: 80, resultType: null, resultCount: null }),
  ];

  const override = resolveFilteredExecutiveCardOverride("leads", ["meta"], rows, filter);
  ok("resultCount continua correto (7+3=10, o dia zerado nunca contribuiu mesmo antes)", override.resultCount === 10);
  // Investimento esperado = 200+150+80 = 430 (TODAS as linhas que batem o
  // filtro, igual ao card de Investimento) — CPL = 430/10 = 43.
  ok(
    "CPL agora usa o investimento TOTAL filtrado (430/10=43), nunca só o das linhas com resultado (350/10=35, que não bateria com Investimento ÷ Leads)",
    override.costPerResult === 43,
  );
}

// ---------------------------------------------------------------------------
console.log("\nB — Números exatos do achado real (Helping Hand, 15-21/11)\n");
{
  const filter = resolveCockpitFilterState("m.a", "contains");
  // Reconstituído a partir dos números reais reportados pelo usuário:
  // Investimento R$37.540,73, Leads 1.253 — um dia de uma campanha M.A
  // sem nenhum lead no período, resultType null, spend real.
  const rows: CampaignDailyMetricRow[] = [
    campaignRow({ campaignName: "M.A Campanha", date: "2026-11-15", spend: 37460.73, resultType: "leads", resultCount: 1253 }),
    campaignRow({ campaignName: "M.A Campanha", date: "2026-11-16", spend: 80, resultType: null, resultCount: null }),
  ];

  const override = resolveFilteredExecutiveCardOverride("leads", ["meta"], rows, filter);
  ok("Leads = 1.253, igual ao achado real", override.resultCount === 1253);
  ok(
    "CPL = R$37.540,73 ÷ 1.253 ≈ R$29,96 (bate com o Meta) — nunca R$29,02 (o bug, que excluía o dia sem lead do investimento)",
    Math.abs((override.costPerResult ?? 0) - 37540.73 / 1253) < 0.01,
  );
}

// ---------------------------------------------------------------------------
console.log("\nC — Multi-objetivo no mesmo escopo filtrado: continua isolado (nunca mistura investimento de outro objetivo)\n");
{
  const filter = resolveCockpitFilterState("m.a", "contains");
  const rows: CampaignDailyMetricRow[] = [
    campaignRow({ campaignName: "M.A Leads", date: "2026-11-15", spend: 100, resultType: "leads", resultCount: 10 }),
    campaignRow({ campaignName: "M.A Leads", date: "2026-11-16", spend: 50, resultType: null, resultCount: null }),
    // Outro objetivo, OUTRA campanha, mas ainda bate o filtro "m.a".
    campaignRow({ campaignName: "M.A Vendas", date: "2026-11-15", spend: 999, resultType: "sales", resultCount: 5 }),
  ];

  const leadsOverride = resolveFilteredExecutiveCardOverride("leads", ["meta"], rows, filter);
  ok(
    "com outro objetivo presente no escopo filtrado, volta ao recorte estrito (100/10=10) — nunca inclui o investimento de Vendas (999) no CPL de Leads",
    leadsOverride.costPerResult === 10,
  );

  const salesOverride = resolveFilteredExecutiveCardOverride("sales", ["meta"], rows, filter);
  ok("CPA de Vendas usa só o investimento de Vendas (999/5=199.8), nunca o de Leads", salesOverride.costPerResult === 999 / 5);
}

console.log(`\n${passed} verificações OK.\n`);
