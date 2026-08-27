/**
 * Testes puros da Etapa "Canais Ativos por Cliente" — as 4 funções em
 * `lib/traffic-channels.ts` que decidem quais canais um cliente pode ver
 * na Visão Geral, qual é o padrão ao abrir, e qual fica efetivamente
 * selecionado (respeitando escolha manual). Fonte única de verdade:
 * `clients.media_channels` — nunca `import_sources.enabled` (sincronização
 * automática) nem presença de dado num mês (ver comentário de
 * `resolveSelectedChannelScope`).
 *
 * Rodar: npx tsx scripts/test-client-channels.ts
 */
import assert from "node:assert/strict";
import {
  resolveClientMediaChannels,
  resolveClientChannelScopeOptions,
  resolveDefaultClientChannelScope,
  resolveSelectedChannelScope,
} from "../src/lib/traffic-channels";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

console.log("\nMeta-only — só Meta, default Meta\n");
{
  check("options = [meta]", resolveClientChannelScopeOptions(["meta"]), ["meta"]);
  check("Consolidado não aparece com 1 canal só", resolveClientChannelScopeOptions(["meta"]).includes("consolidated"), false);
  check("default = meta", resolveDefaultClientChannelScope(["meta"]), "meta");
}

console.log("\nGoogle-only — só Google, default Google\n");
{
  check("options = [google]", resolveClientChannelScopeOptions(["google"]), ["google"]);
  check("Consolidado não aparece com 1 canal só", resolveClientChannelScopeOptions(["google"]).includes("consolidated"), false);
  check("default = google", resolveDefaultClientChannelScope(["google"]), "google");
}

console.log("\nMeta + Google — Meta, Google, Consolidado (nesta ordem), default Meta\n");
{
  check("options = [meta, google, consolidated], Meta primeiro, Consolidado por último", resolveClientChannelScopeOptions(["meta", "google"]), [
    "meta",
    "google",
    "consolidated",
  ]);
  check(
    "ordem de entrada no dado não importa — [google, meta] produz a MESMA ordem de exibição",
    resolveClientChannelScopeOptions(["google", "meta"]),
    ["meta", "google", "consolidated"],
  );
  check("default = meta (nunca consolidado, mesmo com os dois ativos)", resolveDefaultClientChannelScope(["meta", "google"]), "meta");
}

console.log("\nCanal configurado sem dados no mês — continua disponível (decisão de configuração, não de dado)\n");
{
  // As funções nem recebem argumento de "teve dado este mês" — a
  // disponibilidade vem 100% de `media_channels`, nunca da presença de
  // uma linha em daily_spend/daily_performance. Isso já É a prova: não
  // existe parâmetro pra "zerar" um canal por falta de dado pontual.
  check(
    "Google continua nas opções mesmo sem qualquer sinal de dado passado à função",
    resolveClientChannelScopeOptions(["meta", "google"]).includes("google"),
    true,
  );
}

console.log("\nSeleção manual não é resetada indevidamente\n");
{
  check("param ausente (primeira visita) -> cai pro default (meta)", resolveSelectedChannelScope(undefined, ["meta", "google"]), "meta");
  check("param='google', cliente Meta+Google -> respeita a escolha manual", resolveSelectedChannelScope("google", ["meta", "google"]), "google");
  check(
    "param='consolidated', cliente Meta+Google -> respeita a escolha manual",
    resolveSelectedChannelScope("consolidated", ["meta", "google"]),
    "consolidated",
  );
  check(
    "param repetido em renders sucessivos continua o mesmo (nunca 'gruda' de volta em meta)",
    [
      resolveSelectedChannelScope("google", ["meta", "google"]),
      resolveSelectedChannelScope("google", ["meta", "google"]),
      resolveSelectedChannelScope("google", ["meta", "google"]),
    ],
    ["google", "google", "google"],
  );
  check(
    "param='google' mas cliente é só Meta (link antigo/reconfigurado) -> inválido pra este cliente, cai pro default",
    resolveSelectedChannelScope("google", ["meta"]),
    "meta",
  );
  check(
    "param='consolidated' mas cliente só tem 1 canal -> inválido (não existe Consolidado pra consolidar), cai pro default",
    resolveSelectedChannelScope("consolidated", ["meta"]),
    "meta",
  );
}

console.log("\nDados legados/inconsistentes — nunca uma tela sem opção nenhuma\n");
{
  check("media_channels null (cliente pré-migration) -> cai pra ['meta']", resolveClientMediaChannels(null), ["meta"]);
  check("media_channels [] (nunca deveria acontecer, constraint no banco impede) -> cai pra ['meta']", resolveClientMediaChannels([]), ["meta"]);
  check(
    "valor inesperado fora de meta/google (ex.: 'tiktok', não selecionável ainda) é filtrado, sobra vazio -> cai pra ['meta']",
    resolveClientMediaChannels(["tiktok"]),
    ["meta"],
  );
  check("valor válido misturado com inválido -> mantém só o válido", resolveClientMediaChannels(["google", "linkedin"]), ["google"]);
}

console.log(`\n${passed} verificações passaram.`);
