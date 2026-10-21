/**
 * Testes da evolução "Timeline diz o que realmente foi feito" (Auditoria de
 * Atividades Operacionais → implementação cirúrgica): confirma que
 * `buildReviewDetail` passa a usar `optimization_action` (dado que já
 * existia em `account_optimizations`, só não era lido) quando disponível,
 * sem quebrar o dedupe de uma revisão (nunca vira N linhas) nem o fallback
 * pra eventos históricos sem esse dado.
 *
 * Cenários E-I (sobre `buildTaskCompletedPresentation`/
 * `shouldSuppressDuplicateTaskCompleted`, de `lib/agency-timeline.ts`) foram
 * removidos na Etapa 1.3 da reestruturação KOFF Analytics — esse módulo e a
 * Timeline que o consumia saíram do produto. Cenários A-D
 * (`buildReviewDetail`, de `lib/client-operational-history.ts`) continuam
 * intactos e cobertos, pois a Timeline do cliente nunca foi um módulo
 * exclusivamente operacional — `buildReviewDetail` é reaproveitada por
 * outros consumidores dessa biblioteca.
 *
 * Cobre os cenários A-D pedidos. Rodar: npx tsx scripts/test-timeline-detail.ts
 */
import assert from "node:assert/strict";
import { buildReviewDetail, type OptimizationActionDetail } from "../src/lib/client-operational-history";

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

console.log(`\n${passed} verificações passaram.`);
