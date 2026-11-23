/**
 * Testes da Etapa "Correção do rótulo de Investimento fora do mês" (bug
 * reportado pelo usuário): com o período "Personalizado" (ex.: 13/11 a
 * 15/11) selecionado, o card de Orçamento mostrava corretamente o gasto do
 * INTERVALO consultado (`headline.monthActual`/`monthActualForHeadline`,
 * `lib/cockpit-view-data.ts`, já correto desde a Etapa "Seletor global de
 * período"), mas o RÓTULO embaixo continuava fixo em "investido no mês" —
 * uma falha de comunicação real (número certo, legenda errada, "se não vai
 * causar falha na comunicação" nas palavras do usuário).
 *
 * Checagens ESTRUTURAIS via grep de código-fonte (mesmo padrão das suites
 * anteriores) — o CÁLCULO do valor já era coberto por
 * `test-koff-seletor-periodo.ts`; esta suite cobre só o RÓTULO.
 *
 * Rodar: npx tsx scripts/test-koff-rotulo-investimento-periodo.ts
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

const cardSource = loadSource("src", "app", "clients", "cockpit-meta-ritmo-section.tsx");
const viewSource = loadSource("src", "app", "clients", "cockpit-view.tsx");

// ---------------------------------------------------------------------------
console.log("\nA — CockpitBudgetCard recebe isMonthAligned e troca o rótulo de verdade (nunca mais 'no mês' fixo)\n");
{
  ok("CockpitBudgetCard aceita isMonthAligned como prop (opcional, default true — nenhuma mudança de comportamento pra quem não passar)", /isMonthAligned\?\s*:\s*boolean/.test(cardSource) && /isMonthAligned = true/.test(cardSource));
  ok(
    "o rótulo do valor investido agora é condicional: 'no mês' quando isMonthAligned, 'no período' quando não",
    cardSource.includes('investido {isMonthAligned ? "no mês" : "no período"}'),
  );
  ok("a antiga string FIXA 'investido no mês' (sem condicional nenhum) não existe mais", !cardSource.includes('investido no mês{isGlobalFilterActive'));
  ok(
    // Etapa "Filtro global respeita tudo" acrescentou uma 3ª condição
    // (escopo filtrado) na frente das 2 de sempre — o texto de cada uma
    // continua intacto, só a ordem de checagem mudou.
    "o estado vazio (sem planejamento) também troca de texto — nunca mais fala de 'o mês' fora do mês",
    cardSource.includes('isMonthAligned ? "Sem planejamento configurado para o mês." : "Sem planejamento mensal comparável neste período."'),
  );
}

// ---------------------------------------------------------------------------
console.log("\nB — Wiring: cockpit-view.tsx passa o mesmo isMonthAligned já resolvido pro período atual (nunca um segundo cálculo)\n");
{
  ok(
    "o call site passa model.periodResolved.isMonthAligned — MESMO campo que PeriodRangePicker/formatPeriodLabel já leem, nenhuma segunda fonte",
    viewSource.includes("isMonthAligned={model.periodResolved.isMonthAligned}"),
  );
  ok(
    "CockpitView é o componente ÚNICO reaproveitado por /clients/[id] E /r/[token] (ver JSDoc do componente) — a correção vale pros dois sem nenhum código a mais",
    viewSource.includes("export function CockpitView({ model, today }"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nC — O NÚMERO exibido já estava certo antes desta correção (só o rótulo mudou) — nenhum cálculo novo nesta etapa\n");
{
  const dataSource = loadSource("src", "lib", "cockpit-view-data.ts");
  ok(
    "monthActualForHeadline já usava queryRangeActualSpend fora do mês (Etapa 'Seletor global de período', intocado aqui)",
    dataSource.includes('const monthActualForHeadline = isMonthAligned ? monthActual : queryRangeActualSpend;'),
  );
}

console.log(`\n${passed} verificações OK.\n`);
