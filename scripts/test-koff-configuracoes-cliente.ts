/**
 * Testes da Etapa "Configurações do Cliente" (redesign de
 * `/clients/[id]/edit`, pedido explícito do usuário) — checagens
 * ESTRUTURAIS via grep de código-fonte (mesmo padrão das suites
 * anteriores, sem DOM/Supabase/navegador real neste ambiente).
 *
 * Cobre:
 *  A. 4 abas client-side (Geral/Mídia/Métricas/Links), Métricas
 *     escondida pra quem não é admin — nenhuma rota nova, nenhum full
 *     reload.
 *  B. Alternar de aba nunca descarta alteração pendente — abas são
 *     `hidden` (CSS), nunca desmontagem condicional.
 *  C. Salvamento: cada Server Action independente continua intocada
 *     (nenhuma unificação); botões de salvar padronizados num só lugar.
 *  D. Guarda de "Nome" obrigatório mesmo com a aba Geral escondida.
 *  E. Confirmação explícita antes de excluir cliente (ponto 3 do pedido —
 *     muda deliberadamente o padrão "Platform Continuity System 1.0" só
 *     pra esta ação).
 *  F. Administração vai pro menu secundário (nunca no fluxo principal).
 *  G. `/clients/new` não muda (ClientForm sem `tabbed`, comportamento
 *     idêntico ao de antes desta etapa).
 *  H. Nenhuma alteração de permissão/regra de negócio (mesmas funções de
 *     auth, mesmas Server Actions, mesmas tabelas).
 *
 * Rodar: npx tsx scripts/test-koff-configuracoes-cliente.ts
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

const editPageSource = loadSource("src", "app", "clients", "[id]", "edit", "page.tsx");
const clientFormSource = loadSource("src", "app", "clients", "client-form.tsx");
const tabsSource = loadSource("src", "app", "clients", "client-settings-tabs.tsx");
const uiSource = loadSource("src", "app", "clients", "client-settings-ui.ts");
const adminMenuSource = loadSource("src", "app", "clients", "admin-actions-menu.tsx");
const deleteButtonSource = loadSource("src", "app", "clients", "delete-client-button.tsx");
const newClientPageSource = loadSource("src", "app", "clients", "new", "page.tsx");
const goalsSectionSource = loadSource("src", "app", "clients", "client-goals-section.tsx");
const dashboardMetricsSectionSource = loadSource("src", "app", "clients", "dashboard-metrics-section.tsx");
const actionsSource = loadSource("src", "app", "clients", "actions.ts");

// ---------------------------------------------------------------------------
console.log("\nA — 4 abas client-side, Métricas condicionada a admin, nenhuma rota nova\n");
{
  ok(
    "as 4 abas existem no tipo/labels",
    ["geral", "midia", "metricas", "links"].every((tab) => tabsSource.toLowerCase().includes(`"${tab}"`)),
  );
  ok(
    "Métricas só entra na lista de abas quando showMetricsTab é true (gestor não-admin nem vê a aba)",
    tabsSource.includes("showMetricsTab ?") && tabsSource.includes('"metricas"'),
  );
  ok("ClientSettingsTabsProvider recebe showMetricsTab={isAdmin} — mesma checagem de sempre, nenhuma nova regra", editPageSource.includes("showMetricsTab={isAdmin}"));
  ok("troca de aba é um onClick local (useState), nunca um <Link>/router.push pra outra rota", tabsSource.includes("setActiveTab(tab)") && !tabsSource.includes("router.push"));
  ok("nenhuma rota nova criada — ainda é /clients/[id]/edit", editPageSource.includes("export default async function EditClientPage"));
}

// ---------------------------------------------------------------------------
console.log("\nB — Alternar de aba nunca descarta alteração pendente (hidden via CSS, nunca desmontagem)\n");
{
  ok(
    "ClientSettingsTabPanel troca só a classe (hidden/visível) — nunca um `{condição && <Componente/>}` que desmontaria",
    tabsSource.includes('return <div className={activeTab === tab ? className : "hidden"}>{children}</div>;'),
  );
  ok(
    "o <form> principal (Geral+Mídia+Links) é UM elemento só — cada bloco só esconde via classe, nunca sai da árvore",
    (clientFormSource.match(/isTabVisible\("(geral|midia|links)"\) \? "flex flex-col gap-6" : "hidden"/g) ?? []).length === 3,
  );
  ok(
    "existe só UM useEffect no formulário (o beforeunload de sempre) — nenhum efeito novo de 'reset ao trocar de aba'",
    (clientFormSource.match(/useEffect\(/g) ?? []).length === 1 && clientFormSource.includes("useEffect(() => {\n    if (!dirty) return;"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nC — Salvamento: Server Actions independentes intocadas, botões padronizados num só lugar\n");
{
  ok(
    "ClientForm continua chamando a MESMA updateClientAction de sempre (nenhuma nova action pra Geral/Mídia/Links)",
    editPageSource.includes("action={updateClientAction.bind(null, id, returnTo)}"),
  );
  ok("ClientGoalsSection/DashboardMetricsSection continuam as mesmas Server Actions de sempre (importadas, nunca reescritas)", editPageSource.includes("<ClientGoalsSection") && editPageSource.includes("<DashboardMetricsSection"));
  ok("existe UMA fonte só de estilo de botão de salvar (2 variantes: ação principal vs. compacta)", uiSource.includes("CLIENT_SETTINGS_SAVE_BUTTON_CLASSES_LG") && uiSource.includes("CLIENT_SETTINGS_SAVE_BUTTON_CLASSES"));
  ok("o Salvar principal do formulário usa a variante compartilhada (nunca uma string solta)", clientFormSource.includes("CLIENT_SETTINGS_SAVE_BUTTON_CLASSES_LG"));
  ok(
    "goal-actions/dashboard-metrics compartilham a MESMA constante compacta (antes: 'Salvar' de config avançada usava estilo de botão secundário, apesar de gravar de verdade)",
    goalsSectionSource.includes("CLIENT_SETTINGS_SAVE_BUTTON_CLASSES") && dashboardMetricsSectionSource.includes("CLIENT_SETTINGS_SAVE_BUTTON_CLASSES"),
  );
  ok(
    "nenhuma transação nova/unificada — a action de objetivos ainda só grava client_goals, a de métricas exibidas só clients.dashboard_metrics",
    actionsSource.includes("export async function updateClientAction") && !actionsSource.includes("client_goals"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nD — Guarda de 'Nome' obrigatório mesmo com a aba Geral escondida (display:none sai da validação nativa)\n");
{
  ok("existe uma ref pro input de Nome, lida no submit", clientFormSource.includes("nameInputRef") && clientFormSource.includes('ref={nameInputRef}'));
  ok(
    "onSubmit do form bloqueia o envio (preventDefault) quando tabbed e o Nome está vazio",
    clientFormSource.includes("if (tabbed && !nameInputRef.current?.value.trim())") && clientFormSource.includes("event.preventDefault()"),
  );
  ok("mensagem de erro aponta explicitamente pra aba Geral (nunca um erro genérico sem dizer onde)", clientFormSource.includes("Informe o nome do cliente (aba Geral)"));
}

// ---------------------------------------------------------------------------
console.log("\nE — Confirmação explícita antes de excluir cliente (ponto 3 do pedido — muda o padrão de propósito só aqui)\n");
{
  ok("DeleteClientButton usa o ConfirmDialog compartilhado (nenhuma segunda implementação de diálogo)", deleteButtonSource.includes('import { ConfirmDialog } from "@/components/ui/confirm-dialog"'));
  ok(
    "o diálogo só confirma de verdade no onConfirm (requestSubmit), nunca submete direto no clique do botão visível",
    deleteButtonSource.includes("formRef.current?.requestSubmit()") && deleteButtonSource.includes("onClick={() => setConfirmOpen(true)}"),
  );
  ok("tom destrutivo (vermelho), explicitando que é reversível/soft-delete na própria descrição", deleteButtonSource.includes('tone="destructive"') && deleteButtonSource.includes("restaurar depois"));
  ok(
    "o comentário documenta que isto é uma mudança deliberada pedida pelo usuário, não a regra geral da plataforma",
    deleteButtonSource.includes("pedido explícito do usuário, ponto 3") && deleteButtonSource.includes("nenhuma outra ação reversível da"),
  );
}

// ---------------------------------------------------------------------------
console.log("\nF — Administração (Excluir cliente) vai pro menu secundário, nunca no fluxo principal\n");
{
  ok("AdminActionsMenu reaproveita o padrão <details>/<summary> já usado em Configurações → Equipe (nenhum dropdown novo)", adminMenuSource.includes("<details") && adminMenuSource.includes("<summary"));
  ok("só aparece pra admin — mesma checagem de sempre (isAdmin)", editPageSource.includes("{isAdmin && (\n          <AdminActionsMenu>"));
  ok("DeleteClientButton fica DENTRO do menu, nunca solto no corpo principal da página", editPageSource.includes("<AdminActionsMenu>\n            <DeleteClientButton"));
}

// ---------------------------------------------------------------------------
console.log("\nG — /clients/new não muda (ClientForm sem tabbed, comportamento idêntico ao de antes)\n");
{
  ok("NewClientPage continua chamando ClientForm sem a prop tabbed", newClientPageSource.includes("<ClientForm") && !newClientPageSource.includes("tabbed"));
  ok(
    "ClientForm sem tabbed mantém os 3 blocos SEMPRE visíveis (isTabVisible devolve true pra qualquer aba quando !tabbed)",
    clientFormSource.includes("const isTabVisible = (tab:") && clientFormSource.includes("!tabbed || activeSettingsTab === tab"),
  );
  ok("a descrição de cada Block só é omitida quando tabbed — em /clients/new elas continuam aparecendo", clientFormSource.includes('description={tabbed ? undefined : "Identidade e responsabilidade'));
}

// ---------------------------------------------------------------------------
console.log("\nH — Nenhuma alteração de permissão/regra de negócio nesta rodada\n");
{
  ok("a página continua usando requireClientManagerAccess (mesma função de sempre)", editPageSource.includes("requireClientManagerAccess(id)"));
  ok("isAdmin continua lido de profile.role === 'admin' (mesma checagem de sempre)", editPageSource.includes('profile.role === "admin"'));
  ok("deleteClientAction continua a mesma Server Action (requireAdmin, soft-delete via deleted_at) — nenhuma reescrita de regra", actionsSource.includes("export async function deleteClientAction") && actionsSource.includes('deleted_at: new Date().toISOString()'));
}

console.log(`\n${passed} verificações OK.\n`);
