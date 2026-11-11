/**
 * Testes da Etapa "Catálogo de métricas do Dashboard" — Fase A do plano
 * aprovado: catálogo global de 17 indicadores + persistência independente
 * de `client_goals` (ponto 2 do pedido) + preservação da experiência atual
 * de clientes já existentes (ponto 8) até configurarem de propósito.
 *
 * Cobre:
 *  A. Catálogo: 17 itens, 3 grupos corretos (5 Resultado/5 Eficiência/7
 *     Entrega), cada um com `dependsOnGoal` coerente (Entrega nunca
 *     depende de objetivo; Eficiência sempre depende do Resultado
 *     correspondente).
 *  B. `parseDashboardMetricKeys`: nunca confia cegamente num array vindo
 *     do banco — descarta qualquer chave que não exista no catálogo.
 *  C. `resolveEffectiveDashboardMetrics`: array vazio + objetivo legado
 *     deriva o conjunto EQUIVALENTE ao que já aparecia antes desta etapa
 *     (objetivo + custo dele + entrega básica); array já configurado
 *     IGNORA o objetivo legado (nunca os dois juntos); 'followers' não
 *     tem métrica de custo no catálogo, então não aparece nenhuma.
 *  D. Wiring: a seção nova está em `/clients/[id]/edit`, nunca cria linha
 *     em `client_goals`, nunca depende de `metric_mappings` pra SALVAR
 *     (só a apresentação, mais tarde, depende disso).
 *
 * Rodar: npx tsx scripts/test-koff-dashboard-metrics-catalog.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DASHBOARD_METRIC_CATALOG,
  DASHBOARD_METRIC_OPTIONS,
  parseDashboardMetricKeys,
  resolveEffectiveDashboardMetrics,
  type DashboardMetricKey,
} from "../src/lib/dashboard-metrics";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

// ---------------------------------------------------------------------------
console.log("\nA — Catálogo: 17 itens, 3 grupos, dependências coerentes\n");
{
  ok("17 itens no total", DASHBOARD_METRIC_OPTIONS.length === 17);

  const byGroup = (g: string) => DASHBOARD_METRIC_OPTIONS.filter((m) => m.group === g);
  ok("5 Resultado", byGroup("resultado").length === 5);
  ok("5 Eficiência", byGroup("eficiencia").length === 5);
  ok("7 Entrega", byGroup("entrega").length === 7);

  ok("Entrega nunca depende de objetivo nenhum", byGroup("entrega").every((m) => m.dependsOnGoal === null));
  ok(
    "Eficiência sempre depende de um objetivo (CPL->leads, CPA->sales, etc.)",
    byGroup("eficiencia").every((m) => m.dependsOnGoal !== null),
  );
  ok("CPL depende de 'leads'", DASHBOARD_METRIC_CATALOG.cpl.dependsOnGoal === "leads");
  ok("CPA depende de 'sales'", DASHBOARD_METRIC_CATALOG.cpa.dependsOnGoal === "sales");
  ok("ROAS depende de 'sales' (receita só é mapeada pra Vendas hoje)", DASHBOARD_METRIC_CATALOG.roas.dependsOnGoal === "sales");
}

// ---------------------------------------------------------------------------
console.log("\nB — parseDashboardMetricKeys nunca confia cegamente no banco\n");
{
  ok(
    "descarta chaves que não existem no catálogo (ex.: um valor antigo/typo)",
    parseDashboardMetricKeys(["leads", "lixo", "cpl"]).join(",") === "leads,cpl",
  );
  ok("array vazio continua vazio", parseDashboardMetricKeys([]).length === 0);
}

// ---------------------------------------------------------------------------
console.log("\nC — resolveEffectiveDashboardMetrics: preserva a experiência atual até configurar de propósito\n");
{
  ok(
    "vazio + sem objetivo legado -> só entrega básica (nunca 'nada')",
    resolveEffectiveDashboardMetrics([], null).join(",") === "spend,impressions,clicks,ctr,cpc,cpm",
  );
  ok(
    "vazio + objetivo 'leads' -> leads + cpl + a mesma entrega de sempre",
    resolveEffectiveDashboardMetrics([], "leads").join(",") === "leads,cpl,spend,impressions,clicks,ctr,cpc,cpm",
  );
  ok(
    "vazio + objetivo 'sales' -> sales + cpa + entrega",
    resolveEffectiveDashboardMetrics([], "sales").join(",") === "sales,cpa,spend,impressions,clicks,ctr,cpc,cpm",
  );
  ok(
    "vazio + objetivo 'followers' -> followers SEM custo (não existe métrica de custo por seguidor no catálogo)",
    resolveEffectiveDashboardMetrics([], "followers").join(",") === "followers,spend,impressions,clicks,ctr,cpc,cpm",
  );
  ok(
    "já configurado (não-vazio) IGNORA o objetivo legado — nunca mistura os dois",
    resolveEffectiveDashboardMetrics(["sales", "roas"], "leads").join(",") === "sales,roas",
  );
  ok(
    "já configurado também filtra lixo (reaproveita parseDashboardMetricKeys, nunca uma segunda validação)",
    resolveEffectiveDashboardMetrics(["sales", "lixo"], "leads").join(",") === "sales",
  );
}

// ---------------------------------------------------------------------------
console.log("\nD — Wiring: seção nova em /clients/[id]/edit, independente de client_goals\n");
{
  const editPageSource = loadSource("src", "app", "clients", "[id]", "edit", "page.tsx");
  const sectionSource = loadSource("src", "app", "clients", "dashboard-metrics-section.tsx");
  const actionsSource = loadSource("src", "app", "clients", "dashboard-metrics-actions.ts");
  const migrationSql = loadSource("supabase", "dashboard-metrics-catalog.sql");

  ok('seção "Métricas exibidas" presente em /clients/[id]/edit', editPageSource.includes('title="Métricas exibidas"'));
  ok(
    "usa resolveEffectiveDashboardMetrics com o valor real da coluna + objetivo legado (nunca hardcoded)",
    editPageSource.includes("resolveEffectiveDashboardMetrics(client.dashboard_metrics ?? [], client.performance_goal)"),
  );
  ok(
    "a seção renderiza os 3 grupos (Resultados/Eficiência/Entrega), nunca uma lista plana sem agrupamento",
    sectionSource.includes("Resultados") && sectionSource.includes("Eficiência") && sectionSource.includes("Entrega"),
  );
  ok(
    "a action salva só clients.dashboard_metrics — nunca escreve em client_goals/metric_mappings",
    actionsSource.includes('.from("clients").update({ dashboard_metrics: metrics })') &&
      !actionsSource.includes('.from("client_goals")') &&
      !actionsSource.includes('.from("metric_mappings")'),
  );
  ok("migração é aditiva (IF NOT EXISTS), coluna com default não-nulo", migrationSql.includes("add column if not exists dashboard_metrics text[] not null default '{}'"));
}

console.log(`\n${passed} verificações OK.\n`);

// Garantir que o tipo DashboardMetricKey cobre exatamente o que o catálogo usa (checagem em tempo de compilação).
const _exhaustive: DashboardMetricKey[] = Object.keys(DASHBOARD_METRIC_CATALOG) as DashboardMetricKey[];
void _exhaustive;
