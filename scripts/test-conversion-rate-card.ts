/**
 * Testes da Taxa de conversão (vendas ÷ carrinhos) na Visão Geral do
 * cliente — pedido explícito do usuário ("adicionei uma métrica de
 * carrinhos... quero criar uma nova que seria taxa de conversão"). Carrinho
 * é sempre uma métrica SECUNDÁRIA (nunca um `performance_goal`, nunca
 * aparece em `client_goals`) — só existe pra alimentar este único cálculo
 * derivado. A parte pura (`computeConversionRate`) já é coberta em
 * `test-performance-report.ts` (seção 20); aqui: o componente
 * `ConversionRateCard` e a estrutura da leitura de `performanceRecords` em
 * `clients/[id]/page.tsx` (sem banco real — mesma limitação de sempre neste
 * ambiente, só checagem estrutural do que o código faz).
 *
 * Rodar: npx tsx scripts/test-conversion-rate-card.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeConversionRate } from "../src/lib/performance";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

// ---------------------------------------------------------------------------
console.log("1 — page.tsx: carrinhos/vendas lidos de performanceRecords já buscado, sem consulta nova\n");
{
  const pageSource = readFileSync(join(__dirname, "..", "src", "app", "clients", "[id]", "page.tsx"), "utf8");

  ok(
    "cartsResultCount vem de performanceRecords (já buscado por resolvePerformanceRowsForSprints) — nenhuma query nova",
    /const cartsResultCount = performanceRecords\s*\n\s*\.filter\(\(r\) => \(r\.resultType as string\) === "carts"\)/.test(pageSource),
  );
  ok(
    "salesResultCount soma resultType === 'sales' das MESMAS linhas (nenhuma segunda busca)",
    /const salesResultCount = performanceRecords\.filter\(\(r\) => r\.resultType === "sales"\)/.test(pageSource),
  );
  ok(
    "conversionRate usa computeConversionRate (núcleo puro de lib/performance.ts), nunca uma divisão manual aqui",
    /const conversionRate = computeConversionRate\(salesResultCount, cartsResultCount\);/.test(pageSource),
  );
  ok("ConversionRateCard importado", /import \{ ConversionRateCard \} from "\.\.\/conversion-rate-card";/.test(pageSource));
  ok(
    "ConversionRateCard renderizado ao lado de SecondaryGoalsPerformance (nunca dentro dele — carrinho nunca é um client_goal)",
    /<SecondaryGoalsPerformance goals=\{secondaryGoalsPerformance\} \/>\s*\n\s*\n\s*<ConversionRateCard conversionRate=\{conversionRate\} \/>/.test(pageSource),
  );
}

// ---------------------------------------------------------------------------
console.log("\n2 — conversion-rate-card.tsx: some por inteiro sem dado real, nunca um card com 0%/traço fabricado\n");
{
  const cardSource = readFileSync(join(__dirname, "..", "src", "app", "clients", "conversion-rate-card.tsx"), "utf8");

  ok("retorna null quando conversionRate é null (nenhum espaço vazio reservado)", /if \(conversionRate === null\) return null;/.test(cardSource));
  ok("usa formatPercent (mesma convenção de % de todo o resto da MITZA)", /formatPercent\(conversionRate \* 100\)/.test(cardSource));
  ok(
    "usa os tokens overview-* (identidade da Visão Geral) — nunca a paleta hexadecimal fixa do Relatório",
    /overview-surface|overview-text-primary|overview-border/.test(cardSource) && !/#[0-9A-Fa-f]{6}/.test(cardSource),
  );
}

// ---------------------------------------------------------------------------
console.log("\n3 — computeConversionRate: sanidade rápida do contrato usado por page.tsx (comportamento completo em test-performance-report.ts)\n");
{
  ok("50 vendas / 200 carrinhos = 0.25", computeConversionRate(50, 200) === 0.25);
  ok("cliente sem nenhum carrinho no mês: null (caso comum — só quem tem a coluna mapeada no Stract tem carrinho)", computeConversionRate(50, 0) === null);
}

console.log(`\nTodos os ${passed} testes passaram.`);
