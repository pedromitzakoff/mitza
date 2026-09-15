/**
 * Testes da Etapa "Simplificação do Cadastro do Cliente" + Etapa
 * "Correção do Modelo de Autorização — Acesso Amplo Interno" (que revisou a
 * regra de acesso definida na primeira — ver seção 2 abaixo). Cobre os
 * pontos explicitamente pedidos que ainda não tinham teste dedicado:
 *
 * 1. Conta Meta condicionalmente obrigatória (obrigatória só quando "meta"
 *    está em `media_channels` — cliente Google-only nunca precisa dela).
 * 2. Autorização de escrita sobre um cliente é "usuário interno autorizado
 *    da KOFF" (qualquer `team_members` ativo, admin ou gestor,
 *    independente de ser `primary_manager_id` do cliente) — nunca
 *    "gestor de apoio" (`client_managers`, que nem participa da decisão) e
 *    nunca "precisa ser o gestor principal" (regra anterior, revertida).
 *    Cobre app (`lib/auth.ts`) e RLS (SQL).
 * 3. `DIMENSION_PRIORITY_ORDER`/`buildAttentionAlerts` sem influência de
 *    revisão (comportamental, direto — complementa
 *    `test-account-health-engine.ts`/`test-review-compliance.ts`, já
 *    atualizados nesta etapa pra refletir a regra nova).
 * 4. Operação por Canal (CPA-only) continua intocada por essas mudanças.
 *
 * `createClientAction`/`updateClientAction`/`readStructuralFields`/
 * `validateMetaAccountRequirement` vivem num arquivo `"use server"`
 * (`src/app/clients/actions.ts`) — Next.js exige que TODO export de um
 * arquivo `"use server"` seja uma Server Action assíncrona, então essas
 * funções internas são deliberadamente NÃO exportadas (exportar uma delas
 * pra testar quebraria essa regra). Mesma limitação estrutural já
 * documentada em `test-sync-actions-authorization.ts`/
 * `test-performance-report-auth.ts` (sem sessão HTTP real, sem cookies de
 * request, sem Supabase neste ambiente) — por isso a verificação dessas
 * partes é ESTRUTURAL (código-fonte), no mesmo padrão já estabelecido,
 * nunca uma reimplementação paralela da lógica que poderia divergir do
 * código real sem ninguém notar.
 *
 * Rodar: npx tsx scripts/test-client-registration-simplification.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { evaluateAccountHealth, DIMENSION_PRIORITY_ORDER, type AccountHealthInput } from "../src/lib/account-health-engine";
import { buildAttentionAlerts } from "../src/lib/attention-alerts";
import { resolveOperationCpaPriorityGroup } from "../src/lib/operation-triage";

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
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n");
}
function stripSqlComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const actionsSource = loadSource("src", "app", "clients", "actions.ts");
const actionsCode = stripComments(actionsSource);
const authSource = loadSource("src", "lib", "auth.ts");
const clientFormSource = loadSource("src", "app", "clients", "client-form.tsx");
const rlsMigrationSource = loadSource("supabase", "is-client-manager-internal-team.sql");
const metaOptionalMigrationSource = loadSource("supabase", "client-meta-account-optional.sql");

console.log("\n1 — Conta Meta condicionalmente obrigatória (nunca para cliente Google-only)\n");
{
  ok(
    "validateMetaAccountRequirement existe e checa media_channels.includes('meta')",
    /function validateMetaAccountRequirement[\s\S]*?mediaChannels\.includes\("meta"\)/.test(actionsCode),
  );
  ok(
    "a regra só bloqueia quando meta está marcado E a conta está vazia (&&, nunca ||)",
    /mediaChannels\.includes\("meta"\)\s*&&\s*!metaAdAccountId/.test(actionsCode),
  );
  ok("createClientAction chama validateMetaAccountRequirement antes do insert", /validateMetaAccountRequirement\(structural\.media_channels, meta_ad_account_id\)/.test(actionsCode));
  ok(
    "updateClientAction também chama validateMetaAccountRequirement (mesma regra nos dois fluxos)",
    (actionsCode.match(/validateMetaAccountRequirement\(structural\.media_channels, meta_ad_account_id\)/g) ?? []).length === 2,
  );
  ok(
    "meta_ad_account_id é lido como opcional (optionalText), nunca mais forçado a string sempre-presente",
    /meta_ad_account_id: optionalText\(formData, "meta_ad_account_id"\)/.test(actionsCode),
  );
  ok(
    "o input do formulário não tem mais `required` fixo na conta Meta (client-form.tsx)",
    !/name="meta_ad_account_id"[\s\S]{0,80}required/.test(clientFormSource),
  );
  ok(
    "o campo canais de mídia continua marcado como obrigatório na UI (asterisco logo após o rótulo)",
    /Canais de mídia[\s\S]{0,60}text-overview-danger/.test(clientFormSource),
  );
  ok(
    "constraint SQL: coluna deixou de ser NOT NULL",
    /alter table clients alter column meta_ad_account_id drop not null/.test(metaOptionalMigrationSource),
  );
  ok(
    "constraint SQL: formato act_\\d+ continua exigido quando preenchido (nunca aceita texto livre)",
    /meta_ad_account_id is null or meta_ad_account_id ~ '\^act_\[0-9\]\+\$'/.test(metaOptionalMigrationSource),
  );
}

console.log("\n2 — Autorização de escrita = usuário interno autorizado (não gestor de apoio, não 'só o gestor principal')\n");
{
  const authCode = stripComments(authSource);
  const requireClientManagerAccessSource = authCode.slice(authCode.indexOf("export async function requireClientManagerAccess"));

  ok("requireClientManagerAccess não consulta mais client_managers", !/client_managers/.test(requireClientManagerAccessSource));
  ok(
    "requireClientManagerAccess não restringe mais por primary_manager_id (regra anterior revertida)",
    !/primary_manager_id/.test(requireClientManagerAccessSource),
  );
  ok(
    "requireClientManagerAccess não consulta mais a tabela clients (não precisa mais saber QUAL cliente)",
    !/\.from\("clients"\)/.test(requireClientManagerAccessSource),
  );
  ok(
    "requireClientManagerAccess delega pra requireActiveProfile — qualquer perfil interno ativo passa",
    /return requireActiveProfile\(\)/.test(requireClientManagerAccessSource),
  );
  // `requireActiveProfile` (mesmo arquivo) já é a checagem canônica de
  // "existe um team_members ativo pra este auth.uid()?" — é exatamente
  // `getCurrentProfile()` (que já faz esse JOIN/filtro) sem checagem de
  // role adicional. Confirma que ela é a fonte reaproveitada, não uma
  // segunda implementação.
  ok(
    "requireActiveProfile só verifica 'existe perfil?' (getCurrentProfile), nenhuma checagem de role/cliente",
    /export async function requireActiveProfile[\s\S]*?getCurrentProfile\(\)[\s\S]*?redirect\("\/"\)/.test(authCode),
  );

  ok("createClientAction não escreve mais em client_managers", !/\.from\("client_managers"\)/.test(actionsCode));
  ok("updateClientAction não escreve mais em client_managers", !/client_managers/.test(actionsCode));
  ok("o formulário não envia mais manager_ids[] (fieldset 'Gestores de apoio' removido, não reintroduzido)", !/name="manager_ids"/.test(clientFormSource));
  ok(
    "o formulário não renderiza mais o fieldset 'Gestores de apoio' (só sobra a menção em comentário/docstring, removida da checagem)",
    !/Gestores de apoio/.test(stripComments(clientFormSource)),
  );

  const rlsMigrationCode = stripSqlComments(rlsMigrationSource);
  ok(
    "RLS: is_client_manager() novo reaproveita current_team_member_id() (fonte canônica de 'usuário interno ativo', já usada em 11 outras migrations)",
    /select current_team_member_id\(\) is not null/.test(rlsMigrationCode),
  );
  ok("RLS: is_client_manager() novo não consulta mais a tabela client_managers", !/from client_managers/.test(rlsMigrationCode));
  ok(
    "RLS: is_client_manager() novo não depende mais de primary_manager_id (nem pra conceder, nem pra restringir)",
    !/primary_manager_id/.test(rlsMigrationCode),
  );
  ok(
    "client_managers não é apagada (tabela física preservada, só sem consumidor de autorização)",
    !/drop table.*client_managers/i.test(rlsMigrationSource),
  );
  ok(
    "a migration anterior (regra 'só gestor principal') foi removida do repo, nunca chegou a ser aplicada",
    !existsSync(join(__dirname, "..", "supabase", "is-client-manager-primary-only.sql")),
  );
}

console.log("\n3 — Cadência de Revisões sem influência em saúde/prioridade (comportamental, direto)\n");
{
  check("'review' não está mais em DIMENSION_PRIORITY_ORDER", DIMENSION_PRIORITY_ORDER.includes("review" as never), false);

  function baseInput(overrides: Partial<AccountHealthInput> = {}): AccountHealthInput {
    return {
      investmentActual: 500,
      investmentPlanned: 1000,
      investmentHasSyncedData: true,
      resultActual: 10,
      resultPlanned: 10,
      hasPerformanceData: true,
      performanceGoalConfigured: true,
      costActual: 50,
      costPlanned: 50,
      monthExpectedPct: 50,
      reviewBusinessDaysAgo: null,
      reviewMaxBusinessDays: 5,
      ...overrides,
    };
  }
  const neverReviewed = evaluateAccountHealth(baseInput());
  check("conta saudável em tudo, nunca revisada -> dimensions.review ainda 'grave' (matemática preservada)", neverReviewed.dimensions.review.status, "grave");
  check("...mas healthStatus continua 'saudavel'", neverReviewed.healthStatus, "saudavel");
  check("...e resolveOperationCpaPriorityGroup (Operação) continua 'saudavel'", resolveOperationCpaPriorityGroup(neverReviewed), "saudavel");

  const alertsWithOverdueReview = buildAttentionAlerts({
    monthStatus: "dentro",
    isPeriodClosed: false,
    overdueTasksCount: 0,
    optimizationRecentlyDone: false,
    lastSyncedAt: new Date().toISOString(),
    currentSprintPlannedSpend: null,
    currentSprintTaskCount: 0,
    currentSprintUnassignedCount: 0,
    clientInactivityBusinessDays: 0,
  });
  ok(
    "buildAttentionAlerts nunca mais gera alerta 'otimizacao', mesmo com optimizationRecentlyDone=false",
    !alertsWithOverdueReview.some((a) => a.kind === "otimizacao"),
  );
}

console.log("\n4 — Operação por Canal (CPA-only) permanece intocada\n");
{
  const operationTriageSource = stripComments(loadSource("src", "lib", "operation-triage.ts"));
  const cpaFnSource = operationTriageSource.slice(
    operationTriageSource.indexOf("export function resolveOperationCpaPriorityGroup"),
    operationTriageSource.indexOf("export function describeOperationCpaReason"),
  );
  ok(
    "resolveOperationCpaPriorityGroup nunca leu dimensions.review — já era CPA-only antes desta etapa, continua sendo",
    !/dimensions\.review/.test(cpaFnSource),
  );
  ok(
    "lib/operation-channel-state-data.ts não foi tocado por esta etapa (sem client_managers, que nunca fez parte do pipeline de canal)",
    !/client_managers/.test(loadSource("src", "lib", "operation-channel-state-data.ts")),
  );
  // Suíte completa de regressão da Operação por Canal já roda à parte
  // (scripts/test-operation-channel-scoping.ts, 25 verificações) — aqui só
  // confirmamos que esta etapa não introduziu nenhuma referência nova.
}

console.log(`\n${passed} verificações passaram.`);
