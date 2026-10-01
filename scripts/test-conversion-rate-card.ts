/**
 * Testes da Taxa de conversão (vendas ÷ carrinhos) — pedido explícito do
 * usuário ("adicionei uma métrica de carrinhos... quero criar uma nova que
 * seria taxa de conversão"). Carrinho é sempre uma métrica SECUNDÁRIA
 * (nunca um `performance_goal`, nunca aparece em `client_goals`) — só
 * existe pra alimentar este único cálculo derivado.
 *
 * Rodada 2 (pedido de simplificação): a Taxa de conversão saiu da Visão
 * Geral do cliente (`clients/[id]/page.tsx`) por inteiro — fica só dentro
 * de `/relatorio` (`report-filterable-tables.tsx`, `ConversionRateNote`),
 * nunca duplicada em dois lugares. `ConversionRateCard`
 * (`clients/conversion-rate-card.tsx`) foi removido por completo: ficou
 * órfão assim que o único import (page.tsx) saiu. A parte pura
 * (`computeConversionRate`) continua intocada e coberta em
 * `test-performance-report.ts` (seção 20) — aqui só a sanidade rápida do
 * contrato e a checagem de que nada ficou duplicado/órfão.
 *
 * Rodar: npx tsx scripts/test-conversion-rate-card.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeConversionRate } from "../src/lib/performance";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

// ---------------------------------------------------------------------------
console.log("1 — Visão Geral do cliente (page.tsx): Taxa de conversão removida por inteiro, nenhum resíduo\n");
{
  const pageSource = readFileSync(join(__dirname, "..", "src", "app", "clients", "[id]", "page.tsx"), "utf8");

  ok("page.tsx não importa mais ConversionRateCard (arquivo removido)", !pageSource.includes("conversion-rate-card"));
  ok("page.tsx não calcula mais cartsResultCount/salesResultCount/conversionRate (lógica órfã sem o card)", !/cartsResultCount|salesResultCount|conversionRate/.test(pageSource));
  ok("page.tsx não importa mais computeConversionRate (só o relatório usa, via report-data.ts)", !pageSource.includes("computeConversionRate"));
  ok("SecondaryGoalsPerformance continua renderizado normalmente (só o que vinha depois dele saiu)", pageSource.includes("<SecondaryGoalsPerformance"));
}

// ---------------------------------------------------------------------------
console.log("\n2 — ConversionRateCard removido por inteiro (ficou órfão, não deletar um componente usado seria pior que mantê-lo morto)\n");
{
  const cardPath = join(__dirname, "..", "src", "app", "clients", "conversion-rate-card.tsx");
  ok("conversion-rate-card.tsx não existe mais", !existsSync(cardPath));

  const relatorioSource = readFileSync(
    join(__dirname, "..", "src", "app", "clients", "[id]", "relatorio", "report-filterable-tables.tsx"),
    "utf8",
  );
  ok(
    "Taxa de conversão continua existindo, só que ÚNICA e exclusiva de /relatorio (ConversionRateNote, nunca duplicada)",
    /function ConversionRateNote/.test(relatorioSource) && /Taxa de conversão/.test(relatorioSource),
  );
}

// ---------------------------------------------------------------------------
console.log("\n3 — computeConversionRate: sanidade rápida do contrato usado por report-data.ts (comportamento completo em test-performance-report.ts)\n");
{
  ok("50 vendas / 200 carrinhos = 0.25", computeConversionRate(50, 200) === 0.25);
  ok("cliente sem nenhum carrinho no mês: null (caso comum — só quem tem a coluna mapeada no Stract tem carrinho)", computeConversionRate(50, 0) === null);
}

console.log(`\nTodos os ${passed} testes passaram.`);
