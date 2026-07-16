# Platform Visual Language & Operational Hierarchy — 1.0

## Objetivo do documento

Auditoria de **apresentação da informação** — não de arquitetura (já
coberta em `PLATFORM_OPERATIONAL_ARCHITECTURE.md`), não de componentes.
Pergunta central: um gestor consegue entender uma tela em poucos segundos,
antes mesmo de ler todo o texto? Nenhuma mudança de funcionalidade, regra
de negócio, banco, integração, permissão, cálculo ou fluxo — só como a
informação é lida.

Telas cobertas: Visão Geral/Dashboard (`/`), Clientes (`/clients`), Sprint
(`/clients/[id]`, o "Cliente individual"), Equipe (`/team`), Relatórios
(`/reports`), Configurações (`/settings`).

---

## PARTE 1 — Visual Language Audit

| Tela | Existe linguagem consistente? | Nota |
|---|---|---|
| Visão Geral | Tem SEU PRÓPRIO sistema de tokens (`--overview-*`, cores/bordas/superfícies dedicadas, criado na Etapa 47) — internamente consistente, mas **diferente** do resto da plataforma | 7/10 |
| Cliente individual (Sprint) | Usa os tokens compartilhados (`text-foreground`/`text-muted-foreground`/`border-border`/`bg-card`) de forma disciplinada — já refinado em várias etapas de densidade | 8/10 |
| Clientes/Equipe/Relatórios/Configurações | Mistura tokens compartilhados com classes `zinc-*`/`text-black` cruas, herdadas de quando essas telas foram construídas antes da tokenização | 6/10 |

**Achado central (o mais importante deste documento)**: a plataforma não
tem UMA linguagem visual — tem **duas**, e isso está documentado no
próprio código desde a Etapa 47: `globals.css` explica que o sistema
`--overview-*` foi criado só para a Visão Geral, com a intenção declarada
de "quando esse sistema for promovido pras demais telas, os tokens abaixo
é que vão virar os globais... não o contrário." Ou seja, a divergência é
uma decisão consciente e temporária, nunca revertida. Isso responde
diretamente à pergunta da Parte 1: **cada tela não foi construída
separadamente por acidente — a Visão Geral foi deliberadamente
adiantada** para um sistema de design mais maduro que ainda não chegou às
outras telas.

**Nota geral da plataforma: 6,5/10** — funcional e nunca inconsistente a
ponto de confundir, mas com duas famílias de token coexistindo e resíduos
de `text-black`/`zinc-*` cru em telas mais antigas.

---

## PARTE 2 — Text Hierarchy

Classificação do que já existe (não inventado — é a convenção real usada
hoje, só nunca tinha sido nomeada):

| Categoria | Classe hoje | Onde aparece |
|---|---|---|
| Título principal | `text-2xl font-semibold` (ou `text-xl` em telas mais estreitas) | `<h1>` de cada página |
| Título operacional | `text-sm font-medium` / `text-xs font-semibold uppercase tracking-wide text-muted-foreground` (`SectionHeader`) | Seções dentro de uma tela ("Tarefas", "Otimizações", "Sprints de {mês}") |
| Indicador principal | `text-base font-semibold` / `text-lg font-semibold tabular-nums` | KPIs (Investimento, Resultados, Custo por resultado) |
| Indicador secundário | `text-sm font-medium tabular-nums` | Métricas de contexto (Esperado hoje, Diferença) |
| Contexto | `text-sm text-muted-foreground` | Linhas descritivas abaixo de um indicador |
| Descrição | `text-sm text-foreground` | Corpo de texto (observações, notas) |
| Metadado | `text-[11px]` / `text-xs text-muted-foreground` | Datas, "há 2 dias", labels de campo |
| Observação/auxiliar | `text-[10px] uppercase tracking-wide text-muted-foreground` | Rótulos de coluna, labels de disclosure |

**Existe diferenciação suficiente?** Sim, dentro de cada tela — as etapas
de Densidade/Executive Dashboard já estabeleceram essa escada. **O que
falta é ela estar nomeada e documentada** (o que este documento faz agora)
para parar de ser reinventada informalmente a cada etapa nova.

**Quebra encontrada**: `<h1>` de página usa `text-black dark:text-zinc-50`
cru em 7 telas (Configurações, Clientes excluídos, Templates de sprint,
Login, Novo/Editar cliente) em vez do token `text-foreground` — mesma
categoria "Título principal", duas implementações. Corrigido nesta etapa
(ver Implementação).

---

## PARTE 3 — Visual Weight

- **Tudo parece importante?** Não mais na Visão Geral (Operational
  Workspace 2.0 já resolveu isso — Prioridade em destaque, financeiro
  recolhido). Nas demais telas, o peso já é moderado — bordas discretas,
  poucos títulos gritando.
- **Excesso de cartões/bordas?** O Relatório individual é o único caso
  real: 9 `SectionCard`s empilhados, cada um com sua própria borda — a
  moldura repetida 9 vezes pesa mais do que o conteúdo em si.
- **Onde grita sem necessidade?** Nenhum caso flagrante restante — as
  etapas de Interaction Engine/Feel já removeram cores de alerta fora de
  contexto.
- **Onde está silenciosa demais?** Nenhum achado novo — Density/Feel já
  cobriram isso.

---

## PARTE 4 — Color Language

**Linguagem oficial (a partir do que já existe, sem paleta nova):**

| Cor | Significado oficial | Fonte |
|---|---|---|
| Azul (`brand`) | Ação/marca — links, botões primários, badge de "sprint atual" | `--brand` |
| Preto/quase-preto (`foreground`) | Informação principal (títulos, valores primários) | `--foreground` |
| Cinza médio (`muted-foreground`) | Contexto (subtítulos, descrições) | `--muted-foreground` |
| Cinza claro (`text-[11px]`/`text-xs` + muted) | Metadado (datas, labels) | combinação de tamanho + `muted-foreground` |
| Vermelho | Problema real (atrasado, acima do orçamento, crítico) | `DANGER` (`status-registry.ts`) / `text-red-600` |
| Âmbar/amarelo | Atenção (abaixo do ritmo, revisão pendente) | `WARNING` (`status-registry.ts`) / `text-amber-600` |
| Verde | Sucesso (no prazo, dentro da meta, otimização realizada) | `SUCCESS` (`status-registry.ts`) / `text-green-600` |

**Inconsistências encontradas e corrigidas nesta etapa**: a mesma
semântica de sucesso ("no prazo", "otimização realizada", "atualização
enviada") usava `text-green-600` em alguns arquivos e `text-emerald-600`
em outros — mesma cor visualmente, escalas diferentes do Tailwind.
Unificado pra `green` (a mesma família já usada pelo badge `SUCCESS` em
`status-registry.ts`) em `operational-activity-panel.tsx`,
`account-reviews-section.tsx` e `client-update-editor.tsx`.

**Inconsistência encontrada e NÃO corrigida (fora do escopo desta
etapa)**: os tokens `--overview-*` (Visão Geral) têm sua própria escala de
cinza (`overview-text-primary`/`overview-text-secondary`/`overview-border`)
com valores hexadecimais próximos, mas não idênticos, aos tokens
compartilhados (`foreground`/`muted-foreground`/`border-default`) usados
no resto da plataforma. Unificar essa escala tocaria em muito mais do que
texto (também superfícies/hover/seleção), e o próprio código já decidiu
conscientemente adiar essa convergência (ver Parte 1) — registrado como
prioridade de roadmap, não uma correção "macro" segura para esta etapa.

---

## PARTE 5 — Text Emphasis

O que já recebe destaque corretamente hoje: valores monetários
(`tabular-nums font-semibold`), nomes de cliente em tabelas (`font-bold`/
`font-medium`), percentuais de ritmo, datas de vencimento coloridas por
urgência (`TaskRow`). O que ainda aparece "plano": nada de grave — a única
correção real feita nesta etapa foi de cor (Parte 4), não de peso; a
tipografia de ênfase (negrito/tabular-nums em números, nome do
responsável em `font-medium`) já está aplicada de forma consistente desde
as etapas de Densidade.

---

## PARTE 6 — Reading Flow

- **Visão Geral**: Entrada → Título → Estado (badge de ritmo, se
  aplicável) → **Prioridade** (já promovida na Operational Workspace 2.0)
  → Execução (clicar num cliente) → Consulta (painel financeiro
  recolhido) → Histórico (Operação por gestor, recolhido). Fluxo já
  alinhado ao ideal.
- **Cliente individual**: Entrada → Título/Identidade → Estado (selo de
  ritmo do mês) → Prioridade (Foco agora) → Execução (tarefas da sprint) →
  Consulta (investimento/performance) → Histórico (comentários,
  informações essenciais). Já alinhado (Operational Workspace 1.0).
- **Sprints**: Entrada → Título → seleção de aba (quebra: decisão que
  deveria ser automática, já registrada em `PLATFORM_OPERATIONAL_
  ARCHITECTURE.md`) → Estado/Execução (dentro de cada card) → Consulta.
- **Equipe**: Entrada → Título → Estado (contadores) → Execução (nenhuma
  real na lista, só links) → Consulta (tabela). Falta uma camada de
  Prioridade explícita (quem precisa de atenção), mas isso é achado de
  arquitetura, já registrado no documento anterior.
- **Relatórios individual**: Entrada → Título → **quebra**: consulta
  (Resumo/Performance/Execução/Comportamento) antes de qualquer Prioridade
  ou Execução — já registrado como achado de arquitetura; aqui reforça
  que a LEITURA, não só a estrutura, sofre com isso: o gestor lê 4 blocos
  de números antes de chegar no que só existe ali (Pendências, Análise).
- **Configurações**: Entrada → Título → lista (sem Estado/Prioridade/
  Execução — correto, é um índice administrativo).

---

## PARTE 7 — Visual Rhythm

- **Excesso de informação agrupada?** Só no Relatório individual (Parte
  3) — 9 seções na mesma densidade visual, sem variação de ritmo entre
  "consulta rápida" e "autoria demorada".
- **Espaço desperdiçado?** Nenhum achado novo — as etapas de Densidade já
  trataram isso extensivamente em praticamente toda tela operacional.
- **Mudança brusca de densidade?** A transição de Sprints (denso,
  compacto) para Relatórios (mais espaçado, forms tradicionais) é
  perceptível — não é errada (são modos de uso diferentes: execução vs.
  autoria), mas nunca foi documentada como uma decisão consciente até
  agora.

---

## PARTE 8 — Information Emphasis

Pergunta: toda tela responde visualmente "o que é mais importante, o que
é secundário, o que é só contexto"? **Sim**, na maioria — o padrão
label-pequeno-maiúsculo + valor-grande já comunica isso. A única exceção
sistemática é a mistura de tokens (Parte 1): quando um `<h1>` usa
`text-black` cru ao lado de outro elemento da mesma tela usando
`text-foreground`, o peso VISUAL é idêntico (as cores são quase iguais),
mas o SISTEMA por trás não é — o que não afeta o gestor hoje, mas
acumula risco de divergência silenciosa (ex.: se o tema escuro for
ajustado no futuro, um dos dois muda e o outro não).

---

## PARTE 9 — Operational Scanning (3 segundos)

- **Visão Geral**: em 3s, dá pra ver o badge de prioridade mais urgente e
  o nome do cliente — exatamente o que deveria ser visto primeiro
  (resultado direto da Operational Workspace 2.0).
- **Cliente individual**: em 3s, dá pra ver nome, status contratual, selo
  de ritmo e a Próxima Ação com CTA — igual, já resolvido.
- **Sprints**: em 3s, dá pra ver a aba ativa e a lista de clientes, mas
  NÃO dá pra saber se está na aba certa pro que se quer fazer (achado de
  arquitetura, reforçado aqui pela leitura real).
- **Equipe**: em 3s, dá pra ver contagem de ativos/pendentes — não dá pra
  ver quem precisa de atenção sem abrir a tabela inteira.
- **Relatórios individual**: em 3s, dá pra ver o título do cliente e o
  status do relatório — não dá pra ver o que falta preencher sem rolar.
- **Configurações**: em 3s, a tela inteira já foi lida — correto para o
  propósito.

---

## PARTE 10 — Visual Consistency

| Componente | Consistente entre telas? |
|---|---|
| Badges de status | Sim — `status-registry.ts` centraliza desde a Platform Constitution 1.0 |
| Botões (primário/secundário) | Sim — `SECONDARY_ACTION_BUTTON_CLASSES`, `mitza-pressable` já compartilhados |
| Cabeçalhos de seção (`SectionHeader`) | Sim, onde usado (Sprint) — Equipe/Relatórios ainda usam `<h1>`/`<h2>` cru para o mesmo papel |
| Tabelas | Parcialmente — mesma anatomia (cabeçalho uppercase muted, linhas com hover), mas Relatórios/Clientes/Equipe cada uma com sua própria implementação inline (não um componente `Table` compartilhado) |
| Cards/listas | Sim — mesmo padrão de borda/raio (`rounded-lg border border-border`) em praticamente toda a plataforma |
| Tooltips/menus flutuantes | Sim — `Tooltip`/`FloatingPortalPanel` compartilhados desde Interaction Engine |

**Conclusão**: a plataforma **é** um sistema único na maior parte dos
componentes interativos (badges, botões, tooltips, animação) — a
inconsistência que resta está concentrada em **tokens de cor/texto
crus versus tokens compartilhados**, não em componentes duplicados ou
famílias visuais divergentes. Isso é uma notícia melhor do que poderia
ser: não há "telas de outro sistema", há resíduos de nomenclatura de cor
em telas mais antigas.

---

## Score de Leitura

| Tela | Antes desta etapa | Depois |
|---|---|---|
| Visão Geral | 7 (herdava do Operational Workspace 2.0) | 8 |
| Cliente individual | 8 | 8,5 (título de `Section` agora tokenizado) |
| Clientes | 6 | 7 (h1 tokenizado) |
| Equipe | 7 | 7,5 (cor de sucesso unificada) |
| Relatórios | 6 | 7 (h1/célula de nome tokenizados) |
| Configurações | 6 | 8 (h1 + 2 links tokenizados) |
| **Média** | **6,7** | **7,7** |

---

## Implementação desta etapa

Escopo estritamente de linguagem — nenhuma estrutura, componente ou regra
tocada:

1. **Título principal tokenizado** — `text-black dark:text-zinc-50` (e a
   variante `dark:text-white`) substituído por `text-foreground` em 7
   arquivos: `settings/page.tsx`, `settings/deleted-clients/page.tsx`,
   `settings/sprint-task-templates/page.tsx`, `login/page.tsx`,
   `clients/new/page.tsx`, `clients/[id]/edit/page.tsx`,
   `clients/section.tsx` (título de seção reutilizado em toda a página do
   cliente), `reports/page.tsx` (célula de nome do cliente).
2. **Cor de sucesso unificada** — `text-emerald-600` (3 ocorrências, 3
   arquivos) alinhado pra `text-green-600`, a mesma família já usada pelo
   badge `SUCCESS` central (`status-registry.ts`).

**Deliberadamente NÃO tocado** (documentado como achado, não como
correção): os inputs/bordas de formulários legados (`client-form.tsx`,
`/tasks/new`, `/tasks/[taskId]/edit` — já marcadas como rotas legadas em
etapa anterior) e a divergência de escala de cinza entre `--overview-*` e
os tokens compartilhados — ambos exigem tocar muito mais superfície do
que uma etapa de linguagem visual permite com segurança.

---

## Próximas prioridades

1. Promover o sistema `--overview-*` (ou convergir os dois) pras demais
   telas — é a própria intenção já registrada em `globals.css` desde a
   Etapa 47, nunca executada.
2. Extrair um componente `Table` compartilhado (cabeçalho/linha/hover) pra
   Clientes/Equipe/Relatórios pararem de reimplementar a mesma anatomia.
3. Migrar `client-form.tsx` e as 2 páginas legadas de tarefa pro token
   `text-foreground`/`border-border` como parte de uma etapa que já vá
   mexer nesses arquivos por outro motivo (evita tocar neles só por
   estética).
