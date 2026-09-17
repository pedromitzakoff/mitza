/**
 * Etapa "Equipe — Fase 2: Histórico Temporal de Responsabilidade" —
 * `supabase/client-manager-assignments.sql` (schema + trigger) +
 * `lib/client-manager-assignments.ts` (camada de leitura) +
 * `lib/team-performance-data.ts#loadManagerAssignmentHistory` (UI de
 * `/team/[id]`).
 *
 * Este ambiente não tem Supabase real — não dá pra rodar o trigger SQL de
 * verdade. A cobertura combina:
 *
 * 1. Dinâmico — as funções PURAS de leitura já exportadas
 *    (`isPeriodActiveAt`/`periodOverlapsRange`/`findActivePeriodAt`) contra
 *    fixtures construídos por um SIMULADOR local (`applyManagerChange`,
 *    só deste arquivo de teste) que replica exatamente o comportamento
 *    DOCUMENTADO do trigger (fecha o período aberto, abre um novo, mesmo
 *    timestamp na troca) — prova que a camada de LEITURA responde certo
 *    pro tipo de dado que o trigger de fato produz, mesmo padrão já usado
 *    por `test-operation-channel-scoping.ts` (recompor o pipeline com
 *    fixtures quando não há Supabase de teste).
 * 2. Estrutural — o texto do `.sql` (integridade: índice único parcial,
 *    branches do trigger, ausência de policy de escrita, backfill nunca
 *    usa `operational_events`/data no passado) e dos 3 arquivos de
 *    aplicação que escrevem `primary_manager_id` (continuam
 *    byte-a-byte intocados).
 *
 * Rodar: npx tsx scripts/test-client-manager-assignments.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isPeriodActiveAt,
  periodOverlapsRange,
  findActivePeriodAt,
  type ClientManagerAssignmentPeriod,
} from "../src/lib/client-manager-assignments";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
}

function stripSqlComments(source: string): string {
  return source.replace(/--.*$/gm, "");
}

let seq = 0;
/**
 * Simulador local — replica o comportamento DOCUMENTADO do trigger
 * `sync_client_manager_assignment` (supabase/client-manager-assignments.sql):
 * fecha o período aberto do cliente (se houver) e abre um novo pro gestor
 * informado (se não for null), no MESMO instante — nunca escrito no app
 * real (a única escrita de verdade é o trigger, via SQL). Existe só pra
 * gerar fixtures realistas pras funções puras de leitura.
 */
function applyManagerChange(
  periods: ClientManagerAssignmentPeriod[],
  clientId: string,
  newManagerId: string | null,
  atIso: string,
): ClientManagerAssignmentPeriod[] {
  const next = periods.map((p) => (p.clientId === clientId && p.endedAt === null ? { ...p, endedAt: atIso } : p));
  if (newManagerId !== null) {
    seq++;
    next.push({ id: `sim-${seq}`, clientId, managerId: newManagerId, startedAt: atIso, endedAt: null });
  }
  return next;
}

function openPeriodsFor(periods: ClientManagerAssignmentPeriod[], clientId: string): ClientManagerAssignmentPeriod[] {
  return periods.filter((p) => p.clientId === clientId && p.endedAt === null);
}

const migrationSource = readFileSync(join(__dirname, "..", "supabase", "client-manager-assignments.sql"), "utf8");
const clientsActionsSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "clients", "actions.ts"), "utf8"));
const settingsClientsActionsSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "settings", "clients", "actions.ts"), "utf8"));
const agencyTreeActionsSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "agency-accounts-tree-actions.ts"), "utf8"));
const assignmentsLibSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "client-manager-assignments.ts"), "utf8"));
const teamPerformanceDataSource = stripComments(readFileSync(join(__dirname, "..", "src", "lib", "team-performance-data.ts"), "utf8"));

console.log("\n1 — cliente sem gestor → gestor A (atribuição inicial)\n");
{
  let periods: ClientManagerAssignmentPeriod[] = [];
  periods = applyManagerChange(periods, "cliente-1", "gestor-A", "2026-06-01T00:00:00.000Z");

  const open = openPeriodsFor(periods, "cliente-1");
  ok("exatamente 1 período aberto após a primeira atribuição", open.length === 1);
  ok("gestor correto no período aberto", open[0].managerId === "gestor-A");
  ok("started_at é o instante da atribuição, nenhuma data anterior inventada", open[0].startedAt === "2026-06-01T00:00:00.000Z");
  ok("consulta na própria data de início já resolve pro gestor A", findActivePeriodAt(periods, "2026-06-01T00:00:00.000Z")?.managerId === "gestor-A");
  ok("consulta ANTES da atribuição não resolve ninguém (não inventa histórico)", findActivePeriodAt(periods, "2026-01-01T00:00:00.000Z") === undefined);
}

console.log("\n2 — gestor A → gestor B (troca)\n");
{
  let periods: ClientManagerAssignmentPeriod[] = [];
  periods = applyManagerChange(periods, "cliente-1", "gestor-A", "2026-06-01T00:00:00.000Z");
  periods = applyManagerChange(periods, "cliente-1", "gestor-B", "2026-08-20T00:00:00.000Z");

  const open = openPeriodsFor(periods, "cliente-1");
  ok("exatamente 1 período aberto após a troca (o anterior foi encerrado)", open.length === 1);
  ok("período aberto agora é do gestor B", open[0].managerId === "gestor-B");
  const closedA = periods.find((p) => p.managerId === "gestor-A");
  ok("período de A foi encerrado (ended_at preenchido)", closedA?.endedAt === "2026-08-20T00:00:00.000Z");
}

console.log("\n3 — gestor B → sem gestor (remoção)\n");
{
  let periods: ClientManagerAssignmentPeriod[] = [];
  periods = applyManagerChange(periods, "cliente-1", "gestor-A", "2026-06-01T00:00:00.000Z");
  periods = applyManagerChange(periods, "cliente-1", "gestor-B", "2026-08-20T00:00:00.000Z");
  periods = applyManagerChange(periods, "cliente-1", null, "2026-09-10T00:00:00.000Z");

  ok("nenhum período aberto após remover o gestor", openPeriodsFor(periods, "cliente-1").length === 0);
  const closedB = periods.find((p) => p.managerId === "gestor-B");
  ok("período de B foi encerrado no instante da remoção", closedB?.endedAt === "2026-09-10T00:00:00.000Z");
  ok("consulta depois da remoção não resolve ninguém (cliente genuinamente sem gestor)", findActivePeriodAt(periods, "2026-09-15T00:00:00.000Z") === undefined);
}

console.log("\n4 — sem gestor → gestor C novamente (reatribuição após remoção)\n");
{
  let periods: ClientManagerAssignmentPeriod[] = [];
  periods = applyManagerChange(periods, "cliente-1", "gestor-A", "2026-06-01T00:00:00.000Z");
  periods = applyManagerChange(periods, "cliente-1", "gestor-B", "2026-08-20T00:00:00.000Z");
  periods = applyManagerChange(periods, "cliente-1", null, "2026-09-10T00:00:00.000Z");
  periods = applyManagerChange(periods, "cliente-1", "gestor-C", "2026-09-20T00:00:00.000Z");

  const open = openPeriodsFor(periods, "cliente-1");
  ok("exatamente 1 período aberto, do gestor C", open.length === 1 && open[0].managerId === "gestor-C");
  ok("3 períodos no total (A, B, C) — o hiato sem gestor NUNCA vira um período fictício", periods.filter((p) => p.clientId === "cliente-1").length === 3);
  ok("consulta durante o hiato (sem gestor) continua sem resolver ninguém", findActivePeriodAt(periods, "2026-09-15T00:00:00.000Z") === undefined);
  ok("consulta no início do novo período já resolve pro gestor C", findActivePeriodAt(periods, "2026-09-20T00:00:00.000Z")?.managerId === "gestor-C");
}

console.log("\n5 — atribuição inicial não pressupõe nenhum período anterior\n");
{
  const periods = applyManagerChange([], "cliente-novo", "gestor-A", "2026-09-01T00:00:00.000Z");
  ok("cliente novo, primeira atribuição: exatamente 1 período, sem nenhum período anterior fechado", periods.length === 1);
}

console.log("\n6 — troca exatamente no limite entre períodos (mesmo instante)\n");
{
  let periods: ClientManagerAssignmentPeriod[] = [];
  periods = applyManagerChange(periods, "cliente-1", "gestor-A", "2026-06-01T00:00:00.000Z");
  const boundary = "2026-08-20T14:30:00.000Z";
  periods = applyManagerChange(periods, "cliente-1", "gestor-B", boundary);

  ok("no instante EXATO da troca, o período NOVO (B) já responde — nunca o antigo (A)", findActivePeriodAt(periods, boundary)?.managerId === "gestor-B");
  ok("1 milissegundo antes do limite, ainda é o gestor A", findActivePeriodAt(periods, "2026-08-20T14:29:59.999Z")?.managerId === "gestor-A");
}

console.log("\n7 — nenhum overlap entre assignments do mesmo cliente\n");
{
  let periods: ClientManagerAssignmentPeriod[] = [];
  periods = applyManagerChange(periods, "cliente-1", "gestor-A", "2026-06-01T00:00:00.000Z");
  periods = applyManagerChange(periods, "cliente-1", "gestor-B", "2026-08-20T00:00:00.000Z");
  periods = applyManagerChange(periods, "cliente-1", null, "2026-09-10T00:00:00.000Z");
  periods = applyManagerChange(periods, "cliente-1", "gestor-C", "2026-09-20T00:00:00.000Z");

  const clientPeriods = periods.filter((p) => p.clientId === "cliente-1");
  let hasOverlap = false;
  for (let i = 0; i < clientPeriods.length; i++) {
    for (let j = i + 1; j < clientPeriods.length; j++) {
      const a = clientPeriods[i];
      const b = clientPeriods[j];
      const aEnd = a.endedAt ?? "9999-12-31T23:59:59.999Z";
      const bEnd = b.endedAt ?? "9999-12-31T23:59:59.999Z";
      if (a.startedAt < bEnd && b.startedAt < aEnd) hasOverlap = true;
    }
  }
  ok("nenhum par de períodos do mesmo cliente se sobrepõe", !hasOverlap);
}

console.log("\n8 — somente um período aberto por cliente, em cada etapa da sequência\n");
{
  let periods: ClientManagerAssignmentPeriod[] = [];
  const steps: [string | null, string][] = [
    ["gestor-A", "2026-06-01T00:00:00.000Z"],
    ["gestor-B", "2026-08-20T00:00:00.000Z"],
    [null, "2026-09-10T00:00:00.000Z"],
    ["gestor-C", "2026-09-20T00:00:00.000Z"],
    ["gestor-A", "2026-10-01T00:00:00.000Z"],
  ];
  for (const [managerId, atIso] of steps) {
    periods = applyManagerChange(periods, "cliente-1", managerId, atIso);
    ok(`após mudar pra ${managerId ?? "null"} em ${atIso}: no máximo 1 período aberto`, openPeriodsFor(periods, "cliente-1").length <= 1);
  }
}

console.log('\n9 — consulta "gestor responsável em determinada data"\n');
{
  let periods: ClientManagerAssignmentPeriod[] = [];
  periods = applyManagerChange(periods, "cliente-1", "gestor-A", "2026-06-01T00:00:00.000Z");
  periods = applyManagerChange(periods, "cliente-1", "gestor-B", "2026-08-20T00:00:00.000Z");

  ok("15/09/2026 (dentro do período de B): resolve gestor-B", findActivePeriodAt(periods, "2026-09-15T00:00:00.000Z")?.managerId === "gestor-B");
  ok("15/07/2026 (dentro do período de A): resolve gestor-A", findActivePeriodAt(periods, "2026-07-15T00:00:00.000Z")?.managerId === "gestor-A");
  ok("01/01/2026 (antes de qualquer período): não resolve ninguém", findActivePeriodAt(periods, "2026-01-01T00:00:00.000Z") === undefined);
}

console.log('\n10 — consulta "carteira do gestor em determinada data"\n');
{
  let periods: ClientManagerAssignmentPeriod[] = [];
  // Vini com cliente-X o mês inteiro, cliente-Y só na segunda metade.
  periods = applyManagerChange(periods, "cliente-x", "vini", "2026-09-01T00:00:00.000Z");
  periods = applyManagerChange(periods, "cliente-y", "salles", "2026-09-01T00:00:00.000Z");
  periods = applyManagerChange(periods, "cliente-y", "vini", "2026-09-15T00:00:00.000Z");

  function portfolioAt(allPeriods: ClientManagerAssignmentPeriod[], managerId: string, atIso: string): string[] {
    return Array.from(new Set(allPeriods.filter((p) => p.managerId === managerId && isPeriodActiveAt(p, atIso)).map((p) => p.clientId)));
  }

  const portfolioSept10 = portfolioAt(periods, "vini", "2026-09-10T00:00:00.000Z");
  const portfolioSept20 = portfolioAt(periods, "vini", "2026-09-20T00:00:00.000Z");
  ok("10/09: carteira de Vini tem só cliente-x (cliente-y ainda é do Salles)", portfolioSept10.length === 1 && portfolioSept10[0] === "cliente-x");
  ok("20/09: carteira de Vini já tem cliente-x E cliente-y", portfolioSept20.length === 2 && portfolioSept20.includes("cliente-x") && portfolioSept20.includes("cliente-y"));
  ok(
    "20/09: cliente-y NUNCA aparece na carteira do Salles nessa data (já foi transferido)",
    portfolioAt(periods, "salles", "2026-09-20T00:00:00.000Z").length === 0,
  );
}

console.log("\n10b — periodOverlapsRange: carteira do gestor DURANTE um mês inteiro (overlap, não posse total)\n");
{
  let periods: ClientManagerAssignmentPeriod[] = [];
  periods = applyManagerChange(periods, "cliente-x", "vini", "2026-08-25T00:00:00.000Z");
  periods = applyManagerChange(periods, "cliente-x", "salles", "2026-09-05T00:00:00.000Z");

  const septRange: [string, string] = ["2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"];
  const viniPeriod = periods.find((p) => p.managerId === "vini")!;
  const sallesPeriod = periods.find((p) => p.managerId === "salles")!;

  ok("período de Vini (termina 05/09) tem overlap com setembro, mesmo tendo passado a maior parte em agosto", periodOverlapsRange(viniPeriod, septRange[0], septRange[1]));
  ok("período de Salles (começa 05/09) tem overlap com setembro", periodOverlapsRange(sallesPeriod, septRange[0], septRange[1]));
}

console.log("\n11 — cliente existente antes da implantação NÃO ganha histórico fictício (backfill)\n");
{
  const backfillMatch = /insert into client_manager_assignments \(organization_id, client_id, manager_id, started_at\)\nselect tm\.organization_id[\s\S]*?\);/.exec(migrationSource);
  ok("bloco de backfill encontrado no .sql", backfillMatch !== null);
  const backfillBlock = backfillMatch?.[0] ?? "";

  ok("backfill usa started_at = now() — nunca uma data passada/inventada", /started_at\)\s*\nselect[\s\S]*?now\(\)/.test(backfillBlock) || /now\(\)/.test(backfillBlock));
  ok("backfill NUNCA lê operational_events (nunca reconstrói via client_manager_assigned/changed)", !/operational_events/.test(backfillBlock));
  ok("backfill NUNCA escreve uma data literal do passado (só now())", !/'20\d\d-\d\d-\d\d/.test(backfillBlock));
  ok(
    "decisão do backfill está documentada explicitamente no arquivo (por que não inventa histórico)",
    /NÃO inventar histórico/.test(migrationSource) && /nunca uma data anterior inventada/.test(migrationSource),
  );
}

console.log("\n12 — primary_manager_id continua consistente com o período aberto (trigger cobre insert E update)\n");
{
  ok("trigger AFTER INSERT existe (cliente criado já com gestor)", /after insert on clients/.test(migrationSource));
  ok("trigger AFTER UPDATE existe (troca/remoção/reatribuição)", /after update on clients/.test(migrationSource));
  ok(
    "branch de UPDATE só reage quando primary_manager_id de fato mudou (is distinct from — cobre null corretamente)",
    /new\.primary_manager_id is distinct from old\.primary_manager_id/.test(migrationSource),
  );
  ok("fecha o período do gestor ANTERIOR antes de abrir o novo (ordem: update ... set ended_at, depois insert)", (() => {
    const updateBranch = migrationSource.indexOf("if new.primary_manager_id is distinct from old.primary_manager_id then");
    const closeIdx = migrationSource.indexOf("set ended_at = now()", updateBranch);
    const openIdx = migrationSource.indexOf("insert into client_manager_assignments", closeIdx);
    return updateBranch > -1 && closeIdx > updateBranch && openIdx > closeIdx;
  })());
  ok(
    "índice único parcial garante no máximo 1 período aberto por cliente (regra de integridade principal)",
    /create unique index if not exists client_manager_assignments_open_unique[\s\S]{0,120}where ended_at is null/.test(migrationSource),
  );
  ok("trigger roda security definer (atômico/transacional, mesmo padrão de guard_client_manager_update)", /security definer set search_path = public/.test(migrationSource));
}

console.log("\n13 — fluxos existentes de criação/edição de cliente continuam funcionando (3 caminhos intocados)\n");
{
  ok(
    "createClientAction ainda grava primary_manager_id normalmente (nenhuma mudança)",
    /primary_manager_id: optionalText\(formData, "primary_manager_id"\)/.test(clientsActionsSource),
  );
  ok("updateClientAction ainda faz update normal de clients (nenhuma mudança)", /\.from\("clients"\)\s*\n\s*\.update\(\{/.test(clientsActionsSource));
  ok(
    "updateClientPrimaryManagerAction (settings/clients) continua fazendo o mesmo update direto",
    /\.from\("clients"\)\.update\(\{ primary_manager_id: newManagerId \}\)/.test(settingsClientsActionsSource),
  );
  ok(
    "moveClientAction (árvore/drag-and-drop) continua escrevendo primary_manager_id + wallet_position juntos",
    /\.update\(\{ primary_manager_id: newManagerId, wallet_position: positionResult\.position \}\)/.test(agencyTreeActionsSource),
  );
  ok("nenhum dos 3 arquivos de ação passou a escrever em client_manager_assignments diretamente", !/client_manager_assignments/.test(clientsActionsSource) && !/client_manager_assignments/.test(settingsClientsActionsSource) && !/client_manager_assignments/.test(agencyTreeActionsSource));
}

console.log("\n14 — eventos existentes (client_manager_assigned/changed) continuam funcionando, sem duplicação\n");
{
  ok("CLIENT_MANAGER_ASSIGNED continua emitido em createClientAction", /OperationalEventType\.CLIENT_MANAGER_ASSIGNED/.test(clientsActionsSource));
  ok("CLIENT_MANAGER_CHANGED continua emitido em updateClientAction", /OperationalEventType\.CLIENT_MANAGER_CHANGED/.test(clientsActionsSource));
  ok("settings/clients: ASSIGNED/CHANGED continuam emitidos condicionalmente", /CLIENT_MANAGER_CHANGED\s*\n\s*: OperationalEventType\.CLIENT_MANAGER_ASSIGNED/.test(settingsClientsActionsSource));
  ok("árvore: CLIENT_MANAGER_CHANGED continua emitido no drag-and-drop", /OperationalEventType\.CLIENT_MANAGER_CHANGED/.test(agencyTreeActionsSource));
  ok(
    "a nova tabela/trigger NUNCA escreve em operational_events (função pura de histórico, nunca um segundo event engine)",
    !/operational_events/.test(stripSqlComments(migrationSource)),
  );
  ok("lib/client-manager-assignments.ts nunca escreve em operational_events", !/operational_events/.test(assignmentsLibSource));
}

console.log("\n15 — client_manager_assignments é só-leitura a partir do código de aplicação\n");
{
  ok("RLS: só existe policy de SELECT (nenhuma de insert/update/delete)", /create policy client_manager_assignments_select/.test(migrationSource) && !/create policy client_manager_assignments_(insert|update|delete)/.test(migrationSource));
  ok("lib/client-manager-assignments.ts só usa .select() na tabela nova, nunca .insert/.update/.upsert/.delete", /\.from\("client_manager_assignments"\)/.test(assignmentsLibSource) && !/\.from\("client_manager_assignments"\)[\s\S]{0,80}\.(insert|update|upsert|delete)\(/.test(assignmentsLibSource));
  ok(
    "team-performance-data.ts (UI de histórico) também só lê — nunca escreve na tabela nova",
    !/\.from\("client_manager_assignments"\)/.test(teamPerformanceDataSource) || !/\.(insert|update|upsert|delete)\(/.test(teamPerformanceDataSource),
  );
}

console.log("\n16 — nenhuma nota/score/ranking/bônus na UI de histórico de carteira\n");
{
  const teamProfilePageSource = stripComments(readFileSync(join(__dirname, "..", "src", "app", "team", "[id]", "page.tsx"), "utf8"));
  ok('seção se chama "Histórico de carteira" (fato, não métrica)', /Histórico de carteira/.test(teamProfilePageSource));
  ok("nenhuma contagem agregada (ex.: 'X clientes ao longo do tempo') foi adicionada junto", !/ao longo do tempo|total de clientes já geridos/i.test(teamProfilePageSource));
  ok("nenhuma palavra de score/ranking/nível/bônus na página do perfil", !/\bscore\b|\branking\b|\bn[íi]vel\b|b[oô]nus/i.test(teamProfilePageSource));
}

console.log(`\nTodos os ${passed} testes passaram.`);
