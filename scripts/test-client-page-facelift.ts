/**
 * Testes da Etapa "Facelift Visual — Visão Geral do cliente" — rodada
 * puramente visual (composição/densidade/espaçamento/hierarquia), sem
 * mudança de dado/query/cálculo/permissão. Como não há regra de negócio
 * nova, esta suíte é só ESTRUTURAL (checagem de código-fonte) — mesmo
 * padrão já usado por `test-achievements-granularity.ts`/
 * `test-operation-goal-filter.ts` pra confirmar decisões de composição sem
 * precisar de um browser real.
 *
 * Rodar: npx tsx scripts/test-client-page-facelift.ts
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

const pageCode = stripComments(loadSource("src", "app", "clients", "[id]", "page.tsx"));
const stickyCode = stripComments(loadSource("src", "app", "clients", "client-identity-sticky.tsx"));
const kpiCode = stripComments(loadSource("src", "app", "clients", "monthly-kpi-summary.tsx"));
const tasksPanelCode = stripComments(loadSource("src", "app", "clients", "month-tasks-panel.tsx"));
const recurringRowCode = stripComments(loadSource("src", "app", "clients", "recurring-task-row.tsx"));
const taskRowCode = stripComments(loadSource("src", "app", "clients", "task-row.tsx"));
const secondaryGoalsCode = stripComments(loadSource("src", "app", "clients", "secondary-goals-performance.tsx"));

console.log("1 — Largura do conteúdo: mesmo max-w-5xl no container principal e no sticky\n");
{
  ok("container principal da Visão Geral usa max-w-5xl (era max-w-6xl)", /max-w-5xl px-6 py-5/.test(pageCode));
  ok("nenhum max-w-6xl sobrevive no container principal", !pageCode.includes('"mx-auto max-w-6xl'));
  ok("ClientIdentitySticky usa o MESMO max-w-5xl (nunca dois containers de largura diferente)", /max-w-5xl items-center gap-2 px-6 py-1\.5/.test(stickyCode));
}

console.log("\n2 — Ritmo vertical: cadência consistente entre as grandes regiões (mt-6)\n");
{
  ok("bloco Performance (superfície creme) usa mt-6 antes dele", /mt-6 rounded-lg bg-cream/.test(pageCode));
  ok("bloco Tarefas (MonthTasksPanel) usa mt-6 antes dele", /mt-6">\s*<MonthTasksPanel/.test(pageCode));
  ok("Outros objetivos (quando existe) usa a MESMA cadência mt-6", /mt-6 rounded-lg bg-overview-surface-subtle/.test(secondaryGoalsCode));
  ok(
    "wrapper redundante mt-3 em torno de Sprints foi removido (Section já aplica seu próprio mt-6)",
    !/<div className="mt-3">\s*<Section title=\{`Sprints/.test(pageCode),
  );
}

console.log("\n3 — Performance: refinado, nunca redesenhado (mesmos componentes, gap mais compacto)\n");
{
  ok("KPIs continuam Resultado/Investimento/Custo por resultado no mesmo grid (nunca virou 3 cards)", /grid grid-cols-\[repeat\(auto-fit,minmax\(8rem,1fr\)\)\]/.test(kpiCode));
  ok("gap horizontal do KPI foi reduzido (gap-x-6, era gap-x-8) — menos sensação de ilhas", /gap-x-6 gap-y-4/.test(kpiCode));
  ok("nenhuma sombra nova foi adicionada ao bloco Performance", !pageCode.includes("shadow"));
}

console.log("\n4 — Tarefas: seção editorial (sem grande card bege, sem cabeçalho de coluna)\n");
{
  ok("MonthTasksPanel não envolve mais a seção em bg-cream (era 'card dentro de card')", !tasksPanelCode.includes("bg-cream"));
  ok("nenhuma superfície arredondada grande sobrou no wrapper principal (sem rounded-2xl solto na raiz)", !/return \(\s*<div className="[^"]*rounded-2xl/.test(tasksPanelCode));
  ok('cabeçalho de coluna "Próxima execução"/"Tarefa" foi removido', !/>Próxima execução<|>Tarefa<\/span>/.test(tasksPanelCode));
  ok("botão + Tarefa continua existindo (InlineCreateTaskForm, nenhuma funcionalidade removida)", /InlineCreateTaskForm/.test(tasksPanelCode));
}

console.log("\n5 — Filtros: navegação textual, mesma funcionalidade, só sem pill/cápsula\n");
{
  ok("filtros não usam mais rounded-full/border/bg-brand por opção (pill)", !/rounded-full border px-2\.5 py-1/.test(tasksPanelCode));
  ok("os 4 filtros (Todas/Pendentes/Atrasadas/Concluídas) continuam todos presentes", /key: "todas"/.test(tasksPanelCode) && /key: "atrasadas"/.test(tasksPanelCode) && /key: "concluidas"/.test(tasksPanelCode));
  ok("filtro selecionado ganha peso via texto (font-medium + underline), nunca mais fundo sólido de botão", /font-medium text-overview-text-primary underline/.test(tasksPanelCode));
  ok("contagem de cada filtro continua visível ao lado do rótulo (mesma funcionalidade)", /\{label\} <span className="tabular-nums">\{counts\[key\]\}<\/span>/.test(tasksPanelCode));
}

console.log("\n6 — Emojis: removidos da apresentação, dado intocado\n");
{
  ok("RecurringTaskRow não renderiza mais item.icon (emoji livre do template)", !/\{item\.icon\}/.test(recurringRowCode));
  ok("o campo `icon` continua existindo no tipo (dado intocado, só a apresentação mudou)", /icon: string/.test(loadSource("src", "lib", "recurring-task-data.ts")));
  ok("coluna de status da recorrência virou espaçador vazio (mantém alinhamento com TaskRow)", /<span className=\{ACTIVITY_COL_STATUS\} aria-hidden="true" \/>/.test(recurringRowCode));
}

console.log("\n7 — Hierarquia das linhas: Tarefa antes de Próxima execução (só na visão de Tarefas)\n");
{
  ok(
    "TaskRow em modo compactDate (MonthTasksPanel) renderiza o título ANTES da data",
    /compactDate \? \(\s*<>\s*<span className="min-w-0 flex-1">/.test(taskRowCode),
  );
  ok(
    "TaskRow sem compactDate (TaskList/Atividades de Sprints) preserva a ordem de sempre (data antes do título)",
    /: \(\s*<>\s*<span className=\{`\$\{ACTIVITY_COL_DATE\}/.test(taskRowCode),
  );
  ok(
    "RecurringTaskRow aceita titleFirst (só MonthTasksPanel passa; Atividades de Sprints preserva a ordem de sempre)",
    /titleFirst\?: boolean/.test(recurringRowCode) && /titleFirst\s*$/m.test(stripComments(loadSource("src", "app", "clients", "month-tasks-panel.tsx"))),
  );
}

console.log("\n8 — Progresso (\"0/2\"): mantido (é informação real), só menos isolado\n");
{
  ok("progresso da recorrência continua calculado e exibido (nenhuma funcionalidade removida)", /progressLabel/.test(recurringRowCode));
  ok("progresso não usa mais justify-between empurrando pro extremo da linha", !/justify-between gap-2 text-sm/.test(recurringRowCode));
  ok("progresso fica junto do nome (items-baseline, mesma unidade visual)", /items-baseline gap-1\.5 text-sm/.test(recurringRowCode));
}

console.log("\n9 — Não mexeu no que não devia: Sprints continua com o mesmo SprintCard, mesmas props\n");
{
  ok("Sprints continua chamando SprintCard com hideNextAction/hideTaskList (mesmo comportamento de sempre)", /hideNextAction\s*hideTaskList/.test(pageCode));
  ok("nenhuma prop nova de negócio foi adicionada ao SprintCard nesta etapa", !/accordionRowsPrototype=\{true\}/.test(pageCode));
}

console.log(`\n${passed} verificações passaram.`);
