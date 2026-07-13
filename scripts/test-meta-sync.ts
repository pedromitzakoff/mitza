/**
 * Testa a sincronização do Meta para UMA única conta, sem afetar as demais
 * e sem persistir nada por padrão — pensado pra validar a integração antes
 * de rodar a sincronização real (botão/cron) contra todos os clientes.
 *
 * Uso:
 *   npm run test:meta -- <client_id>              (dry-run — só mostra)
 *   npm run test:meta -- <client_id> --commit     (também salva em daily_spend)
 *
 * Nunca hardcoda cliente nenhum: o client_id é sempre passado por argumento.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const clientId = process.argv[2];
  const shouldCommit = process.argv.includes("--commit");

  if (!clientId) {
    console.error("Uso: npm run test:meta -- <client_id> [--commit]");
    process.exit(1);
  }

  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { fetchDailySpend, MetaSyncError } = await import("../src/lib/meta");
  const { currentMonthRange, computeSprintEffectiveSpend, sumActualSpendForMonth } = await import(
    "../src/lib/sprint-financials"
  );
  const { todayDateString } = await import("../src/lib/today");

  const supabase = createAdminClient();

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id, deleted_at")
    .eq("id", clientId)
    .single();

  if (clientError || !client) {
    console.error(`Cliente ${clientId} não encontrado.`);
    process.exit(1);
  }

  if (client.deleted_at) {
    console.error(`Cliente "${client.name}" está excluído — teste abortado.`);
    process.exit(1);
  }

  if (!client.meta_ad_account_id) {
    console.error(`Cliente "${client.name}" não tem conta de anúncios da Meta configurada — nada a sincronizar.`);
    process.exit(1);
  }

  const { firstDay, lastDay } = currentMonthRange();
  const today = todayDateString();
  console.log(`Cliente: ${client.name} (${client.meta_ad_account_id})`);
  console.log(`Período consultado: ${firstDay} até ${today}\n`);

  let fetched;
  try {
    fetched = await fetchDailySpend(client.meta_ad_account_id, firstDay, today);
  } catch (err) {
    if (err instanceof MetaSyncError) {
      console.error(`Erro (${err.kind}): ${err.message}`);
    } else {
      console.error("Erro inesperado ao consultar a Meta:", err);
    }
    process.exit(1);
  }

  console.log(`Dias recebidos da Meta: ${fetched.length}`);
  console.table(fetched.map((d) => ({ data: d.date, gasto: d.spend.toFixed(2) })));

  const fetchedTotal = fetched.reduce((sum, d) => sum + d.spend, 0);
  console.log(`Total do período consultado (soma do que a Meta devolveu): R$ ${fetchedTotal.toFixed(2)}\n`);

  // Compara com o que já está persistido hoje (antes de qualquer --commit),
  // e simula o "depois" mesclando o que foi buscado por cima do que já
  // existe — sem escrever nada ainda, só pra dar visibilidade do impacto.
  const [{ data: sprints }, { data: existingDailySpend }] = await Promise.all([
    supabase
      .from("sprints")
      .select("id, start_date, end_date, planned_spend, spend_source, manual_actual_spend")
      .eq("client_id", clientId)
      .lte("start_date", lastDay)
      .gte("end_date", firstDay),
    supabase.from("daily_spend").select("date, spend").eq("client_id", clientId).gte("date", firstDay).lte("date", lastDay),
  ]);

  const monthRange = { firstDay, lastDay };
  const beforeMonthTotal = sumActualSpendForMonth(sprints ?? [], monthRange, existingDailySpend ?? []);

  const mergedByDate = new Map((existingDailySpend ?? []).map((d) => [d.date, d.spend]));
  for (const d of fetched) mergedByDate.set(d.date, d.spend);
  const mergedDailySpend = Array.from(mergedByDate, ([date, spend]) => ({ date, spend }));
  const afterMonthTotal = sumActualSpendForMonth(sprints ?? [], monthRange, mergedDailySpend);

  console.log(`Total mensal ANTES (dados já persistidos): R$ ${beforeMonthTotal.toFixed(2)}`);
  console.log(`Total mensal DEPOIS (simulado, com os dados buscados agora): R$ ${afterMonthTotal.toFixed(2)}\n`);

  const currentSprint = (sprints ?? []).find((s) => today >= s.start_date && today <= s.end_date);
  if (currentSprint) {
    const beforeSprintTotal = computeSprintEffectiveSpend(currentSprint, existingDailySpend ?? []);
    const afterSprintTotal = computeSprintEffectiveSpend(currentSprint, mergedDailySpend);
    console.log(`Sprint atual (${currentSprint.start_date} a ${currentSprint.end_date}):`);
    console.log(`  Realizado ANTES: R$ ${beforeSprintTotal.toFixed(2)}`);
    console.log(`  Realizado DEPOIS (simulado): R$ ${afterSprintTotal.toFixed(2)}`);
    if (currentSprint.spend_source === "manual") {
      console.log("  (fonte configurada é 'manual' — a sprint mostra o valor manual, não este da Meta)");
    }
  } else {
    console.log("Nenhuma sprint atual encontrada para hoje (nada a comparar em nível de sprint).");
  }

  console.log(
    "\nPra comparar com o Gerenciador de Anúncios: abra a conta em business.facebook.com/adsmanager, filtre o " +
      `período ${firstDay} a ${today} e confira a coluna "Valor usado" — deve bater com o total do período acima.`,
  );

  if (!shouldCommit) {
    console.log("\n(dry-run — nada foi salvo. Rode com --commit para persistir em daily_spend.)");
    return;
  }

  if (fetched.length === 0) {
    console.log("\nNenhum dia com dados pra salvar.");
    return;
  }

  const { error: upsertError } = await supabase.from("daily_spend").upsert(
    fetched.map((d) => ({ client_id: clientId, date: d.date, spend: d.spend, synced_at: new Date().toISOString() })),
    { onConflict: "client_id,date" },
  );

  if (upsertError) {
    console.error("Erro ao salvar:", upsertError.message);
    process.exit(1);
  }

  console.log(`\nSalvo: ${fetched.length} dia(s) de daily_spend atualizado(s) para "${client.name}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
