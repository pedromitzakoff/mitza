/**
 * Backfill controlado de 30 dias — inicializa o Sistema de Conquistas com
 * eventos recentes reais, sem mudar em nada o cron diário (que continua
 * avaliando só o dia fechado mais recente).
 *
 * Reaproveita 100% o motor existente: chama `evaluateAchievementsForDate`
 * (`lib/achievement-engine.ts`) uma vez por dia dos últimos 30 dias
 * fechados, em ordem cronológica (mais antigo → mais recente) — nunca uma
 * segunda versão das regras. O baseline de cada dia continua olhando pra
 * todo o histórico disponível ANTES daquele dia (não só os 30 dias da
 * janela) — é assim que "novo recorde" no meio do backfill compara contra
 * o histórico real, não contra um universo artificialmente pequeno.
 *
 * Idempotente por construção: usa a MESMA `idempotency_key` de sempre
 * (`achievement:{scope}:{subjectId}:{type}:{windowKey}`) — rodar este
 * script várias vezes nunca duplica nada.
 *
 * Execução manual explícita — nunca um cron novo, nunca uma rota HTTP:
 *
 *   npx tsx scripts/backfill-achievements.ts
 *
 * Precisa das mesmas credenciais do cron (`SUPABASE_SERVICE_ROLE_KEY`,
 * `NEXT_PUBLIC_SUPABASE_URL`) — rode num ambiente com acesso ao banco de
 * produção (nunca comitar/expor essas chaves).
 *
 * ---------------------------------------------------------------------
 * Exclusões deliberadas de Agência (ver `achievement-agency-rules.ts`,
 * `AGENCY_BACKFILL_SAFE_RULES`):
 *
 * - `ruleAgencyActiveClientsMilestone` — `clients.status` é estado ATUAL,
 *   sem histórico. Não existe "estava ativo há 20 dias" pra reconstruir.
 * - `ruleAgencyMediaScaleMilestone` — exigiria comparar contra TODO mês
 *   fechado anterior (não só os 30 dias da janela) pra não recriar um
 *   patamar já superado antes; fora do escopo desta etapa.
 *
 * As duas continuam ativas no cron diário — só não entram no backfill.
 * ---------------------------------------------------------------------
 */
import { createAdminClient } from "../src/lib/supabase/admin";
import { todayDateString } from "../src/lib/today";
import { lastNClosedDaysEndingYesterday } from "../src/lib/achievement-dates";
import { evaluateAchievementsForDate, type AchievementRunSummary, type CreatedAchievementSummary } from "../src/lib/achievement-engine";
import { AGENCY_BACKFILL_SAFE_RULES } from "../src/lib/achievement-agency-rules";

export const BACKFILL_WINDOW_DAYS = 30;

interface BackfillSummary {
  datesProcessed: string[];
  totalClientsEvaluated: number;
  totalClientsSkippedUntrustedSync: number;
  totalClientsSkippedNoOrganization: number;
  totalOrganizationsEvaluated: number;
  totalPersonEvaluated: number;
  totalCandidates: number;
  totalInserted: number;
  totalAlreadyIdempotent: number;
  errors: string[];
  countByScope: Record<string, number>;
  countByType: Record<string, number>;
  createdAchievements: CreatedAchievementSummary[];
}

function mergeSummary(target: BackfillSummary, dayResult: AchievementRunSummary) {
  target.totalClientsEvaluated += dayResult.clientsEvaluated;
  target.totalClientsSkippedUntrustedSync += dayResult.clientsSkippedUntrustedSync;
  target.totalClientsSkippedNoOrganization += dayResult.clientsSkippedNoOrganization;
  target.totalOrganizationsEvaluated += dayResult.organizationsEvaluated;
  target.totalPersonEvaluated += dayResult.personEvaluated;

  const candidatesThisDay = dayResult.clientCandidates + dayResult.agencyCandidates + dayResult.personCandidates;
  const insertedThisDay = dayResult.clientInserted + dayResult.agencyInserted + dayResult.personInserted;
  target.totalCandidates += candidatesThisDay;
  target.totalInserted += insertedThisDay;
  target.totalAlreadyIdempotent += candidatesThisDay - insertedThisDay;

  target.errors.push(...dayResult.errors);

  for (const created of dayResult.createdAchievements) {
    target.createdAchievements.push(created);
    target.countByScope[created.scope] = (target.countByScope[created.scope] ?? 0) + 1;
    target.countByType[created.type] = (target.countByType[created.type] ?? 0) + 1;
  }
}

async function runBackfill(now: Date = new Date()): Promise<BackfillSummary> {
  const supabase = createAdminClient();
  const dates = lastNClosedDaysEndingYesterday(BACKFILL_WINDOW_DAYS, todayDateString(now));

  const summary: BackfillSummary = {
    datesProcessed: dates,
    totalClientsEvaluated: 0,
    totalClientsSkippedUntrustedSync: 0,
    totalClientsSkippedNoOrganization: 0,
    totalOrganizationsEvaluated: 0,
    totalPersonEvaluated: 0,
    totalCandidates: 0,
    totalInserted: 0,
    totalAlreadyIdempotent: 0,
    errors: [],
    countByScope: {},
    countByType: {},
    createdAchievements: [],
  };

  // Ordem cronológica (mais antigo -> mais recente) — essencial pra
  // recordes/streaks/recuperação/milestones progressivos (`listDatesInclusive`
  // já devolve nessa ordem).
  for (const date of dates) {
    console.log(`Processando ${date}...`);
    const dayResult = await evaluateAchievementsForDate(supabase, date, { agencyRules: AGENCY_BACKFILL_SAFE_RULES });
    mergeSummary(summary, dayResult);
  }

  return summary;
}

function printReport(summary: BackfillSummary) {
  console.log("\n=== Backfill de Conquistas — 30 dias ===\n");
  console.log(`Datas processadas: ${summary.datesProcessed[0]} → ${summary.datesProcessed[summary.datesProcessed.length - 1]} (${summary.datesProcessed.length} dias)`);
  console.log(`Clientes avaliados (soma de todos os dias): ${summary.totalClientsEvaluated}`);
  console.log(`  pulados por sync não confiável: ${summary.totalClientsSkippedUntrustedSync}`);
  console.log(`  pulados por falta de organização resolvida: ${summary.totalClientsSkippedNoOrganization}`);
  console.log(`Organizações avaliadas (soma de todos os dias): ${summary.totalOrganizationsEvaluated}`);
  console.log(`Pessoas avaliadas (soma de todos os dias): ${summary.totalPersonEvaluated}`);
  console.log(`\nCandidatos encontrados: ${summary.totalCandidates}`);
  console.log(`Conquistas inseridas (novas de verdade): ${summary.totalInserted}`);
  console.log(`Já existiam (idempotentes, não duplicadas): ${summary.totalAlreadyIdempotent}`);
  console.log(`Erros: ${summary.errors.length}`);
  for (const err of summary.errors) console.log(`  - ${err}`);

  console.log("\nPor escopo:");
  for (const [scope, count] of Object.entries(summary.countByScope)) console.log(`  ${scope}: ${count}`);

  console.log("\nPor tipo:");
  for (const [type, count] of Object.entries(summary.countByType)) console.log(`  ${type}: ${count}`);

  console.log("\nConquistas criadas nesta execução:");
  if (summary.createdAchievements.length === 0) {
    console.log("  (nenhuma — pode ser correto: se nenhum threshold foi realmente atingido nos últimos 30 dias, ou os dias estavam com sync inválido, o certo é ficar vazio.)");
  } else {
    for (const a of summary.createdAchievements) {
      console.log(`  ${a.occurredOnDate} · ${a.scope} · ${a.type} — ${a.headline}`);
    }
  }
}

async function main() {
  const summary = await runBackfill();
  printReport(summary);
}

// Só executa quando rodado diretamente (`npx tsx scripts/backfill-achievements.ts`)
// — nunca ao ser importado (`BACKFILL_WINDOW_DAYS` é reaproveitado pelos
// testes, `scripts/test-achievement-backfill.ts`; importar não pode
// disparar uma tentativa de conectar no banco).
if (require.main === module) {
  main().catch((err) => {
    console.error("Backfill falhou:", err);
    process.exit(1);
  });
}
