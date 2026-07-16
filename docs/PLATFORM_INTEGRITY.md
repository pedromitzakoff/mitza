# Constituição de Integridade da Plataforma Mitza

## Objetivo do documento

Este não é um relatório de auditoria. É a Constituição viva da MITZA: o
registro permanente de como cada conceito da plataforma DEVE se comportar,
daqui para frente, em qualquer lugar onde exista.

Nasceu de três etapas em sequência — cada uma preservada como histórico,
nenhuma reescrita pelas seguintes:

1. **MITZA Platform Integrity Audit 1.0** — mapeou os conceitos oficiais da
   plataforma, suas inconsistências, fontes da verdade e maturidade.
2. **MITZA Platform Integrity Review 1.0** — transformou os achados da
   auditoria em decisões oficiais e um roadmap por Waves.
3. **MITZA Platform Constitution 1.0** — sincronizou toda a documentação
   com essas decisões e implementou a Wave 1 (Representação) como prova de
   que a Constituição funciona na prática, não só no papel.

Este documento não substitui `PLATFORM_MANIFESTO.md` (o "porquê" de
produto) nem `ARCHITECTURE_PRINCIPLES.md` (o "como" técnico geral) — ele é
o nível intermediário: qual é a forma OFICIAL de cada conceito, e por quê.

## Como deve ser utilizado

Consultado antes de qualquer implementação que toque um conceito já
existente, ou que possa estar introduzindo um conceito novo. Se a
implementação diverge do que está aqui, ou o conceito não está descrito
aqui, isso é o sinal de parar e propor impacto global antes de codar (ver
`docs/HOW_WE_BUILD_FEATURES.md`).

## Quem deve atualizá-lo

Quem implementa uma etapa que introduz, unifica ou altera a representação
oficial de um conceito. Mudanças aqui exigem o mesmo rigor de uma decisão
em `DECISIONS.md` — não são edições triviais.

## Quando deve ser atualizado

Sempre que uma Wave do roadmap (Seção 14) for concluída, sempre que um
novo conceito oficial nascer, ou sempre que uma inconsistência descrita
aqui for resolvida — nunca como efeito colateral silencioso de uma
implementação não relacionada.

---

## 1. Preâmbulo

A MITZA é um sistema único. Um cliente, uma sprint, uma tarefa, um status
— cada conceito existe UMA vez, e deve se comportar exatamente da mesma
forma em qualquer tela onde apareça. Quando isso deixa de ser verdade, a
plataforma para de "falar a mesma língua" consigo mesma, e cada
inconsistência nova é carga cognitiva emprestada de volta ao gestor — o
oposto do que o Manifesto (Capítulo 9) promete.

Esta Constituição existe para que essa promessa seja verificável, não só
aspiracional.

## 2. Princípio fundamental

> Um conceito deve possuir apenas UMA forma oficial de existir.

Onde hoje existem dois caminhos para o mesmo conceito, um foi escolhido
como oficial (Seção 5). Onde a divergência é legítima (dois conceitos
diferentes que só parecem iguais), isso está documentado explicitamente,
nunca por omissão.

## 3. Glossário de conceitos oficiais

Cliente, Sprint, Tarefa, Performance, Objetivo, Comentário, Revisão de
conta (antes "Otimização" — Seção 8 da Vocabulário), Equipe, Gestor,
Relatórios, Indicadores (KPI), Status (meta-conceito, ver Seção 7),
Integrações (Meta Ads / canais manuais), Orçamento, Permissões, Próxima
ação / Prioridade, Toast, Drawer, Modal, Popover, Empty State, Tooltip,
Sidebar / Navegação, Filtros, Context Memory, Interaction Engine.

Cada um tem uma ficha completa nos registros de decisão desta família de
etapas (Platform Integrity Audit 1.0 e Review 1.0, preservados no
histórico da conversa/commits) — este documento consolida a
REPRESENTAÇÃO e as DECISÕES, não repete a ficha inteira de cada um.

## 4. Fonte da verdade por conceito

Cada conceito de DADO continua com exatamente uma fonte (uma tabela, um
enum) — isso nunca foi o problema real. A tabela abaixo aponta onde:

| Conceito | Fonte da verdade |
|---|---|
| Cliente | `clients` |
| Sprint | `sprints` |
| Tarefa | `tasks` |
| Comentário | `comments` (`CommentableType`) |
| Revisão de conta | `account_reviews` |
| Equipe / Gestor | `team_members` |
| Relatório mensal | `monthly_reports` |
| Indicador (KPI) | `client_kpis` |
| Orçamento | `monthly_budgets` + `sprints.planned_spend` |

## 5. Superfícies oficiais de edição

- **Cliente**: `/clients/[id]/edit` (cadastro completo — identidade,
  contato, objetivo) e a tabela inline de `/settings/clients` (campos
  operacionais de alta frequência — status, gestor, datas, CNPJ, e-mail,
  mensalidade). Cada campo pertence a exatamente UMA das duas — pendência
  registrada na Wave 3 (Seção 14) é remover a duplicação de campo hoje
  ainda presente no formulário completo.
- **Tarefa**: a interação de linha (`task-row.tsx`, concluir/excluir,
  instantânea) é a oficial. Criar/editar via página cheia é o modelo
  ainda pendente de migração (Wave 2/3).
- **Sprint, Performance, Orçamento, Comentário**: uma única superfície
  cada, já consolidada.

## 6. Contrato oficial de Server Actions

**Regra**: toda Server Action de mutação retorna `{error?: string}` e usa
`revalidatePath`. `redirect()` é reservado exclusivamente para navegação
intencional (ex.: ir para a página do cliente recém-criado) — nunca para
sinalizar erro, nem mesmo dentro de uma Action que também navega no
sucesso.

**Achado de implementação**: duas Actions (`updateSprintPerformanceAction`,
`createCommentAction`) tinham contrato MISTO — sucesso em `{error?}`, erro
ainda em `redirect()`. Corrigir isso é trabalho de Wave 2 (mudança de
contrato, não de representação — fora do escopo da Wave 1 já
implementada).

**Referência de contrato limpo**: `applyMonthlyBudgetChangeAction` — nunca
redireciona, sempre `{error?}`.

## 7. Registry de representação (Status)

Status não é UM enum — é um padrão que se repete em ~10 eixos de negócio
distintos (contrato do cliente, tarefa, saúde de conta, atividade
operacional, ritmo financeiro, relatório mensal, item de ação, meta de
KPI, membro de equipe, convite de acesso). Cada eixo mantém seu próprio
enum — misturá-los destruiria informação real.

O que passa a ser único é a REPRESENTAÇÃO: `src/lib/status-registry.ts`
centraliza label, classe visual de badge e ordem de cada valor, com
chaves qualificadas por domínio (`"task.pendente"`, `"account_health.
atencao"`) — nunca uma chave sem domínio, exatamente para impedir a
ambiguidade que a auditoria encontrou (`"atencao"` e `"em_andamento"`
reaproveitados por eixos diferentes, com significados diferentes).

Os arquivos de domínio (`task-labels.ts`, `client-fields.ts`,
`spend-status.ts`, `operational-activity.ts`, `team-members.ts`,
`monthly-reports.ts`, `priorities-panel.tsx`, `reports/[clientId]/
page.tsx`) continuam exportando as mesmas constantes de sempre
(`TASK_STATUS_LABEL`, `CLIENT_STATUS_BADGE_CLASSES` etc.) — viraram
adapters finos derivados do registry, então nenhum outro ponto de consumo
na plataforma precisou mudar.

## 8. Vocabulário oficial

- **"Revisão de conta"** é o nome oficial do registro histórico de
  revisão estratégica de uma conta (`account_reviews`) — nunca mais
  "Otimização" nesse contexto. **"Otimização"** continua correta pra
  outros dois usos, sem ambiguidade real: (a) o TIPO de tarefa recorrente
  (`TaskType.otimizacao`), e (b) o RESULTADO possível de uma revisão
  (`AccountReviewOutcome.OPTIMIZATION_PERFORMED`, "uma otimização foi
  executada durante a revisão").
- **"Conta em atenção"** (saúde da conta) vs. **"Operação em atenção"**
  (atividade operacional do gestor) — mesma palavra-base, qualificada
  quando os dois conceitos podem coexistir na mesma tela.
- **"Sprint em andamento"** / **"Relatório em andamento"** / **"Item em
  andamento"** — três eixos diferentes que reaproveitavam o mesmo texto
  cru "Em andamento".
- **"Sprints"** é o nome oficial do produto para essa área — "Operação"
  nunca nomeia a tela (a rota `/operation` é só redirect técnico).
  Um uso genérico da palavra "Operação" como rótulo de agrupamento (ex.:
  seção "Operação" dentro do drawer de membro de equipe, referindo-se a
  dados operacionais da pessoa) não é a mesma colisão e não precisa
  mudar.
- Erros técnicos nunca são exibidos crus ao usuário; toasts de sucesso
  citam o que mudou.

## 9. Padrão visual por elemento

Botão, badge, input, select, drawer, popover, sidebar, card, foco, hover,
pressed e animação já têm um padrão único consolidado em etapas
anteriores (Interaction Delight 1.0, Design System tokens). Dois pontos
em aberto, tratados nesta Wave 1:

- **Tooltip** não tinha componente oficial — criado em
  `src/components/ui/tooltip.tsx` (portal, acessível por teclado, sem
  animação pra respeitar `prefers-reduced-motion` por padrão).
- **Empty State** tem DOIS componentes oficiais coexistindo por família
  visual — `@/components/ui/empty-state.tsx` (`EmptyState`/
  `EmptyStateRow`, família "app": Cliente, Sprints, Configurações,
  Relatórios) e `@/components/workspace/empty-state.tsx` (`EmptyState`
  com título/descrição, família "Visão Geral"/overview). Não foram
  unificados nesta Wave — cada tela usa o da sua própria família de
  tokens visuais; unificá-los de verdade é uma decisão de Wave 3 (exige
  escolher uma única API de props).

## 10. Comportamento por tipo de ação

| Ação | Comportamento oficial |
|---|---|
| Salvar / Atualizar / Excluir / Restaurar (campo ou registro existente, reversível) | Instantâneo, otimista, rollback automático |
| Criar (registro novo, formulário completo com vários campos obrigatórios) | Servidor-primeiro aceitável; termina em navegação explícita, nunca em erro via redirect |
| Registrar (revisão de conta) | Instantâneo na inserção; sem rollback de edição (evento histórico imutável) |
| Concluir / Responder | Instantâneo, otimista |
| Atualizar Meta / Sincronizar Meta | Não otimista — depende de sistema externo; loading explícito, nunca instantâneo fingido |
| Atualizar Performance | Otimista quando é edição do usuário; não otimista quando vem de sync externo |

## 11. Permissões

`requireAdmin()` no servidor é a autoridade real; `isAdmin` na UI é só
reflexo dela. Regra vigente: toda ação restrita a Admin deve estar
ausente ou desabilitada na UI para quem não pode executá-la — nunca
visível-e-clicável-com-falha-silenciosa-no-servidor. Auditoria completa
de onde isso ainda não é verdade fica para Wave 2.

## 12. Interaction Engine e Context Memory

Infraestrutura genérica já consolidada (`src/lib/optimistic-list.ts`,
`row-exit-animation.ts`, `screen-memory.ts`/`screen-memory-client.tsx`,
`floating-menu.tsx`). Regra vigente a partir desta Constituição: toda
tela nova com conteúdo expansível instancia `useScreenMemory`; toda
mutação reversível nova usa o padrão de otimismo/rollback do Interaction
Engine — não é mais recomendação, é requisito de arquitetura.

## 13. Decisões constitucionais numeradas

Ver `DECISIONS.md` — apenas as decisões que mereceram histórico
arquitetural formal foram registradas lá, numeradas na sequência
principal. Este documento consolida o RESULTADO; `DECISIONS.md` guarda o
CONTEXTO e a justificativa de cada uma.

## 14. Roadmap por Waves

- **Wave 1 — Representação** (implementada nesta etapa): Status Registry,
  badges/labels centralizados, Empty States migrados, Tooltip oficial
  criado, vocabulário de baixo risco aplicado.
- **Wave 2 — Comportamento**: contrato único de Server Action (eliminar
  os contratos mistos), extensão do Interaction Engine pra Tarefa
  criar/editar e Revisão de conta, regra de permissão "ausente, não
  desabilitado", expansão de cobertura de Toast.
- **Wave 3 — Conceitos**: unificação de Cliente (campo pertence a uma
  única superfície), migração de Relatórios pro padrão instantâneo,
  esclarecimento visual Meta (automático) vs. Google (manual),
  composição visual Equipe (status + convite), unificação Sprint/Mês
  (posição temporal), unificação dos dois componentes EmptyState.
- **Wave 4 — Produto**: conceitos novos ainda não oficiais (Seção 15).

## 15. Conceitos candidatos e reservados

- **Status Registry como conceito de primeira classe** — hoje é
  infraestrutura (`src/lib/status-registry.ts`); pode virar uma tela de
  auditoria viva no futuro.
- **Canal de mídia vs. Integração** — Meta (sync automático) e Google
  (atribuição manual) deveriam ser dois conceitos nomeados
  separadamente, não um só "Integrações".
- **TikTok Ads / LinkedIn Ads** (`TrafficChannelDb`) — reservados no
  schema, não implementados, não expostos em nenhuma tela. Permanecem
  assim até uma decisão explícita de construir a integração real.
- **Vínculo Gestor↔Cliente** — hoje implícito em `primary_manager_id` +
  `manager_ids[]`, nunca tratado como conceito com ficha própria.
- **Receita / ROI / Financeiro da agência, Automações** — vide Wave 4.

## 16. Processo de emenda constitucional

Uma decisão registrada aqui não é imutável, mas também não muda
silenciosamente:

1. A mudança proposta é registrada como uma nova decisão em
   `DECISIONS.md` (nunca editando a decisão antiga).
2. Este documento é atualizado na mesma etapa que implementa a mudança —
   nunca antes (especular) nem depois (documentação desatualizada).
3. A seção afetada aqui é reescrita, mas o HISTÓRICO da decisão anterior
   permanece rastreável via `DECISIONS.md`.

## 17. Checklist obrigatório antes de qualquer implementação

Ver `docs/HOW_WE_BUILD_FEATURES.md` — o checklist prático (17 pontos +
Concept Impact Assessment) vive lá para não duplicar conteúdo; esta
Constituição é a referência que ele aponta de volta.
