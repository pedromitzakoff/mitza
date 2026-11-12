/**
 * KOFF Analytics — "Visualizações independentes por canal" (pedido
 * explícito do usuário, achado real: card de Resultado somava Meta Ads +
 * Google Ads quando os dois miravam o mesmo tipo de resultado — "não faz
 * sentido somar os dois... quero visualizações independentes").
 *
 * Causa raiz: `buildCockpitViewModel` sempre usava TODOS os canais
 * configurados do cliente (`clientChannels`) pra agrupar/consolidar
 * Investimento/Resultado/Custo — nunca existia um jeito de pedir "só Meta"
 * ou "só Google". A infraestrutura de seletor (`lib/traffic-channels.ts`:
 * `resolveClientChannelScopeOptions`/`resolveSelectedChannelScope`) já
 * existia de uma etapa anterior (pra uma tela "Visão Geral" que não existe
 * mais), mas nunca estava ligada ao Cockpit.
 *
 * Correção: `clientChannels` (o nome que TODO o resto da função já usava
 * pra decidir "quais canais entram no cálculo") passa a ser o recorte
 * EFETIVO — `allClientChannels` filtrado pelo `channelScope` resolvido da
 * URL (`?canal=meta|google|consolidated`). Nenhuma segunda lógica de
 * agrupamento nova: a mesma cascata de sempre (orçamento, grupos de
 * resultado, saldo/indicadores Meta, exploração, quebra por canal) já era
 * inteiramente escrita em cima de `clientChannels` — filtrar numa linha só
 * propaga pra tudo.
 *
 * Este ambiente não tem Supabase real — a cobertura é estrutural (grep de
 * código-fonte, mesmo padrão já usado por outras etapas que dependem de
 * `buildCockpitViewModel`/Supabase) + comportamental sobre as funções puras
 * já existentes (`lib/traffic-channels.ts`, intocadas, reaproveitadas).
 *
 * Rodar: npx tsx scripts/test-koff-visualizacao-independente-canal.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveClientChannelScopeOptions, resolveSelectedChannelScope } from "../src/lib/traffic-channels";

let passed = 0;
function ok(name: string, condition: boolean) {
  assert.ok(condition, `FALHOU: ${name}`);
  passed++;
  console.log(`  ok — ${name}`);
}
function loadSource(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", ...segments), "utf8");
}

const viewDataSource = loadSource("src", "lib", "cockpit-view-data.ts");
const cockpitViewSource = loadSource("src", "app", "clients", "cockpit-view.tsx");
const agencyPageSource = loadSource("src", "app", "clients", "[id]", "page.tsx");
const sharedPageSource = loadSource("src", "app", "r", "[token]", "page.tsx");

console.log("\n1 — funções puras existentes (lib/traffic-channels.ts) continuam intocadas, nenhuma segunda implementação\n");
{
  ok(
    "cliente 1 canal só: nenhuma opção de seletor (nada pra escolher)",
    resolveClientChannelScopeOptions(["meta"]).length <= 1,
  );
  ok(
    "cliente 2 canais: 3 opções (meta, google, consolidated), meta primeiro",
    JSON.stringify(resolveClientChannelScopeOptions(["meta", "google"])) === JSON.stringify(["meta", "google", "consolidated"]),
  );
  ok(
    "sem parâmetro na URL: cai no default (meta primeiro, NUNCA consolidated quando meta existe) — correção direta do bug relatado",
    resolveSelectedChannelScope(undefined, ["meta", "google"]) === "meta",
  );
  ok(
    "parâmetro explícito 'consolidated' é honrado (usuário pode voltar pro somado se quiser)",
    resolveSelectedChannelScope("consolidated", ["meta", "google"]) === "consolidated",
  );
  ok(
    "parâmetro inválido pra este cliente (ex.: 'google' num cliente só-Meta) cai no default, nunca quebra",
    resolveSelectedChannelScope("google", ["meta"]) === "meta",
  );
}

console.log("\n2 — buildCockpitViewModel: clientChannels vira o recorte EFETIVO (allClientChannels filtrado pelo canal resolvido)\n");
{
  ok(
    "allClientChannels guarda a lista COMPLETA de canais do cliente (nunca perdida)",
    viewDataSource.includes("const allClientChannels = AVAILABLE_TRAFFIC_CHANNELS.filter"),
  );
  ok(
    "channelScope resolvido via resolveSelectedChannelScope (mesma função de sempre, nunca uma segunda regra)",
    viewDataSource.includes("const channelScope = resolveSelectedChannelScope(channelScopeParam, client.media_channels);"),
  );
  ok(
    "clientChannels = allClientChannels filtrado (consolidated = tudo, canal específico = só ele) — propaga pra toda a cascata existente",
    viewDataSource.includes(
      'const clientChannels: TrafficChannel[] = channelScope === "consolidated" ? allClientChannels : allClientChannels.filter((c) => c === channelScope);',
    ),
  );
  ok(
    "channelScopeOptions calculado a partir de TODOS os canais do cliente (allClientChannels via media_channels), nunca do recorte já filtrado",
    viewDataSource.includes("const channelScopeOptions = resolveClientChannelScopeOptions(client.media_channels);"),
  );
}

console.log("\n3 — efeito cascata: Meta Ads específico (saldo/indicadores/exploração) e orçamento/grupos de resultado continuam 100% derivados de clientChannels, nenhum cálculo duplicado\n");
{
  ok(
    "resolução da conta Meta (saldo/alcance) continua condicionada a clientChannels.includes('meta') — fica automaticamente fora quando o escopo é só Google",
    viewDataSource.includes('clientChannels.includes("meta") ? resolveMetaAdAccountId'),
  );
  ok(
    "showMetaSection (Indicadores Meta Ads + Campanhas/Anúncios) continua = clientChannels.includes('meta') — nenhuma segunda condição nova",
    viewDataSource.includes('const showMetaSection = clientChannels.includes("meta");'),
  );
  ok(
    "dashboardChannels (base do orçamento e dos grupos de resultado) continua mapeado a partir de clientChannels, não allClientChannels",
    viewDataSource.includes("const dashboardChannels = clientChannels.map((channel) => {"),
  );
}

console.log("\n4 — modelo exposto: channelScope/channelScopeOptions saem pro componente, nenhum dado novo buscado à toa\n");
{
  ok("CockpitViewModel expõe channelScopeOptions", viewDataSource.includes("channelScopeOptions: ChannelScope[];"));
  ok("CockpitViewModel expõe channelScope (já resolvido/validado)", viewDataSource.includes("channelScope: ChannelScope;"));
  ok(
    "buildCockpitChannelHref preserva o mês selecionado (mesmo padrão de buildCockpitMonthHref) e NUNCA omite 'canal' (sobrevive a refresh/link)",
    viewDataSource.includes('if (month) params.set("month", month);') && viewDataSource.includes('params.set("canal", channel);'),
  );
}

console.log("\n5 — UI: seletor só aparece quando há de fato mais de 1 opção, reaproveita VisaoGeralChannelSwitch (componente já existente, nunca um segundo seletor)\n");
{
  ok(
    "cockpit-view.tsx importa VisaoGeralChannelSwitch (infra pré-existente desta etapa, nunca reconstruída do zero)",
    cockpitViewSource.includes('import { VisaoGeralChannelSwitch } from "./visao-geral-channel-switch";'),
  );
  ok(
    "seletor condicionado a channelScopeOptions.length > 1 — cliente de 1 canal só (a maioria) nunca vê isto",
    cockpitViewSource.includes("{model.channelScopeOptions.length > 1 && ("),
  );
  ok(
    "buildHref do seletor usa buildCockpitChannelHref com basePath/monthParam do próprio modelo — preserva mês ao trocar canal",
    cockpitViewSource.includes("buildCockpitChannelHref(model.basePath, model.monthParam, channel)"),
  );
}

console.log("\n6 — as duas rotas (agência e link compartilhado) aceitam ?canal=, nenhuma delas expõe clientId pela URL\n");
{
  ok("[id]/page.tsx lê 'canal' do searchParams e repassa como channelScopeParam", agencyPageSource.includes("canal: channelScopeParam"));
  ok(
    "[id]/page.tsx passa channelScopeParam pra buildCockpitViewModel",
    /buildCockpitViewModel\(supabase, id, \{[\s\S]{0,200}channelScopeParam/.test(agencyPageSource),
  );
  ok("/r/[token] também lê 'canal' do searchParams (mesma funcionalidade nos dois visitantes, agência e cliente)", sharedPageSource.includes("canal?: string"));
  ok(
    "/r/[token] passa channelScopeParam pra buildCockpitViewModel — nunca um clientId cru na URL (continua resolvido só pelo token)",
    /buildCockpitViewModel\(supabase, clientId, \{[\s\S]{0,200}channelScopeParam/.test(sharedPageSource) && !sharedPageSource.includes("searchParams.clientId"),
  );
}

console.log(`\nTodos os ${passed} testes passaram.`);
