/**
 * Testes da Etapa "Conexão Google Ads" — Fase 1 (base de cadastro/schema,
 * sem sincronização de dados ainda, que depende de credenciais que o
 * usuário ainda não tem: Developer Token e OAuth Client do Google Cloud).
 * Pedido do usuário: "preciso fazer a conexão do Google Ads aqui com o
 * sistema" — confirmado que a Mitza ainda não tem conta Gerenciadora (MCC)
 * nem nenhuma das duas credenciais, então esta fase cobre só o que não
 * depende delas: o Google Ads Customer ID passa a ser um campo de
 * cadastro do cliente, no MESMO padrão exato já usado pelo Meta
 * (`meta_ad_account_id`/`validateMetaAccountRequirement`) — obrigatório
 * só condicionalmente, quando "google" está marcado em `media_channels`
 * (já aceito ali desde sempre, `client-media-channels.sql`).
 *
 * `createClientAction`/`updateClientAction`/`readClientFields`/
 * `validateGoogleAdsAccountRequirement` vivem num arquivo `"use server"`
 * (`src/app/clients/actions.ts`) — mesma limitação estrutural de
 * `test-client-registration-simplification.ts`: verificação por código-fonte,
 * nunca uma reimplementação paralela da regra.
 *
 * Rodar: npx tsx scripts/test-koff-conexao-google-ads.ts
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
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n");
}

const actionsSource = loadSource("src", "app", "clients", "actions.ts");
const actionsCode = stripComments(actionsSource);
const clientFormSource = loadSource("src", "app", "clients", "client-form.tsx");
const editPageSource = loadSource("src", "app", "clients", "[id]", "edit", "page.tsx");
const migrationSource = loadSource("supabase", "google-ads-integration.sql");
const migrationCode = migrationSource.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
const dbTypesSource = loadSource("src", "lib", "supabase", "database.types.ts");

console.log("\n1 — validateGoogleAdsAccountRequirement: mesma regra condicional de validateMetaAccountRequirement\n");
{
  ok(
    "validateGoogleAdsAccountRequirement existe e checa media_channels.includes('google')",
    /function validateGoogleAdsAccountRequirement[\s\S]*?mediaChannels\.includes\("google"\)/.test(actionsCode),
  );
  ok(
    "a regra só bloqueia quando google está marcado E a conta está vazia (&&, nunca ||)",
    /mediaChannels\.includes\("google"\)\s*&&\s*!googleAdsCustomerId/.test(actionsCode),
  );
  ok(
    "createClientAction chama validateGoogleAdsAccountRequirement antes do insert",
    /validateGoogleAdsAccountRequirement\(structural\.media_channels, google_ads_customer_id\)/.test(actionsCode),
  );
  ok(
    "updateClientAction também chama validateGoogleAdsAccountRequirement (mesma regra nos dois fluxos)",
    (actionsCode.match(/validateGoogleAdsAccountRequirement\(structural\.media_channels, google_ads_customer_id\)/g) ?? []).length === 2,
  );
  ok(
    "google_ads_customer_id é lido como opcional (optionalText), igual meta_ad_account_id",
    /google_ads_customer_id: optionalText\(formData, "google_ads_customer_id"\)/.test(actionsCode),
  );
  ok("createClientAction grava google_ads_customer_id no insert", /\.insert\(\{ name, meta_ad_account_id, google_ads_customer_id,/.test(actionsCode));
  ok("updateClientAction grava google_ads_customer_id no update", /google_ads_customer_id,\s*\n\s*\.\.\.structural,/.test(actionsCode));
}

console.log("\n2 — Formulário: campo espelha exatamente o padrão do Meta (opcional por padrão, nunca `required` fixo)\n");
{
  ok("o input existe com o name correto", /name="google_ads_customer_id"/.test(clientFormSource));
  ok(
    "o input não tem `required` fixo (obrigatoriedade é só condicional, decidida no servidor)",
    !/name="google_ads_customer_id"[\s\S]{0,120}required/.test(clientFormSource),
  );
  ok("placeholder/format mostra o formato certo (10 dígitos, sem hífen)", /placeholder="1234567890"/.test(clientFormSource) && /pattern="\[0-9\]\{10\}"/.test(clientFormSource));
  ok(
    "estado googleChannelChecked existe e nasce do mesmo Set mediaChannels usado pelo Meta",
    /const \[googleChannelChecked, setGoogleChannelChecked\] = useState\(mediaChannels\.has\("google"\)\)/.test(clientFormSource),
  );
  ok(
    "marcar/desmarcar o canal Google atualiza o estado (mesmo onChange do checkbox de canais)",
    /if \(channel === "google"\) setGoogleChannelChecked\(event\.target\.checked\)/.test(clientFormSource),
  );
  ok(
    "defaultGoogleAdsCustomerId é aceito como prop e usado como defaultValue do input",
    /defaultGoogleAdsCustomerId\?: string \| null/.test(clientFormSource) && /defaultValue=\{defaultGoogleAdsCustomerId \?\? ""\}/.test(clientFormSource),
  );
  ok(
    "a página de edição passa client.google_ads_customer_id pro formulário",
    /defaultGoogleAdsCustomerId=\{client\.google_ads_customer_id\}/.test(editPageSource),
  );
}

console.log("\n3 — Schema: coluna nova + formato (10 dígitos) + provider 'google_ads' habilitado onde 'meta_api' já está\n");
{
  ok(
    "clients.google_ads_customer_id é adicionada como nullable (cliente Google-only de verdade é o caso raro, mas suportado desde o início — nunca not null)",
    /add column if not exists google_ads_customer_id text;/.test(migrationCode),
  );
  ok(
    "formato exigido quando preenchido: exatamente 10 dígitos, sem hífen (nunca texto livre)",
    /google_ads_customer_id is null or google_ads_customer_id ~ '\^\[0-9\]\{10\}\$'/.test(migrationCode),
  );
  ok(
    "import_sources aceita o provider novo 'google_ads', sem remover 'stract'/'meta_api' já existentes",
    /import_sources_provider_check check \(provider in \('stract', 'meta_api', 'google_ads'\)\)/.test(migrationCode),
  );
  ok(
    "daily_performance aceita o mesmo provider novo (upsert de resultado do pipeline Google usaria esse valor)",
    /daily_performance_provider_check check \(provider in \('stract', 'meta_api', 'google_ads'\)\)/.test(migrationCode),
  );
}

console.log("\n4 — Tipos TypeScript: ImportProviderDb e clients.google_ads_customer_id refletem o schema novo\n");
{
  ok("ImportProviderDb inclui 'google_ads'", /export type ImportProviderDb = "stract" \| "meta_api" \| "google_ads";/.test(dbTypesSource));
  ok(
    "clients Row/Insert/Update têm google_ads_customer_id (3 ocorrências, mesmas 3 posições de meta_ad_account_id)",
    (dbTypesSource.match(/google_ads_customer_id\??: string \| null;/g) ?? []).length === 3,
  );
}

console.log(`\n${passed} verificações OK.\n`);
