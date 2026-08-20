/**
 * Testes da evolução "Timeline diz o que realmente foi feito" (Auditoria de
 * Atividades Operacionais → implementação cirúrgica): confirma que
 * `buildReviewDetail` passa a usar `optimization_action` (dado que já
 * existia em `account_optimizations`, só não era lido) quando disponível,
 * sem quebrar o dedupe de uma revisão (nunca vira N linhas) nem o fallback
 * pra eventos históricos sem esse dado; e que `buildTaskCompletedPresentation`/
 * `shouldSuppressDuplicateTaskCompleted` (`lib/agency-timeline.ts`) deixam
 * `task_completed` mais humano sem confundir tarefa avulsa com o fluxo
 * estruturado (revisão/`client_reports`), e sem duplicar reunião/entrega de
 * criativo (que já têm evento específico correlacionado).
 *
 * Cobre os cenários A-I pedidos. Rodar: npx tsx scripts/test-timeline-detail.ts
 */
import assert from "node:assert/strict";
import { buildReviewDetail, type OptimizationActionDetail } from "../src/lib/client-operational-history";
import { buildTaskCompletedPresentation, shouldSuppressDuplicateTaskCompleted } from "../src/lib/agency-timeline";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${name} — esperado ${JSON.stringify(expected)}, recebeu ${JSON.stringify(actual)}`);
  passed++;
  console.log(`  ok — ${name}`);
}

function opt(type: OptimizationActionDetail["type"], action: string, quantity = 1): OptimizationActionDetail {
  return { type, action, quantity };
}

console.log("\nCenário A — otimização estruturada simples (Criativo · Substituiu)\n");
{
  const detail = buildReviewDetail({ outcome: "OPTIMIZATION_PERFORMED" }, [opt("CREATIVE", "REPLACED")]);
  check("A — mostra a ação real, não só o tipo", detail, "Otimização realizada · Substituiu criativo");
}

console.log("\nCenário B — múltiplas otimizações na mesma revisão (sem duplicar linhas)\n");
{
  const detail = buildReviewDetail({ outcome: "OPTIMIZATION_PERFORMED" }, [opt("CREATIVE", "REPLACED"), opt("BUDGET", "INCREASED")]);
  check("B — as duas ações aparecem numa única string (uma revisão = uma linha)", detail, "Otimização realizada · Substituiu criativo · Aumentou orçamento");

  const detailWithQuantity = buildReviewDetail({ outcome: "OPTIMIZATION_PERFORMED" }, [opt("CREATIVE", "PAUSED", 3)]);
  check("B — quantidade > 1 aparece como sufixo ×N (mesmo padrão do drawer)", detailWithQuantity, "Otimização realizada · Pausou criativo ×3");

  const manyItems = buildReviewDetail({ outcome: "OPTIMIZATION_PERFORMED" }, [
    opt("CREATIVE", "REPLACED"),
    opt("BUDGET", "INCREASED"),
    opt("AUDIENCE", "SEGMENTATION_CHANGED"),
    opt("BID", "DECREASED"),
  ]);
  check(
    "B — com muitos itens, trunca e resume o restante (não deixa a linha enorme)",
    manyItems,
    "Otimização realizada · Substituiu criativo · Aumentou orçamento · +2 alterações",
  );

  const threeItems = buildReviewDetail({ outcome: "OPTIMIZATION_PERFORMED" }, [
    opt("CREATIVE", "REPLACED"),
    opt("BUDGET", "INCREASED"),
    opt("AUDIENCE", "SEGMENTATION_CHANGED"),
  ]);
  check(
    "B — com exatamente 3 itens, mostra todos sem truncar (só trunca quando necessário)",
    threeItems,
    "Otimização realizada · Substituiu criativo · Aumentou orçamento · Alterou segmentação público",
  );
}

console.log("\nCenário C — revisão sem alteração (nunca inventa otimização)\n");
{
  const detail = buildReviewDetail({ outcome: "NO_CHANGE" });
  check("C — outcome NO_CHANGE nunca mostra ação/tipo de otimização", detail, "Sem alteração necessária");

  const detailWithStrayActions = buildReviewDetail({ outcome: "NO_CHANGE" }, [opt("CREATIVE", "REPLACED")]);
  check("C — mesmo se `actions` vier preenchido por engano, NO_CHANGE ignora (outcome manda)", detailWithStrayActions, "Sem alteração necessária");
}

console.log("\nCenário D — evento histórico sem optimization_action (fallback)\n");
{
  const noBatch = buildReviewDetail({ outcome: "OPTIMIZATION_PERFORMED", optimization_types: ["CREATIVE"] });
  check("D — sem lote de account_optimizations, cai pro tipo salvo no metadata da revisão", noBatch, "Otimização realizada · Criativo");

  const noBatchMultiType = buildReviewDetail({ outcome: "OPTIMIZATION_PERFORMED", optimization_types: ["CREATIVE", "BUDGET"] });
  check("D — múltiplos tipos sem lote, fallback pro resumo antigo (comportamento preservado)", noBatchMultiType, "Otimização realizada · 2 alterações");

  const emptyBatch = buildReviewDetail({ outcome: "OPTIMIZATION_PERFORMED", optimization_types: ["BUDGET"] }, []);
  check("D — lote vazio (array presente, sem itens) também cai no fallback, nunca quebra", emptyBatch, "Otimização realizada · Orçamento");

  const unknownAction = buildReviewDetail({ outcome: "OPTIMIZATION_PERFORMED" }, [opt("BUDGET", "SOME_FUTURE_ACTION_NOT_YET_LABELED")]);
  check("D — ação desconhecida (fora do label map) cai pro tipo sozinho, nunca mostra a string bruta", unknownAction, "Otimização realizada · Orçamento");
}

console.log("\nCenário E — task_completed de verificação de saldo\n");
{
  const withDistinctTitle = buildTaskCompletedPresentation({ task_type: "verificacao_saldo", task_title: "Conferir saldo Meta e Google" });
  check("E — rótulo humano específico, título vira detalhe (contexto preservado)", withDistinctTitle, {
    label: "Saldo conferido",
    detail: "Conferir saldo Meta e Google",
  });

  const withRedundantTitle = buildTaskCompletedPresentation({ task_type: "verificacao_saldo", task_title: "saldo conferido" });
  check("E — título praticamente igual ao rótulo não duplica a informação", withRedundantTitle, {
    label: "Saldo conferido",
    detail: null,
  });
}

console.log("\nCenário F — tarefa avulsa de otimização (não finge ser a otimização estruturada)\n");
{
  const result = buildTaskCompletedPresentation({ task_type: "otimizacao", task_title: "Pausei campanha ruim" });
  check("F — rótulo deixa claro que é tarefa, não a otimização de account_optimizations", result, {
    label: "Tarefa de otimização concluída",
    detail: "Pausei campanha ruim",
  });
  check("F — nunca usa o rótulo ambíguo 'Otimização registrada'", result.label, "Tarefa de otimização concluída");
}

console.log("\nCenário G — tarefa de report (não finge que houve envio estruturado)\n");
{
  const result = buildTaskCompletedPresentation({ task_type: "report", task_title: "Enviei relatório de agosto" });
  check("G — rótulo é sobre a tarefa, não sobre client_reports", result, {
    label: "Tarefa de report concluída",
    detail: "Enviei relatório de agosto",
  });
  check("G — nunca usa 'Report enviado' (isso é client_report_sent, evento próprio)", result.label, "Tarefa de report concluída");
}

console.log("\nCenário H — task_type ausente (compatibilidade histórica)\n");
{
  const missingType = buildTaskCompletedPresentation({ task_title: "Ajustei pixel do site" });
  check("H — sem task_type, cai pro rótulo genérico de sempre", missingType, {
    label: "Concluiu tarefa",
    detail: "Ajustei pixel do site",
  });

  const missingEverything = buildTaskCompletedPresentation({});
  check("H — metadata vazio nunca produz undefined/null renderizável", missingEverything, {
    label: "Concluiu tarefa",
    detail: null,
  });

  const unknownType = buildTaskCompletedPresentation({ task_type: "tipo_futuro_desconhecido", task_title: "Algo novo" });
  check("H — task_type desconhecido (fora da taxonomia atual) também cai no fallback", unknownType, {
    label: "Concluiu tarefa",
    detail: "Algo novo",
  });
}

console.log("\nCenário I — reunião/entrega: sem regressão no dedupe\n");
{
  const siblings = new Set(["corr-1"]);
  const meetingTaskWithSibling = shouldSuppressDuplicateTaskCompleted({ task_type: "reuniao" }, "corr-1", siblings);
  check("I — task_completed de reunião é suprimido quando meeting_completed está no mesmo lote", meetingTaskWithSibling, true);

  const creativeTaskWithSibling = shouldSuppressDuplicateTaskCompleted({ task_type: "entrega_criativo" }, "corr-1", siblings);
  check("I — mesma regra pra entrega de criativo", creativeTaskWithSibling, true);

  const meetingTaskWithoutSibling = shouldSuppressDuplicateTaskCompleted({ task_type: "reuniao" }, "corr-2", siblings);
  check("I — sem o par correlacionado no lote, a linha não é suprimida (nunca esconde dado real)", meetingTaskWithoutSibling, false);

  const optimizationTask = shouldSuppressDuplicateTaskCompleted({ task_type: "otimizacao" }, "corr-1", siblings);
  check("I — otimização/report/saldo/outro nunca são suprimidos por essa regra", optimizationTask, false);

  const nullCorrelation = shouldSuppressDuplicateTaskCompleted({ task_type: "reuniao" }, null, siblings);
  check("I — correlation_id nulo (evento antigo) nunca é suprimido às cegas", nullCorrelation, false);
}

console.log(`\n${passed} verificações passaram.`);
