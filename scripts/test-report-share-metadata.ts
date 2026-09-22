/**
 * Etapa "OG Metadata do Relatório Público" — `generateMetadata`/
 * `opengraph-image.tsx` de `/r/[token]`.
 *
 * Este ambiente não tem Supabase real: exercita a formatação de período
 * (`formatReportPeriodLabel`, pura) e faz uma auditoria estrutural do
 * código-fonte pra provar as garantias que não dependem de rede: nenhuma
 * pipeline pesada do relatório dentro do metadata/imagem, nenhum
 * `clientId` exposto, `metadataBase` resolvido via a mesma
 * `resolvePublicShareLinkBaseUrl` de sempre, imagem/robots configurados.
 *
 * Rodar: npx tsx scripts/test-report-share-metadata.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatReportPeriodLabel } from "../src/app/r/[token]/report-share-metadata";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

async function main() {

console.log("\n1 — formatReportPeriodLabel: mês fechado vira 'Mês Ano' (ex.: Setembro 2026)\n");
{
  ok("01/09/2026 → 30/09/2026 vira 'Setembro 2026'", formatReportPeriodLabel({ start: "2026-09-01", end: "2026-09-30" }) === "Setembro 2026");
  ok("01/02/2026 → 28/02/2026 (fevereiro, ano não bissexto) vira 'Fevereiro 2026'", formatReportPeriodLabel({ start: "2026-02-01", end: "2026-02-28" }) === "Fevereiro 2026");
}

console.log("\n2 — formatReportPeriodLabel: recorte que não é o mês inteiro vira intervalo 'DD/MM – DD/MM'\n");
{
  ok("últimos 7 dias (recorte parcial) vira intervalo", formatReportPeriodLabel({ start: "2026-09-10", end: "2026-09-16" }) === "10/09 – 16/09");
  ok("período customizado cruzando dois meses vira intervalo", formatReportPeriodLabel({ start: "2026-08-25", end: "2026-09-05" }) === "25/08 – 05/09");
  ok("mês fechado errado (começa dia 2) NUNCA é tratado como mês fechado", formatReportPeriodLabel({ start: "2026-09-02", end: "2026-09-30" }) === "02/09 – 30/09");
}

console.log('\n3 — auditoria estrutural: generateMetadata nunca usa a pipeline pesada do relatório\n');
{
  const pageSource = readFileSync(join(__dirname, "..", "src", "app", "r", "[token]", "page.tsx"), "utf8");
  const metadataMatch = pageSource.match(/export async function generateMetadata[\s\S]*?\n}\n/);
  assert.ok(metadataMatch, "generateMetadata não encontrado em page.tsx");
  const metadataSource = metadataMatch![0];

  ok("generateMetadata nunca chama buildPerformanceReportData", !/buildPerformanceReportData/.test(metadataSource));
  ok("generateMetadata nunca chama buildPerformanceReportDocument", !/buildPerformanceReportDocument/.test(metadataSource));
  ok("generateMetadata resolve o nome via resolveReportShareClientName (nunca expõe clientId)", /resolveReportShareClientName\(token\)/.test(metadataSource));
  ok("generateMetadata nunca declara variável/campo clientId", !/\bclientId\b/.test(metadataSource));
  ok("generateMetadata usa resolvePublicShareLinkBaseUrl (mesma resolução de domínio de produção do painel admin)", /resolvePublicShareLinkBaseUrl\(\)/.test(metadataSource));
  ok("título fixo 'Relatório de Performance', sem marca da agência (white label)", /REPORT_SHARE_TITLE = "Relatório de Performance"/.test(pageSource));
  ok("openGraph nunca declara siteName (nenhum nome neutro pra colocar sem reintroduzir uma marca)", !/siteName/.test(metadataSource));
  ok("robots: noindex/nofollow (link privado do cliente nunca deve ser indexado)", /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/.test(metadataSource));
  ok("openGraph e twitter declarados", /openGraph:/.test(metadataSource) && /twitter:/.test(metadataSource));
  ok("generateMetadata nunca declara openGraph.images (a convenção de arquivo opengraph-image.tsx cuida disso)", !/images:/.test(metadataSource));
}

console.log("\n4 — auditoria estrutural: opengraph-image.tsx nunca usa a pipeline pesada nem expõe clientId/métrica\n");
{
  const imageSource = readFileSync(join(__dirname, "..", "src", "app", "r", "[token]", "opengraph-image.tsx"), "utf8");

  ok("opengraph-image.tsx exporta size 1200x630", /width:\s*1200/.test(imageSource) && /height:\s*630/.test(imageSource));
  ok("opengraph-image.tsx nunca chama buildPerformanceReportData", !/buildPerformanceReportData/.test(imageSource));
  ok("opengraph-image.tsx nunca declara variável/campo clientId", !/const clientId|clientId:/.test(imageSource));
  ok("opengraph-image.tsx resolve o nome via resolveReportShareClientName", /resolveReportShareClientName\(token\)/.test(imageSource));
  ok("paleta institucional pedida (creme/areia/grafite/verde-limão) presente", ["#EFE9E0", "#C8BEAD", "#17171A", "#D8F238"].every((hex) => imageSource.includes(hex)));
  ok("nenhum número (custo, ROAS, investimento, resultado) é interpolado na imagem — só clientName/periodLabel", !/summary\.|record\.|revenue|spend|roas|costPerResult/i.test(imageSource));
  ok("nenhuma wordmark 'KOFF' na imagem (white label — pedido explícito)", !/>KOFF</.test(imageSource) && !/alt = "KOFF/.test(imageSource));
}

console.log("\n5 — auditoria estrutural: resolução do nome do cliente reaproveita resolveClientIdFromShareToken (nunca uma segunda lógica de token)\n");
{
  const helperSource = readFileSync(join(__dirname, "..", "src", "app", "r", "[token]", "report-share-metadata.ts"), "utf8");

  ok("reaproveita resolveClientIdFromShareToken (mesma resolução neutra de sempre)", /resolveClientIdFromShareToken\(token\)/.test(helperSource));
  ok("consulta só a coluna 'name' de clients (nunca métrica/coluna sensível)", /\.select\("name"\)/.test(helperSource));
  ok("token inexistente/revogado/cliente excluído (clientId null) nunca chega a consultar clients", /if \(!clientId\) return null;/.test(helperSource));
  ok("resolveReportShareClientName é memoizado com React cache()", /export const resolveReportShareClientName = cache\(/.test(helperSource));
}

console.log(`\nTodos os ${passed} testes passaram.`);

}

main();
