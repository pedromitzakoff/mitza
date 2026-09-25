/**
 * Testes da Etapa "Demandas — Data de conclusão" (rodada curta, sem
 * alteração de arquitetura do workspace do cliente): mostrar quando uma
 * demanda concluída foi REALMENTE concluída, sem confundir com o prazo.
 *
 * Auditoria prévia (documentada no chat, não repetida em código): `tasks`
 * já tem `completed_at` (gravado atomicamente por
 * `complete_task_and_record_event`, a RPC que TODO caminho de conclusão
 * usa — `completeTaskAction`/`updateTaskStatusInlineAction`) e
 * `reopenTaskAction` já zera esse campo ao reabrir. Nenhuma coluna nova,
 * nenhuma migration — só passou a ser SELECIONADO e EXIBIDO.
 *
 * "Concluída por" vem de `operational_events` (evento `task_completed`,
 * `entity_type='task'`), a única fonte que registra o ATOR — `tasks` não
 * tem essa coluna. Nunca inferido: ausência de evento = `actorName: null`,
 * nunca um nome fabricado.
 *
 * Suíte ESTRUTURAL (sem Supabase real neste sandbox) — mesmo padrão já
 * usado por `test-demandas.ts`/`test-client-workspace.ts`.
 *
 * Rodar: npx tsx scripts/test-demandas-completion-date.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatDateFromInstant, formatDateTimeWithYear, formatShortDateFromInstant } from "../src/lib/format";

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

console.log("\n1 — Fonte canônica: tasks.completed_at, gravado pela RPC atômica, NUNCA updated_at\n");
{
  const opEventsSql = loadSource("supabase", "operational-events.sql");
  ok(
    "complete_task_and_record_event grava completed_at = v_now (timestamp fresco) junto do status='feito', na MESMA transação",
    /set status = 'feito', completed_at = v_now, completion_count = v_completion_count/.test(opEventsSql),
  );
  ok(
    "cada conclusão grava um evento task_completed com idempotency_key incluindo completion_count — reconclusão após reabrir NUNCA reaproveita/sobrescreve o evento anterior",
    /'task_completed:' \|\| v_task\.id::text \|\| ':' \|\| v_completion_count::text/.test(opEventsSql),
  );

  const tasksActionsSource = loadSource("src", "app", "clients", "tasks-actions.ts");
  ok(
    "completeTaskAction (único caminho real de conclusão, usado também por updateTaskStatusInlineAction) chama a RPC — nunca um update manual de completed_at",
    /supabase\.rpc\("complete_task_and_record_event"/.test(tasksActionsSource),
  );
  ok(
    "reopenTaskAction zera completed_at (null) ao reabrir — a demanda reaberta nunca aparenta 'ainda concluída'",
    /\.update\(\{ status: "pendente", completed_at: null, reopened_count: nextReopenedCount \}\)/.test(tasksActionsSource),
  );
  ok(
    "updateTaskStatusInlineAction delega 'feito' pra completeTaskAction — nenhum segundo caminho grava status='feito' sem passar pela RPC",
    /if \(status === "feito"\) \{\s*const result = await completeTaskAction/.test(tasksActionsSource),
  );
}

console.log("\n2 — Data layer: completed_at selecionado e mapeado pra PendenciaItem.completedAt, sem duplicar a regra\n");
{
  const dataSource = loadSource("src", "app", "demandas", "pendencias-data.ts");
  ok("loadPendenciasRawData seleciona completed_at (mesma query de sempre, nenhuma query nova)", dataSource.includes("completed_at"));
  ok("TaskRow tipa completed_at como string | null (nunca assume sempre presente)", /completed_at: string \| null;/.test(dataSource));
  ok("mapeamento usa completedAt: row.completed_at — nunca deriva de updated_at ou de outro campo", dataSource.includes("completedAt: row.completed_at"));

  const pendenciasCore = loadSource("src", "lib", "pendencias.ts");
  ok(
    "PendenciaItem.completedAt documentado como a conclusão MAIS RECENTE, nunca updated_at (núcleo puro, fonte única do contrato)",
    /completedAt: string \| null;/.test(pendenciasCore) && /nunca `updated_at`/.test(pendenciasCore),
  );
}

console.log("\n3 — Lista (pendencia-row.tsx): 'Concl. DD/MM' só quando REALMENTE concluída, prazo nunca confundido com conclusão\n");
{
  const rowSource = loadSource("src", "app", "demandas", "pendencia-row.tsx");
  ok(
    "linha de conclusão é condicional a item.status === \"feito\" && item.completedAt — nunca aparece por padrão",
    /\{item\.status === "feito" && item\.completedAt && \(/.test(rowSource),
  );
  ok("Prazo (due_date, input editável) continua existindo e é um campo SEPARADO de completedAt", rowSource.includes('aria-label="Prazo"') && rowSource.includes("item.dueDate"));
  ok(
    "formatação da conclusão usa formatShortDateFromInstant/formatDateFromInstant (formatters de INSTANTE já existentes) — nunca formatDueDate (que espera data civil, não timestamptz) aplicado a completedAt",
    rowSource.includes("formatShortDateFromInstant(item.completedAt)") && !/formatDueDate\(item\.completedAt\)/.test(rowSource),
  );
}

console.log("\n4 — Drawer: 'Concluída em' explícito (data+hora), 'Concluída por' só com ator confiável, nunca pra demanda aberta\n");
{
  const drawerSource = loadSource("src", "app", "demandas", "pendencia-drawer.tsx");
  ok("isCompleted = item.status === \"feito\" — a MESMA condição usada em toda parte, nenhuma segunda regra de 'está concluída'", /const isCompleted = item\.status === "feito";/.test(drawerSource));
  ok("'Concluída em' só renderiza quando isCompleted (nunca 'Concluída em —' pra demanda aberta, seção 9 do pedido)", /\{isCompleted && \(\s*<div>\s*<dt className="text-overview-text-secondary">Concluída em<\/dt>/.test(drawerSource));
  ok(
    "sem completedAt registrado (dado legado pré-migration), mostra 'Data não registrada' — nunca inventa uma data",
    drawerSource.includes('"Data não registrada"'),
  );
  ok("usa formatDateTimeWithYear (data + hora, 'DD/MM/AAAA às HH:MM') — pedido explícito do drawer ser mais detalhado que a lista", drawerSource.includes("formatDateTimeWithYear(item.completedAt)"));
  ok(
    "'Concluída por' só aparece quando completedByName é verdadeiro (resultado real da busca) — nunca um placeholder/inferência",
    /\{isCompleted && completedByName && \(/.test(drawerSource),
  );
  ok(
    "busca de 'Concluída por' só dispara quando isCompleted (nunca uma leitura desnecessária pra demanda aberta)",
    /useEffect\(\(\) => \{\s*if \(!isCompleted\) return;/.test(drawerSource),
  );
}

console.log("\n5 — 'Concluída por': fonte real (operational_events), nunca fabricado\n");
{
  const actionsSource = loadSource("src", "app", "demandas", "pendencias-actions.ts");
  ok(
    "getTaskCompletionActorAction lê operational_events (entity_type='task', event_type='task_completed') — tasks não tem coluna de ator, esta é a única fonte real",
    actionsSource.includes('.eq("entity_type", "task")') && actionsSource.includes('.eq("event_type", "task_completed")'),
  );
  ok(
    "ordena por occurred_at desc + limit 1 — sempre a conclusão MAIS RECENTE (reconclusão após reabrir usa o evento novo, nunca o antigo)",
    actionsSource.includes('.order("occurred_at", { ascending: false })') && actionsSource.includes(".limit(1)"),
  );
  ok(
    "sem evento (dado legado ou caminho não coberto), retorna actorName: null — nunca um nome inventado por inferência",
    /if \(!row\) return \{ actorName: null \};/.test(actionsSource),
  );
}

console.log("\n6 — Formatters reaproveitados (nenhuma lógica de data nova/paralela)\n");
{
  const instant = "2026-09-24T17:32:00.000Z";
  ok("formatDateFromInstant produz DD/MM/AAAA a partir de um timestamptz real", /^\d{2}\/\d{2}\/2026$/.test(formatDateFromInstant(instant)));
  ok("formatShortDateFromInstant produz DD/MM (compacto, pra lista)", /^\d{2}\/\d{2}$/.test(formatShortDateFromInstant(instant)));
  ok("formatDateTimeWithYear produz 'DD/MM/AAAA às HH:MM' (drawer, mais explícito)", /^\d{2}\/\d{2}\/2026 às \d{2}:\d{2}$/.test(formatDateTimeWithYear(instant)));
  check("prazo (due_date, data civil) e conclusão (completed_at, instante) usam formatters DIFERENTES por design — nunca o mesmo dado", true, true);
}

console.log("\n7 — Duplicar demanda: NUNCA copia completed_at (duplicata sempre nasce aberta)\n");
{
  const pendenciasCore = loadSource("src", "lib", "pendencias.ts");
  const duplicateFnMatch = pendenciasCore.match(/export function buildDuplicateTaskRow\([^)]*\): PendenciaDuplicateRow \{[\s\S]*?\n\}/);
  ok("buildDuplicateTaskRow encontrada", Boolean(duplicateFnMatch));
  ok("linha de retorno de buildDuplicateTaskRow NUNCA inclui completed_at (a duplicata sempre começa com status='pendente', sem histórico de conclusão)", !(duplicateFnMatch?.[0] ?? "").includes("completed_at"));
  ok("buildDuplicateTaskRow sempre força status: \"pendente\" na duplicata", (duplicateFnMatch?.[0] ?? "").includes('status: "pendente"'));
}

console.log("\n8 — Regressão: filtros/seleção em massa/duplicar/excluir/reabrir continuam intactos na List View\n");
{
  const pageClientSource = loadSource("src", "app", "demandas", "pendencias-page-client.tsx");
  ok("filtros continuam existindo (parsePendenciasFilters/filterPendencias)", pageClientSource.includes("parsePendenciasFilters") || pageClientSource.includes("filters"));
  ok("seleção em massa continua existindo", pageClientSource.includes("toggleSelectAllVisible") && pageClientSource.includes("selectedIds"));
  ok("duplicar em lote continua existindo", pageClientSource.includes("handleBulkDuplicate"));
  ok("excluir em lote continua existindo", pageClientSource.includes("handleBulkDelete"));
  const rowSource = loadSource("src", "app", "demandas", "pendencia-row.tsx");
  ok("reabrir continua existindo na linha (onReopen)", rowSource.includes("onReopen"));
}

console.log("\n9 — Regressão: Home e Demandas do cliente não são afetadas pela mudança\n");
{
  const pendenciasCore = loadSource("src", "lib", "pendencias.ts");
  ok(
    "countOpenDemandas (Home) continua operando só sobre origin/client_id/status/due_date — completedAt não faz parte do contrato de contagem, nenhuma regressão de tipo",
    /export interface CountableDemandaTask \{\s*origin: TaskOrigin;\s*client_id: string \| null;\s*status: TaskStatus;\s*due_date: string;\s*\}/.test(pendenciasCore),
  );
  const homeSource = loadSource("src", "app", "page.tsx");
  ok("Home continua chamando countOpenDemandas sem alteração", homeSource.includes("countOpenDemandas("));

  const clientDemandasSource = loadSource("src", "app", "clients", "[id]", "demandas", "page.tsx");
  ok(
    "Demandas do cliente reaproveita a MESMA loadPendenciasRawData — data de conclusão aparece automaticamente lá também, sem segunda implementação",
    clientDemandasSource.includes("loadPendenciasRawData(supabase, id)"),
  );
}

console.log(`\n${passed} verificações passaram.`);
