/**
 * MITZA ONE — Busca direta na Meta (pedido do usuário: app próprio no Meta
 * Developers, dados a cada 5 minutos). Testa os núcleos puros novos:
 * `mapMetaInsightsRowToIngestRow` (lib/meta-api-fetch.ts — converte UMA
 * linha bruta da Graph API pro mesmo formato que `validateMetaApiIngestPayload`/
 * `ingestMetaApiPayload` já validam e gravam, reaproveitados sem alteração)
 * e `resolveSyncWindow` (lib/meta-api-direct-sync.ts — janela curta de
 * re-busca a cada execução).
 *
 * Rodar: npx tsx scripts/test-meta-api-direct-sync.ts
 */
import assert from "node:assert/strict";
import { mapMetaInsightsRowToIngestRow } from "../src/lib/meta-api-fetch";
import { resolveSyncWindow } from "../src/lib/meta-api-direct-sync";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

console.log("\nmapMetaInsightsRowToIngestRow\n");

check(
  "linha completa (campanha + conjunto + anúncio + posicionamento + ações) converte pro mesmo formato de MetaApiIngestRow",
  mapMetaInsightsRowToIngestRow({
    date_start: "2026-09-20",
    campaign_id: "120211000000001",
    campaign_name: "[CAPTACAO] | WhatsApp | Público aberto",
    adset_id: "120211000000011",
    adset_name: "Lookalike 1%",
    ad_id: "120211000000111",
    ad_name: "Vídeo depoimento",
    platform_position: "feed",
    spend: "245.30",
    impressions: "18452",
    reach: "15200",
    clicks: "312",
    actions: [
      { action_type: "lead", value: "4" },
      { action_type: "onsite_conversion.lead_grouped", value: "2" },
    ],
    action_values: [],
  }),
  {
    date: "2026-09-20",
    campaignId: "120211000000001",
    campaignName: "[CAPTACAO] | WhatsApp | Público aberto",
    adSetId: "120211000000011",
    adSetName: "Lookalike 1%",
    adId: "120211000000111",
    adName: "Vídeo depoimento",
    platformPosition: "feed",
    spend: 245.3,
    impressions: 18452,
    reach: 15200,
    clicks: 312,
    actions: { lead: 4, "onsite_conversion.lead_grouped": 2 },
    actionValues: undefined,
  },
);

check(
  "linha só de campanha (sem conjunto/anúncio/posicionamento/ações) -> campos opcionais undefined, nunca 0/vazio fabricado",
  mapMetaInsightsRowToIngestRow({
    date_start: "2026-09-20",
    campaign_id: "120211000000001",
    campaign_name: "Campanha única",
    spend: "100",
  }),
  {
    date: "2026-09-20",
    campaignId: "120211000000001",
    campaignName: "Campanha única",
    adSetId: undefined,
    adSetName: undefined,
    adId: undefined,
    adName: undefined,
    platformPosition: undefined,
    spend: 100,
    impressions: undefined,
    reach: undefined,
    clicks: undefined,
    actions: undefined,
    actionValues: undefined,
  },
);

check(
  "sem spend na resposta -> 0 (nunca NaN), mesma convenção de fetchDailySpend (lib/meta.ts)",
  mapMetaInsightsRowToIngestRow({ date_start: "2026-09-20", campaign_id: "1", campaign_name: "X" })?.spend,
  0,
);

check("linha sem campaign_id -> null (descartada antes de montar o payload, nunca enviada como lixo garantido)", mapMetaInsightsRowToIngestRow({ date_start: "2026-09-20", campaign_name: "X", spend: "10" }), null);
check("linha sem campaign_name -> null", mapMetaInsightsRowToIngestRow({ date_start: "2026-09-20", campaign_id: "1", spend: "10" }), null);

check(
  "action com valor não numérico é descartada silenciosamente (nunca propaga NaN pro payload) — mapa fica vazio, nunca a entrada inválida",
  mapMetaInsightsRowToIngestRow({
    date_start: "2026-09-20",
    campaign_id: "1",
    campaign_name: "X",
    spend: "10",
    actions: [{ action_type: "lead", value: "não é número" }],
  })?.actions,
  {},
);

console.log("\nresolveSyncWindow\n");

check("janela de 3 dias (hoje + 2 anteriores) — mesmo fuso/formato YYYY-MM-DD do resto da plataforma", resolveSyncWindow("2026-10-08"), {
  since: "2026-10-06",
  until: "2026-10-08",
});
check("funciona na virada de mês (sem bug de subtração de dia negativo)", resolveSyncWindow("2026-03-01"), {
  since: "2026-02-27",
  until: "2026-03-01",
});
check("funciona na virada de ano", resolveSyncWindow("2026-01-01"), { since: "2025-12-30", until: "2026-01-01" });

console.log(`\n${passed} verificações passaram.`);
