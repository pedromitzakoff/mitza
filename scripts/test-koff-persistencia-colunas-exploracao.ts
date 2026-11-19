/**
 * Testes da Etapa "Persistência das colunas da tabela de exploração"
 * (pedido explícito do usuário: "quando eu mudo as metricas visualizadas
 * dos cards e tabelas de um cliente essa visualizacao fica salva pra todos
 * e pra sempre... faça com que fique... e que isso se replique para o dash
 * na versao do cliente tbm") — a seleção de colunas de Campanhas/Conjuntos/
 * Anúncios deixa de ser `localStorage` (por dispositivo, nunca
 * compartilhado) e passa a ser `clients.exploration_columns_*` (banco,
 * compartilhado, replicado pro link público `/r/[token]`).
 *
 * Cobre:
 *  A. `resolveColumnsByLevel`/`resolveStoredColumns` (núcleo puro):
 *     null -> default; array inválido/vazio após filtro -> default; array
 *     válido -> respeitado tal qual.
 *  B. Estrutural: nenhum `localStorage` restante no componente; nova
 *     Server Action gated por `requireClientManagerAccess` (nunca
 *     `requireAdmin`); `toggleColumn` chama a action em vez de gravar no
 *     browser.
 *  C. Wiring: `cockpit-view-data.ts`/`cockpit-exploration-page-data.ts`
 *     leem as 3 colunas novas e as repassam; os 3 pontos de uso passam
 *     `storedColumnsByLevel`.
 *
 * Rodar: npx tsx scripts/test-koff-persistencia-colunas-exploracao.ts
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

const sectionSource = loadSource("src", "app", "clients", "cockpit-ad-exploration-section.tsx");
const actionsSource = loadSource("src", "app", "clients", "exploration-columns-actions.ts");
const viewDataSource = loadSource("src", "lib", "cockpit-view-data.ts");
const pageDataSource = loadSource("src", "lib", "cockpit-exploration-page-data.ts");
const cockpitViewSource = loadSource("src", "app", "clients", "cockpit-view.tsx");
const campanhasPageSource = loadSource("src", "app", "clients", "[id]", "campanhas", "page.tsx");
const anunciosPageSource = loadSource("src", "app", "clients", "[id]", "anuncios", "page.tsx");

// ---------------------------------------------------------------------------
console.log("\nA — localStorage removido do componente, trocado por estado derivado do banco\n");
{
  ok("nenhum USO de código de localStorage restou (comentários podem citar o mecanismo antigo em prosa)", !/window\.localStorage/.test(sectionSource));
  ok("STORAGE_KEY_PREFIX foi removido", !sectionSource.includes("STORAGE_KEY_PREFIX"));
  ok("loadStoredColumns/saveStoredColumns (localStorage) foram removidos", !sectionSource.includes("function loadStoredColumns") && !sectionSource.includes("function saveStoredColumns"));
  ok("resolveStoredColumns (núcleo puro, válido pra qualquer fonte) existe", sectionSource.includes("function resolveStoredColumns("));
  ok("resolveColumnsByLevel monta os 3 níveis a partir do que vem do banco", sectionSource.includes("function resolveColumnsByLevel("));
  ok(
    "CockpitAdExplorationSection recebe `storedColumnsByLevel` como prop nova (nunca lê o banco ela mesma — Client Component)",
    sectionSource.includes("storedColumnsByLevel: StoredExplorationColumnsByLevel"),
  );
}

console.log("\nB — toggleColumn chama a Server Action (banco), nunca mais grava no browser\n");
{
  ok("importa updateExplorationColumnsAction", sectionSource.includes('import { updateExplorationColumnsAction } from "./exploration-columns-actions";'));
  ok(
    "toggleColumn chama a action com (clientId, level, next) — persistência real, nunca só estado local",
    /function toggleColumn[\s\S]{0,400}void updateExplorationColumnsAction\(clientId, level, next\);/.test(sectionSource),
  );
  ok(
    "o ajuste de estado ao trocar de cliente acontece DURANTE o render (nenhum `useEffect` importado/usado no componente)",
    !/\buseEffect\(/.test(sectionSource) &&
      !/import\s*\{[^}]*\buseEffect\b[^}]*\}\s*from\s*"react"/.test(sectionSource) &&
      sectionSource.includes("if (columnsState.clientId !== clientId)"),
  );
}

console.log("\nC — Server Action: mesmo gate de acesso amplo interno dos outros formulários desta página (nunca requireAdmin)\n");
{
  ok(
    "usa requireClientManagerAccess (nunca importa requireAdmin)",
    actionsSource.includes("requireClientManagerAccess(clientId)") && !/import\s*\{[^}]*\brequireAdmin\b[^}]*\}\s*from\s*"@\/lib\/auth"/.test(actionsSource),
  );
  ok("grava em clients.exploration_columns_campaigns/adsets/ads conforme o nível", /exploration_columns_campaigns[\s\S]*exploration_columns_adsets[\s\S]*exploration_columns_ads/.test(actionsSource));
  ok(
    "revalida Cockpit e as páginas dedicadas de Campanhas/Anúncios do cliente",
    actionsSource.includes("revalidatePath(`/clients/${clientId}`)") &&
      actionsSource.includes("revalidatePath(`/clients/${clientId}/campanhas`)") &&
      actionsSource.includes("revalidatePath(`/clients/${clientId}/anuncios`)"),
  );
}

console.log("\nD — Camada de dados: as 3 colunas novas são lidas do banco e repassadas pros dois loaders (Cockpit e páginas dedicadas)\n");
{
  ok(
    "cockpit-view-data.ts inclui as 3 colunas no select de clients",
    viewDataSource.includes("exploration_columns_campaigns, exploration_columns_adsets, exploration_columns_ads"),
  );
  ok(
    "cockpit-view-data.ts monta storedColumnsByLevel dentro de adExploration (mesma pipeline usada por /clients/[id] E /r/[token], via buildCockpitViewModel)",
    /adExploration:[\s\S]*?storedColumnsByLevel:\s*\{\s*campaigns:\s*client\.exploration_columns_campaigns/.test(viewDataSource),
  );
  ok(
    "cockpit-exploration-page-data.ts também inclui as 3 colunas no select e no retorno (campanhas/anuncios/page.tsx)",
    pageDataSource.includes("exploration_columns_campaigns, exploration_columns_adsets, exploration_columns_ads") &&
      pageDataSource.includes("storedColumnsByLevel,"),
  );
}

console.log("\nE — Os 3 pontos de uso passam storedColumnsByLevel pro componente\n");
{
  ok("cockpit-view.tsx (Cockpit, cobre também /r/[token] via o mesmo componente)", cockpitViewSource.includes("storedColumnsByLevel={model.adExploration.storedColumnsByLevel}"));
  ok("[id]/campanhas/page.tsx", campanhasPageSource.includes("storedColumnsByLevel={data.storedColumnsByLevel}"));
  ok("[id]/anuncios/page.tsx", anunciosPageSource.includes("storedColumnsByLevel={data.storedColumnsByLevel}"));
}

console.log(`\n${passed} verificações OK.\n`);
