/**
 * Script isolado para testar a sync com a Meta Insights API antes de ligar
 * no botão da UI.
 *
 * Uso:
 *   npm run sync:meta -- <client_id>
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const clientId = process.argv[2];

  if (!clientId) {
    console.error("Uso: npm run sync:meta -- <client_id>");
    process.exit(1);
  }

  const { syncClientMetaSpend } = await import("../src/lib/meta-sync");
  const result = await syncClientMetaSpend(clientId);

  console.log(`Cliente ${result.clientId}: ${result.daysSynced} dia(s) de spend sincronizado(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
