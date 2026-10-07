/**
 * Testes da Etapa "MEGA FACELIFT — Fase 5: Dados" — cobre o núcleo puro
 * novo (`lib/data-trust.ts`: taxonomia de status, atenções determinísticas,
 * cruzamento objetivo×fonte) com chamadas diretas (sem banco), e checagens
 * ESTRUTURAIS do loader (`src/app/clients/dados-data.ts`) e da página
 * (`src/app/clients/[id]/dados/page.tsx`) via grep de código-fonte — mesmo
 * padrão já usado por `test-mega-facelift-fase2-metas.ts` pra loaders que
 * dependem de Supabase (sem instância de banco neste ambiente de teste).
 *
 * Rodar: npx tsx scripts/test-mega-facelift-fase5-dados.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROVIDER_LABEL,
  resolveImportSourceDisplayStatus,
  buildSourceAttentions,
  buildGoalAttentions,
  resolveGoalCoverage,
  resolveLatestImportedDate,
} from "../src/lib/data-trust";
import { buildModuleContextHref, resolveReplicableSuffix } from "../src/lib/client-workspace-nav";
import { TRAFFIC_CHANNELS } from "../src/lib/traffic-channels";
import { PERFORMANCE_GOALS } from "../src/lib/performance-goals";

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

const dataTrustSource = loadSource("src", "lib", "data-trust.ts");
const dadosDataSource = loadSource("src", "app", "clients", "dados-data.ts");
const dadosPageSource = loadSource("src", "app", "clients", "[id]", "dados", "page.tsx");
const sidebarSource = loadSource("src", "app", "sidebar.tsx");
const navSource = loadSource("src", "lib", "client-workspace-nav.ts");

console.log("\n1 — Taxonomia de status (resolveImportSourceDisplayStatus) — enabled=false sempre vence; nenhum rótulo 'Conectado/Desconectado' fabricado\n");
{
  check("fonte desativada → 'Desativada', mesmo que status ainda diga active", resolveImportSourceDisplayStatus({ enabled: false, status: "active" }).label, "Desativada");
  check("status error (habilitada) → 'Erro de sincronização'", resolveImportSourceDisplayStatus({ enabled: true, status: "error" }).label, "Erro de sincronização");
  check("status no_data (habilitada) → 'Sem dados recebidos'", resolveImportSourceDisplayStatus({ enabled: true, status: "no_data" }).label, "Sem dados recebidos");
  check("status pending (habilitada) → 'Aguardando primeira sincronização'", resolveImportSourceDisplayStatus({ enabled: true, status: "pending" }).label, "Aguardando primeira sincronização");
  check("status active (habilitada) → 'Atualizada'", resolveImportSourceDisplayStatus({ enabled: true, status: "active" }).label, "Atualizada");
  ok(
    "nenhum arquivo da Fase 5 usa os rótulos 'Conectado'/'Desconectado' (nunca inventar status de conexão não provável pelo schema)",
    !/\bConectad[oa]\b/.test(dataTrustSource) &&
      !/\bDesconectad[oa]\b/.test(dataTrustSource) &&
      !/\bConectad[oa]\b/.test(dadosDataSource) &&
      !/\bDesconectad[oa]\b/.test(dadosPageSource),
  );
}

console.log("\n2 — Rótulos amigáveis reaproveitam configuração já existente (nenhum mapa de label duplicado)\n");
{
  check("PROVIDER_LABEL.stract", PROVIDER_LABEL.stract, "Stract");
  check("PROVIDER_LABEL.meta_api", PROVIDER_LABEL.meta_api, "Meta API");
  check("canal meta usa o mesmo label de lib/traffic-channels.ts", TRAFFIC_CHANNELS.meta.label, "Meta Ads");
  check("objetivo leads usa o mesmo label de lib/performance-goals.ts", PERFORMANCE_GOALS.leads.label, "Leads");
  ok("data-trust.ts importa TRAFFIC_CHANNELS/PERFORMANCE_GOALS em vez de redeclarar os rótulos", dataTrustSource.includes('from "@/lib/traffic-channels"') && dataTrustSource.includes('from "@/lib/performance-goals"'));
}

console.log("\n3 — Atenções por FONTE: só error/no_data geram atenção; desativada e pending nunca geram\n");
{
  const sources = [
    { id: "s-active", provider: "stract" as const, channel: "meta" as const, enabled: true, status: "active" as const },
    { id: "s-error", provider: "stract" as const, channel: "google" as const, enabled: true, status: "error" as const },
    { id: "s-no-data", provider: "meta_api" as const, channel: "instagram" as const, enabled: true, status: "no_data" as const },
    { id: "s-disabled", provider: "stract" as const, channel: "meta" as const, enabled: false, status: "error" as const },
    { id: "s-pending", provider: "stract" as const, channel: "google" as const, enabled: true, status: "pending" as const },
  ];
  const attentions = buildSourceAttentions(sources);
  check("exatamente 2 atenções (error + no_data) — múltiplas fontes, cada uma avaliada independentemente", attentions.length, 2);
  ok("atenção de error tem severidade 'error'", attentions.find((a) => a.id === "source-error-s-error")?.severity === "error");
  ok("atenção de no_data tem severidade 'warning' (não é a mesma gravidade de um erro real)", attentions.find((a) => a.id === "source-no-data-s-no-data")?.severity === "warning");
  ok("fonte desativada (mesmo com status error salvo) nunca gera atenção — decisão deliberada do admin", !attentions.some((a) => a.id.includes("s-disabled")));
  ok("fonte pending (nunca sincronizou) nunca gera atenção — ainda não é uma lacuna comprovada", !attentions.some((a) => a.id.includes("s-pending")));
}

console.log("\n4 — Dado antigo NUNCA gera atenção (decisão deliberada: nenhum threshold de frescor inventado)\n");
{
  const veryOldButActive = [{ id: "s1", provider: "stract" as const, channel: "meta" as const, enabled: true, status: "active" as const }];
  const attentions = buildSourceAttentions(veryOldButActive);
  check("fonte com status 'active' nunca gera atenção, independente de há quanto tempo o dado é — frescor é só informativo", attentions.length, 0);
  ok(
    "data-trust.ts documenta explicitamente a ausência de threshold de frescor inventado (nenhum número mágico escondido)",
    /SEM threshold/i.test(dataTrustSource) && /heurística frágil/i.test(dataTrustSource),
  );
}

console.log("\n5 — resolveLatestImportedDate: ignora fontes desativadas, pega a data mais recente entre as habilitadas\n");
{
  check(
    "dado recente vence entre múltiplas fontes habilitadas",
    resolveLatestImportedDate([
      { enabled: true, lastImportedDate: "2026-09-10" },
      { enabled: true, lastImportedDate: "2026-09-28" },
    ]),
    "2026-09-28",
  );
  check(
    "fonte desativada com data mais recente é ignorada",
    resolveLatestImportedDate([
      { enabled: true, lastImportedDate: "2026-09-10" },
      { enabled: false, lastImportedDate: "2026-09-30" },
    ]),
    "2026-09-10",
  );
  check("nenhuma fonte habilitada com dado real → null (nunca uma data fabricada)", resolveLatestImportedDate([{ enabled: false, lastImportedDate: "2026-09-30" }]), null);
}

console.log("\n6 — resolveGoalCoverage: 'channels: []' (sem restrição) considera TODAS as fontes habilitadas; canal restrito filtra\n");
{
  const enabledSources = [
    { id: "src-meta", channel: "meta" as const, status: "active" as const },
    { id: "src-google", channel: "google" as const, status: "pending" as const },
  ];
  check(
    "sem restrição de canal → as 2 fontes contam como relevantes",
    resolveGoalCoverage([], enabledSources).relevantSources.map((s) => s.id),
    ["src-meta", "src-google"],
  );
  check("restrito a 'google' → só a fonte Google é relevante", resolveGoalCoverage(["google"], enabledSources).relevantSources.map((s) => s.id), ["src-google"]);
  check("entre as relevantes, só a com status 'active' entra em activeSources", resolveGoalCoverage([], enabledSources).activeSources.map((s) => s.id), ["src-meta"]);
}

console.log("\n7 — Atenções por OBJETIVO: objetivo automático sem fonte / sem mapeamento gera atenção; manual nunca gera; nunca infere fonte específica sem prova\n");
{
  const enabledSources = [{ id: "src-meta", channel: "meta" as const, status: "active" as const }];

  const noSourceAtAll = buildGoalAttentions([{ resultType: "leads", resultSource: "automatic", channels: ["google"] }], enabledSources, new Map());
  check("objetivo automático cujo canal (google) não tem NENHUMA fonte habilitada → 1 atenção 'sem fonte ativa'", noSourceAtAll.length, 1);
  ok("mensagem cita o objetivo pelo nome amigável (Leads), nunca um código bruto", noSourceAtAll[0].message.includes("Leads"));

  const sourceButNoMapping = buildGoalAttentions([{ resultType: "sales", resultSource: "automatic", channels: ["meta"] }], enabledSources, new Map());
  check("fonte ativa cobrindo o canal, mas SEM metric_mappings ativo pra 'sales' → 1 atenção 'sem mapeamento'", sourceButNoMapping.length, 1);
  ok("mensagem de mapeamento ausente é distinta da de fonte ausente", sourceButNoMapping[0].message.includes("mapeamento"));

  const mappingGoalsBySourceId = new Map([["src-meta", ["sales" as const]]]);
  const covered = buildGoalAttentions([{ resultType: "sales", resultSource: "automatic", channels: ["meta"] }], enabledSources, mappingGoalsBySourceId);
  check("fonte ativa + mapeamento ativo pra 'sales' → nenhuma atenção (objetivo genuinamente coberto)", covered.length, 0);

  const manualGoal = buildGoalAttentions([{ resultType: "leads", resultSource: "manual", channels: [] }], [], new Map());
  check("objetivo MANUAL nunca gera atenção, mesmo sem nenhuma fonte — é uma escolha válida, não uma lacuna", manualGoal.length, 0);
}

console.log("\n8 — Atribuição 'Automático · <canal>' só quando a fonte é explicitamente restrita e comprovadamente ativa (nunca inferida)\n");
{
  ok(
    "dados-data.ts só atribui canal automático quando goal.channels.length > 0 (nunca quando 'sem restrição', ambíguo por desenho)",
    /goal\.resultSource === "automatic" && goal\.channels\.length > 0/.test(dadosDataSource),
  );
  ok(
    "a atribuição de canal exige status === 'active' (fonte habilitada mas 'pending'/'error' nunca aparece como 'alimentando de verdade')",
    /s\.status === "active"/.test(dadosDataSource),
  );
}

console.log("\n9 — Frescor: data do DADO (last_imported_date) e data da SINCRONIZAÇÃO (last_success_at) nunca são o mesmo campo\n");
{
  ok(
    "lastImportedDateLabel vem de row.last_imported_date formatado com formatShortDate (data civil do dado)",
    /lastImportedDateLabel: row\.last_imported_date \? `Dados até \$\{formatShortDate\(row\.last_imported_date\)\}` : null/.test(dadosDataSource),
  );
  ok(
    "lastSuccessAtLabel vem de row.last_success_at formatado com formatRelativeDateTime (instante da sincronização) — campo DIFERENTE do anterior",
    /lastSuccessAtLabel: row\.last_success_at \? formatRelativeDateTime\(row\.last_success_at, now\) : null/.test(dadosDataSource),
  );
  ok("a página exibe os dois rótulos lado a lado, nunca um substituindo o outro", /lastImportedDateLabel/.test(dadosPageSource) && /lastSuccessAtLabel/.test(dadosPageSource));
}

console.log("\n10 — Permissões: detalhe técnico (tabela/colunas/histórico de execuções) e 'Ver configuração' só pra admin\n");
{
  ok("campo 'technical' só é preenchido quando isAdmin (null pra qualquer outro perfil)", /technical: isAdmin\s*\n?\s*\?/.test(dadosDataSource));
  ok("'configureHref' também exige isAdmin — nunca um link de configuração pra gestor", /configureHref: isAdmin &&/.test(dadosDataSource));
  ok("a página só renderiza o bloco de detalhes técnicos quando source.technical existe", /\{source\.technical && \(/.test(dadosPageSource));
  ok(
    "histórico detalhado de sincronização (getRecentSyncRunsForClient) só é buscado quando isAdmin — mesma régua de account-info-actions.ts",
    /isAdmin && sourceIds\.length > 0 \? getRecentSyncRunsForClient/.test(dadosDataSource),
  );
}

console.log("\n11 — Estados vazios: cliente 100% manual tem aviso honesto; nenhuma seção de Atenções vazia renderizada\n");
{
  ok("isFullyManual é true só quando zero linhas em import_sources", /isFullyManual: importSourceRows\.length === 0/.test(dadosDataSource));
  ok(
    "aviso de cliente manual é honesto (menciona lançamento manual, nunca finge haver fonte)",
    dadosPageSource.includes("não tem nenhuma fonte automática configurada"),
  );
  ok("seção Atenções só renderiza quando há pelo menos uma (nunca um card vazio '0 atenções' ocupando espaço)", /data\.attentions\.length > 0 &&/.test(dadosPageSource));
}

console.log("\n12 — Responsividade básica: grid de SAÚDE colapsa em mobile (2 colunas) e expande em telas maiores\n");
{
  ok("grid da SAÚDE DOS DADOS usa grid-cols-2 como base mobile e sm:grid-cols-3 a partir de telas maiores", /grid-cols-2 gap-3 sm:grid-cols-3/.test(dadosPageSource));
  ok("cards de fonte/atenção usam flex-wrap (nunca overflow horizontal forçado em tela estreita)", /flex-wrap/.test(dadosPageSource));
}

console.log("\n13 — Contexto CLIENTE (rota /clients/[id]/dados) e contexto TODOS (mantém decisão da Fase 4.6: sem agregação global nova)\n");
{
  check("buildModuleContextHref('dados', Todos) continua caindo em /clients — nenhuma agregação de carteira inventada nesta fase", buildModuleContextHref("dados", { type: "all" }, null), "/clients");
  const moduleGlobalHrefBlock = navSource.slice(navSource.indexOf("MODULE_GLOBAL_HREF"), navSource.indexOf("MODULE_GLOBAL_HREF") + 400);
  ok(
    "MODULE_GLOBAL_HREF (lib/client-workspace-nav.ts) continua sem entrada pra 'dados' — decisão documentada, não uma omissão",
    !/\bdados:/.test(moduleGlobalHrefBlock.slice(0, moduleGlobalHrefBlock.indexOf("};"))),
  );
  check("trocar de cliente dentro de /dados preserva o módulo (mesma regra de replicação dos outros 6 módulos)", resolveReplicableSuffix("/dados"), "/dados");
  ok("página usa WorkspaceContainer (mesma largura/identidade visual do resto do workspace do cliente)", dadosPageSource.includes("<WorkspaceContainer>"));
}

console.log("\n14 — Sidebar: MITZA ONE — Fase 2 moveu Dados pra dentro do cockpit (Fase 1) — não é mais item de navegação próprio, mas a rota/módulo continuam intactos\n");
{
  // MITZA ONE — Fase 2 (Sidebar = Carteira de Clientes): Dashboard/Metas/
  // Performance/Dados deixaram de ter item próprio na Sidebar (viraram
  // seções do cockpit único, Fase 1) — isso NÃO é regressão da Fase 5
  // (a rota /clients/[id]/dados, data-trust.ts, dados-data.ts continuam
  // 100% intactos, cobertos nas seções acima) — só a navegação mudou.
  ok("Sidebar não define mais um item de navegação 'Dados' (nenhum 'key: \"dados\"' — módulo migrou pro cockpit, Fase 1)", !sidebarSource.includes('key: "dados"'));
  ok("rota /clients/[id]/dados continua existindo e intocada (seções 1-13 acima)", dadosPageSource.includes("<WorkspaceContainer>"));
}

console.log("\n15 — Isolamento: Dados não importa os núcleos de CÁLCULO de Metas/Performance (zero acoplamento novo nos cálculos, zero risco de regressão)\n");
{
  ok(
    "data-trust.ts/dados-data.ts nunca importam lib/performance.ts (cálculo de Performance) nem lib/client-plan.ts (planejamento de Metas)",
    !/from "@\/lib\/performance"/.test(dataTrustSource + dadosDataSource) && !/from "@\/lib\/client-plan"/.test(dataTrustSource + dadosDataSource),
  );
  // MITZA ONE — Fase 1 (Cockpit Único do Cliente) mudou esta regra
  // DELIBERADAMENTE pro Dashboard, por pedido explícito ("Dados vira
  // alerta" — seção 13: "se existir atenção real, mostrar dentro/próximo
  // do Diagnóstico"): `[id]/page.tsx` agora importa `loadDadosPageData`
  // (dados-data.ts) pra alimentar a seção Diagnóstico — mesma função que
  // `/clients/[id]/dados` já usa, nenhuma segunda leitura de
  // `import_sources`/`metric_mappings`. O isolamento que de fato continua
  // intacto (e é o que importa pra "zero risco de regressão de cálculo"):
  // os núcleos de CÁLCULO (`metas-data.ts`, `lib/performance.ts`) nunca
  // importaram e continuam sem importar `dados-data.ts`/`data-trust.ts` —
  // só a camada de COMPOSIÇÃO do cockpit (não um motor de cálculo) ganhou
  // essa leitura extra.
  ok(
    "metas-data.ts e lib/performance.ts (núcleos de CÁLCULO) continuam sem importar dados-data.ts/data-trust.ts — só a composição do cockpit (Fase 1) passou a ler atenções de Dados, nunca um motor de cálculo",
    !loadSource("src", "app", "clients", "metas-data.ts").includes("dados-data") && !loadSource("src", "lib", "performance.ts").includes("data-trust"),
  );
  ok(
    "[id]/page.tsx importa loadDadosPageData (MITZA ONE — Fase 1, seção 13: 'Dados vira alerta') — mesma função oficial de /clients/[id]/dados, nenhuma segunda leitura de import_sources/metric_mappings",
    loadSource("src", "app", "clients", "[id]", "page.tsx").includes('import { loadDadosPageData } from "../dados-data"'),
  );
}

console.log(`\n${passed} verificações passaram.`);
