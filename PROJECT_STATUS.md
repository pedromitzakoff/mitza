# PROJECT_STATUS.md

> Checkpoint de desenvolvimento — escrito para permitir retomar o trabalho
> em outra sessão, sem depender do histórico da conversa. Atualizado depois
> da Etapa 20 (sidebar recolhível).

---

# Visão Geral do Projeto

**Objetivo**: sistema web interno da agência MITZA para substituir o
ClickUp, cobrindo:

- Gestão de clientes (cadastro, gestores responsáveis, exclusão reversível).
- Acompanhamento financeiro por sprint semanal (planejado vs. gasto real,
  puxado da Meta Ads).
- Tarefas recorrentes (padrão de sprint, geradas automaticamente).
- Comentários (em sprints e tarefas).
- Um dashboard consolidado de agência inteira ("Visão Geral") e uma tela
  operacional do dia a dia ("Operação").

**Stack**:

- Next.js 16 (App Router, Turbopack), TypeScript, React 19.
- Tailwind CSS v4 (`@theme inline`, tokens de marca em `src/app/globals.css`).
- Supabase: Postgres + Auth + RLS (row level security) como única fonte de
  dados e autenticação — sem backend separado.
- Deploy alvo: Vercel.

**Arquitetura geral**:

- Server Components fazem toda a busca de dados (Supabase JS client),
  sempre em lote via `Promise.all` — nunca uma query por item de uma lista
  (anti-N+1 é uma regra dura do projeto).
- Regra de negócio mora em módulos puros e testáveis em `src/lib/*.ts` (sem
  JSX, fáceis de rodar com `npx tsx` fora do Next).
- `buildOperationClientCard` (`src/app/operation/operation-data.ts`) é a
  função central que monta o "card" de um cliente (financeiro do mês,
  sprint atual, tarefas, alertas, saúde da conta, atividade operacional).
  Ela é reaproveitada por três lugares diferentes: a tela Operação, a Visão
  Geral (dashboard da agência) e o `ClientContextBar` (subheader do
  cliente) — nenhum desses reimplementa a regra, todos chamam a mesma
  função.
- Filtros de tela são sempre via query string (`?health=critico` etc.),
  processados no servidor — filosofia de "zero JS de cliente quando dá",
  só usando client components quando é estritamente necessário (relógio da
  Top Bar, menu mobile, sidebar recolhível, formulários com estado local).
- Datas: `src/lib/today.ts` centraliza "hoje" no fuso `America/Sao_Paulo`
  (o servidor roda em UTC). Datas armazenadas como `date` (sem hora) são
  tratadas como já corretas nesse fuso e formatadas com `timeZone: "UTC"`
  para não sofrer conversão dupla; instantes reais (a hora atual da Top
  Bar) usam `timeZone: "America/Sao_Paulo"` de verdade.

**Serviços externos utilizados**:

- Supabase (Postgres, Auth, RLS) — projeto próprio, configurado via env vars.
- Meta Marketing API (Graph API / Insights) — leitura de gasto diário por
  conta de anúncios, via token de "system user" com permissão `ads_read`.

---

# Estado Atual

## Concluído

- Autenticação com papéis (admin / gestor) e proteção de rotas via
  middleware (`src/proxy.ts` + `src/lib/supabase/middleware.ts`).
- CRUD de clientes (criar, editar, soft delete, restaurar) com atribuição
  de gestores (N:N).
- Sync manual com a Meta Insights API (botão por cliente e "Atualizar Meta
  — todos" no admin) + rota de cron (`/api/cron/sync-meta`, não agendada
  ainda).
- Sprints semanais com `planned_spend` editável (admin) e geração
  automática (trigger ao criar cliente + função pra gerar o mês seguinte).
- Tarefas: CRUD, recorrência, status efetivo (pendente/feito/atrasado),
  geração automática por template global de sprint (idempotente).
- Comentários genéricos (sprint e tarefa).
- Painel financeiro por sprint e por mês, com projeção de fechamento,
  status (dentro/acima/abaixo/sem meta).
- Detecção de atividade operacional (ativo/atenção/inativo) e "sprint sem
  execução", com log de eventos (`operational_activities`) e views
  agregadas.
- Identidade visual MITZA (azul `#4169e1`, branco, preto, tokens em
  `globals.css`, suporte a dark mode).
- Tela **Operação**: visão consolidada de execução diária de todos os
  clientes, com filtros (gestor, saúde, atividade, sprint, busca, modo
  "Hoje"/"Sprint atual"/"Todos"), drawer de tarefa com ações rápidas.
- **Visão Geral** (rota `/`, home pós-login): dashboard da agência inteira
  — filtros globais (mês, gestor, status, atividade, ritmo de
  investimento, tarefas, busca), indicadores de portfólio e financeiro
  consolidados, gráfico planejado x real acumulado da agência, indicadores
  de sprint, bloco "Precisa de atenção", "Contas prioritárias", resumo por
  gestor, tabela de clientes densa com CTAs pra Operação.
- App Shell novo: **Top Bar** global (marca + relógio ao vivo), **Sidebar**
  só como navegação (recolhível no desktop, preferência salva no
  navegador), **ClientContextBar** sticky em toda rota de cliente.
- Painel geral do mês antigo (`/painel-mensal`) ainda existe no código mas
  não é mais linkado de lugar nenhum (superado pela Visão Geral).

## Parcialmente implementado

- **Cron de sync automático da Meta**: a rota existe e funciona
  (`/api/cron/sync-meta`), mas não está agendada em lugar nenhum (nem
  `vercel.json`, nem pg_cron). Hoje a sync só acontece quando alguém clica
  no botão manual.
- **Geração de sprints do mês seguinte**: a função SQL
  (`generate_next_month_sprints()`) existe, mas nada a chama
  automaticamente ainda — precisa ser rodada manualmente ou agendada.
- **Ordenação da tabela principal da Visão Geral**: só tem duas opções
  (prioridade / nome), não é uma ordenação por coluna clicável genérica.

## Não iniciado

- Papel/tela "Reuniões" (item da sidebar existe, marcado "Em breve", sem
  nenhuma tela).
- Tela "Equipe" (admin) — mesma situação, só o item da sidebar existe.
- Qualquer comparação histórica mês a mês (a Visão Geral foi desenhada
  para permitir isso no futuro, mas nada está implementado ainda — ver
  "Regras de Negócio" abaixo).
- Testes automatizados formais (não existe `npm test`; ver seção "Testes e
  Qualidade").

---

# Rotas Existentes

| Rota | Finalidade |
|---|---|
| `/login` | Login (e-mail/senha via Supabase Auth). Única rota pública. |
| `/` | **Visão Geral** — dashboard da agência, home pós-login. |
| `/operation` | **Operação** — execução diária de todos os clientes (`?mode=hoje` é o link "Tarefas" da sidebar). |
| `/clients/new` | Criar cliente (admin). |
| `/clients/[id]` | Página do cliente — header, métricas, alertas, gráfico, sprints do mês, tarefas soltas. |
| `/clients/[id]/edit` | Editar cliente (admin). |
| `/clients/[id]/tasks/new` | Nova tarefa avulsa do cliente. |
| `/clients/[id]/tasks/[taskId]/edit` | Editar tarefa. |
| `/settings` | Índice de configurações (admin). |
| `/settings/sprint-task-templates` | Templates globais de tarefa de sprint (admin). |
| `/settings/deleted-clients` | Clientes excluídos (soft delete) + restaurar (admin). |
| `/painel-mensal` | Painel antigo do mês (admin) — **não linkado em nenhum lugar**, mantido só por precaução, superado pela Visão Geral. |
| `/api/cron/sync-meta` | Endpoint de sync (GET), protegido por `CRON_SECRET` opcional. |

Todas as rotas autenticadas (exceto `/login`) compartilham o App Shell
(`src/app/app-shell.tsx`): Sidebar + Top Bar + conteúdo; rotas de cliente
ganham também o `ClientContextBar` via `src/app/clients/[id]/layout.tsx`.

---

# Banco de Dados

## Tabelas existentes

| Tabela | Função |
|---|---|
| `profiles` | Espelha `auth.users`; guarda `name` e `role` (`admin`\|`gestor`). |
| `clients` | Clientes da agência; `meta_ad_account_id`; `deleted_at` (soft delete). |
| `client_managers` | N:N entre `profiles` (gestores) e `clients`. |
| `sprints` | Blocos fixos de 7 dias por mês (1-7, 8-14, 15-21, 22-28, resto); `planned_spend`. |
| `daily_spend` | Gasto diário por cliente, populado pela sync com a Meta; `synced_at`. |
| `tasks` | Tarefas (avulsas ou vinculadas a `sprint_id`); `type`, `status`, `recurrence`, `template_id`. |
| `comments` | Genérico — comenta `sprint` ou `task` via `commentable_type`/`commentable_id`. |
| `client_task_templates` | **Modelo antigo** (por cliente) de tarefas padrão — desativado, mantido só como histórico (ver migrations). |
| `sprint_task_templates` | Modelo atual (global): templates de tarefa aplicados a "todos os clientes" ou a uma lista (`sprint_task_template_clients`). |
| `sprint_task_template_clients` | Lista de clientes de um template não-global. |
| `operational_activities` | Log de eventos de atividade operacional relevante (tarefa criada/editada/concluída, comentário). |

## Views

- `client_last_operational_activity` — última atividade relevante por cliente.
- `sprint_last_operational_activity` — última atividade relevante por sprint atual.

## Migrations (arquivos em `supabase/`, ordem de execução)

1. `schema.sql` — schema inicial (tabelas base, geração automática de sprints).
2. `policies.sql` — papéis, RLS inicial, trigger de criação de `profiles`.
3. `task-templates.sql` — `client_task_templates` (modelo antigo, por cliente).
4. `cleanup-old-client-templates.sql` — **script opcional**, só cosmético (limpa tarefas de teste do modelo antigo). Rodar em 2 passos (preview + delete).
5. `global-sprint-task-templates.sql` — `sprint_task_templates` (modelo global atual), desativa o modelo antigo.
6. `soft-delete-clients.sql` — `clients.deleted_at`.
7. `operation-collaboration-rls.sql` — abre `select` pra qualquer autenticado (colaboração entre gestores na tela Operação).
8. `operational-activities.sql` — `operational_activities` + as duas views + função de backfill.

**Todas as migrations acima já foram aplicadas** no ambiente de
desenvolvimento do usuário (cada etapa anterior só foi considerada
concluída depois de confirmação de que o SQL tinha sido rodado). Nenhuma
migration nova foi criada nas Etapas 18-20 (foi só código de aplicação —
dashboard, Top Bar, sidebar).

## Scripts de backfill/limpeza

- `cleanup-old-client-templates.sql` — já descrito acima; opcional, cosmético.
- `select backfill_operational_activities();` (dentro de
  `operational-activities.sql`) — popula `operational_activities`
  retroativamente a partir de tarefas/comentários já existentes. Rodado
  uma vez na Etapa 15.
- `select backfill_sprint_tasks_from_templates();` — aplica os templates
  globais de tarefa a sprints que já existiam antes do template ser
  criado/editado. Disponível também pela UI (`/settings/sprint-task-templates`,
  botão "Aplicar às sprints já existentes"). É rodado sob demanda pelo
  usuário sempre que edita um template — não é um passo único de setup.

## RLS / policies relevantes

- Toda tabela de dados tem RLS habilitado.
- `is_admin()` e `is_client_manager(client_id)` são funções `security
  definer` usadas como base das policies.
- **Leitura (`select`)**: aberta pra qualquer usuário autenticado em quase
  toda tabela (`profiles`, `clients`, `client_managers`, `sprints`,
  `daily_spend`, `tasks`, `comments`) — decisão da Etapa 15 pra permitir
  colaboração entre gestores (qualquer um pode ver o card/tarefas de
  qualquer cliente na tela Operação e na Visão Geral).
- **Escrita (`insert`/`update`/`delete`)**: continua restrita — só admin
  edita `clients`, `client_managers`, `sprints` (inclusive `planned_spend`);
  tarefas podem ser escritas por admin ou pelo(s) gestor(es) responsável(is)
  pelo cliente; comentários só podem ser editados/apagados pelo próprio
  autor ou admin.
- `daily_spend` só é escrito pela sync (que roda com a service role key,
  que ignora RLS).

---

# Integração Meta

**Estado atual**: funcional para sync manual; sem automação agendada.

**Como a sincronização funciona**:

1. `src/lib/meta.ts` chama a Graph API (Marketing Insights) com o
   `META_ACCESS_TOKEN`, pedindo o breakdown diário de gasto (`spend`) da
   conta de anúncios do cliente (`meta_ad_account_id`), desde o início da
   sprint atual até hoje.
2. `src/lib/meta-sync.ts` faz o upsert em `daily_spend` (por
   `client_id`+`date`, com `synced_at` atualizado a cada sync).
3. Disparo manual: botão "Atualizar dados do Meta" na página do cliente
   (um cliente) ou "Atualizar Meta (todos)" na sidebar, admin only (todos
   os clientes, em lote).
4. Disparo por script: `npm run sync:meta -- <client_id>`.
5. Disparo por HTTP: `GET /api/cron/sync-meta` (sincroniza todos os
   clientes; usado hoje só manualmente, mas pronto pra virar um cron).

**Variáveis de ambiente necessárias** (só os nomes):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `META_ACCESS_TOKEN`
- `CRON_SECRET` (opcional — protege `/api/cron/sync-meta`; sem ela a rota
  fica aberta, ok em dev, deveria ser configurada em produção)

**Limitações conhecidas**:

- Token da Meta é um "system user token" fixo — não há fluxo OAuth de
  usuário nem renovação automática; se o token expirar/for revogado, a
  sync falha silenciosamente até alguém notar (não há alerta de "sync
  falhou", só o indicador de "sem sincronização recente" que já existe nos
  alertas de atenção).
- Sem cron agendado — depende de alguém clicar no botão ou rodar o
  script/rota manualmente.
- Sem retry/backoff em caso de erro de rede/rate limit da Graph API.

**O que falta para produção**:

- Decidir e configurar o agendamento (cron da Vercel via `vercel.json`,
  `pg_cron`, ou serviço externo) pra sync automática periódica.
- Definir `CRON_SECRET` em produção.
- Monitoramento/alerta real de falha de sync (hoje só o badge "sem
  sincronização recente" na UI, que é passivo).

---

# Autenticação e Permissões

**Papéis existentes**: `admin` e `gestor` (coluna `profiles.role`,
default `gestor` — promover a admin é manual via SQL:
`update profiles set role = 'admin' where id = '<uuid>'`).

**Admin**:

- Vê e edita todos os clientes, sprints (inclusive `planned_spend`),
  templates globais, configurações.
- Cria/edita/exclui (soft delete) clientes, atribui gestores.
- Vê "Resumo por Gestor" na Visão Geral (todos os gestores).
- Único que vê os itens de sidebar "Equipe" e "Configurações" e o botão
  "Atualizar Meta (todos)".

**Gestor responsável** (atribuído ao cliente via `client_managers`):

- Pode criar/editar tarefas e comentar nos clientes que gerencia.
- Não pode editar dados do cliente nem `planned_spend` da sprint (só admin).

**Gestor não responsável** (qualquer outro gestor autenticado):

- Desde a Etapa 15, **pode ver** (read-only) qualquer cliente — dados,
  sprints, tarefas, comentários — para permitir colaboração na tela
  Operação e na Visão Geral (RLS de leitura foi aberta pra todo autenticado).
- **Não pode editar** dados do cliente/sprint desse cliente, mas **pode**
  criar tarefa e comentar mesmo sem ser responsável (a policy de escrita de
  `tasks`/`comments` permite qualquer gestor, não só o responsável — ver
  `operation-collaboration-rls.sql`).
- Na Visão Geral e Operação, o filtro de gestor tem "Meus clientes" como
  padrão, mas qualquer gestor pode trocar pra ver a carteira de outro.

---

# Regras de Negócio

- **Sprints**: blocos fixos de 7 dias dentro do mês civil (1-7, 8-14,
  15-21, 22-28, resto do mês) — não são sprints "rolantes" de 7 dias a
  partir de qualquer data. Numeração ("Sprint N") é relativa ao recorte de
  dados carregado (mês corrente na maioria das telas), não um contador
  histórico absoluto desde o início do cliente.
- **`planned_spend`**: só editável por admin, por sprint.
- **`daily_spend`**: granularidade diária, só escrito pela sync (service
  role); tem `synced_at` pra saber a última vez que os dados daquele dia
  foram atualizados.
- **Tarefas padrão / geração automática**: templates globais
  (`sprint_task_templates`) definem título/tipo/responsável padrão/dia da
  semana; a geração roda por sprint e é **idempotente** (não duplica se
  rodar de novo) — tanto na criação normal quanto no backfill manual
  (`backfill_sprint_tasks_from_templates()`).
- **Status financeiro** (`classifySpendStatus`, `src/lib/spend-status.ts`):
  compara gasto real com esperado, com margem de tolerância de ±10%;
  `sem_meta` quando o planejado é zero/nulo (importante: planejado = 0
  **nunca** conta como "bateu meta").
- **Projeção de fechamento** (`computeMonthProjectionForRange`,
  `src/lib/client-metrics.ts`): extrapola o ritmo diário observado
  (gasto até agora ÷ dias decorridos × dias do mês). Em mês passado,
  projeção = gasto final real; em mês futuro (ainda não começou),
  projeção = 0 (não inventa dado).
- **Status geral do cliente / saúde da conta** (`computeAccountHealth`,
  `src/lib/attention-alerts.ts`): `saudavel`/`atencao`/`critico`, derivado
  da severidade máxima entre os alertas ativos — **não existe** um "health
  score" numérico, é sempre a partir de regras nomeadas e transparentes.
- **Alertas** (`buildAttentionAlerts`): gasto acima/abaixo do esperado,
  tarefas atrasadas, falta de otimização recente, dados do Meta sem sync
  recente (>48h), sprint sem planejado configurado, sprint sem tarefas
  padrão, tarefas sem responsável, inatividade operacional.
- **Atividade operacional** (`src/lib/operational-activity.ts`): `ativo`
  (≤1 dia útil sem atividade), `atencao` (exatamente 2 dias úteis),
  `inativo` (≥3 dias úteis ou nunca houve atividade).
- **Sprint sem execução** (`buildSprintExecutionAlert`,
  `src/lib/sprint-execution.ts`): só se aplica à sprint **atual**; conta
  dias úteis desde a data mais recente entre o início da sprint e a
  última atividade vinculada a ela — mesmos limiares (2 dias = atenção,
  3+ = crítico) da atividade operacional geral, mas medindo a sprint, não
  a conta como um todo.
- **Dias úteis** (`src/lib/business-days.ts`): segunda a sexta; "hoje"
  nunca conta como dia útil decorrido.
- **Soft delete de clientes**: `deleted_at` — sprints, tarefas,
  comentários e `daily_spend` continuam intactos; listagens filtram
  `deleted_at is null` por padrão; restaurar só limpa a coluna.

---

# Interface e Navegação

- **Visão Geral** (`/`): home pós-login, dashboard da agência — filtros
  globais, indicadores de portfólio/financeiro/sprint, gráfico consolidado,
  "Precisa de atenção", "Contas prioritárias", resumo por gestor, tabela
  de clientes.
- **Operação** (`/operation`): execução diária — mesmos conceitos de
  saúde/atividade/sprint sem execução, só que por cliente individual, com
  modos "Hoje"/"Sprint atual"/"Todos" e drawer de tarefa.
- **Clientes** (`/clients/[id]`): página individual — header, métricas do
  mês, alertas, gráfico planejado x real, sprints do mês (accordion),
  tarefas soltas.
- **Sidebar** (`src/app/sidebar.tsx`): navegação principal — Visão Geral,
  Operação, Tarefas (atalho pro modo "Hoje"), Reuniões (em breve), Equipe
  (em breve, admin), Configurações (admin). Recolhível no desktop (botão
  na borda, preferência salva no navegador via `localStorage`); no celular
  continua sendo um menu que abre/fecha pela Top Bar.
- **Top Bar** (`src/app/top-bar.tsx`): global, em toda página autenticada
  — "MITZA" (clicável, abre Visão Geral) + dia da semana/data/hora ao vivo
  no fuso America/Sao_Paulo. Não aparece no login.
- **ClientContextBar** (`src/app/clients/client-context-bar.tsx`):
  subheader sticky em toda rota `/clients/[id]/**` — nome do cliente,
  sprint atual, gestor(es), status geral, ações (Editar, Atualizar Meta).
  Aparece via `src/app/clients/[id]/layout.tsx`, reaproveitando
  `buildOperationClientCard`.
- **Identidade visual MITZA**: azul (`#4169e1` claro / `#7b93e8` escuro),
  branco, preto; cinzas neutros só para borda/texto secundário/fundo;
  cores semânticas (verde/âmbar/vermelho) só para status. Tokens em
  `src/app/globals.css` (`--brand`, `--card`, `--border-default` etc.),
  Tailwind v4 (`@theme inline`). Suporta dark mode
  (`prefers-color-scheme`).

---

# Testes e Qualidade

**Não existe um `npm test`** no `package.json` — o projeto não tem uma
suíte de testes automatizados formal. A metodologia usada até aqui é:

- Scripts `npx tsx` ad-hoc (não versionados, escritos e descartados por
  sessão) pra checar funções puras de `src/lib/*.ts` com `node:assert`.
- Testes de RLS/lógica de banco rodados diretamente via `psql` num
  Postgres local (schema + policies aplicados, com um schema `auth` de
  teste simulando `auth.uid()`), quando a etapa envolve SQL novo.
- Testes visuais via Playwright **não funcionam neste ambiente sandbox**
  (Chromium falha ao abrir, "Page crashed", com qualquer combinação de
  flags testada) — validação visual real depende do usuário testar
  localmente.

**Resultado do último lint**: `npm run lint` — sem erros, sem warnings.

**Resultado do último typecheck**: `npx tsc --noEmit` (não existe script
`typecheck` no `package.json`, mas o projeto usa TypeScript com
`tsconfig.json` configurado) — sem erros.

**Resultado do último build**: `npm run build` — sucesso (`next build`
com Turbopack), todas as rotas compiladas.

**Erros conhecidos**: nenhum, no momento deste checkpoint.

---

# Bugs Conhecidos

Nenhum bug em aberto identificado neste checkpoint. Um bug real foi
encontrado e corrigido durante a Etapa 18: `buildOperationClientCard`
recebia `lastSyncedAt: null` hardcoded (em vez do valor real do cliente),
fazendo o alerta "sem sincronização recente" disparar sempre — já
corrigido e coberto pelas mudanças daquela etapa.

---

# Pendências Prioritárias

## 1. Obrigatório para abandonar o ClickUp

- Configurar sync automática da Meta em produção (cron da Vercel ou
  `pg_cron`) — hoje depende de clique manual.
- Configurar `CRON_SECRET` em produção antes de expor
  `/api/cron/sync-meta` publicamente.
- Confirmar/agendar a geração das sprints do mês seguinte
  (`generate_next_month_sprints()`) — hoje só existe a função SQL, nada a
  chama automaticamente.
- Telas "Reuniões" e "Equipe" (hoje só itens de menu "Em breve") — avaliar
  se são realmente necessárias para o dia a dia ou se ficam para depois.

## 2. Importante depois do MVP

- Ordenação por coluna clicável na tabela principal da Visão Geral (hoje
  só prioridade/nome).
- Monitoramento ativo de falha de sync com a Meta (alerta, não só o badge
  passivo "sem sincronização recente").
- Suíte de testes automatizados formal (hoje é tudo ad-hoc/manual).
- Decidir o que fazer com `/painel-mensal` (manter escondido, ou remover
  de vez).

## 3. Ideias futuras

- Comparação mês a mês (evolução de taxa de execução, investimento,
  contagem de clientes críticos ao longo do tempo) — a Visão Geral já foi
  desenhada pra não atrapalhar isso no futuro, mas nada foi implementado.
- Renovação/gestão de token da Meta via OAuth de usuário, em vez de
  system user token fixo.

---

# Próximo Passo Recomendado

Não há nenhuma etapa em andamento neste momento — a última entrega
(Etapa 20, sidebar recolhível) foi validada pelo usuário. Ao retomar,
comece perguntando ao usuário qual das pendências da lista acima ele quer
priorizar (o item mais urgente do bloco "1. Obrigatório para abandonar o
ClickUp" é a sync automática da Meta, já que hoje ela depende de alguém
lembrar de clicar no botão).

---

# Como Rodar o Projeto

**Instalação**:

```bash
npm install
```

**Variáveis de ambiente**: copie `.env.local.example` para `.env.local` e
preencha com os valores reais (nunca commitar `.env.local`):

```bash
cp .env.local.example .env.local
```

Variáveis necessárias: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`META_ACCESS_TOKEN`, `CRON_SECRET` (opcional).

**Banco de dados / Supabase**: rode os arquivos de `supabase/` no SQL
Editor do projeto Supabase, na ordem listada na seção "Migrations" acima
(todos já foram aplicados no ambiente do usuário; um projeto Supabase novo
precisaria rodar todos, em ordem, exceto `cleanup-old-client-templates.sql`
que é opcional/cosmético).

**Desenvolvimento local**:

```bash
npm run dev
```

Abre em `http://localhost:3000`.

**Sync manual da Meta** (fora da UI):

```bash
npm run sync:meta -- <client_id>
```

**Lint**:

```bash
npm run lint
```

**Typecheck** (não existe script dedicado no `package.json`):

```bash
npx tsc --noEmit
```

**Testes**: não existe `npm test`. Verificações de lógica pura são feitas
com scripts `npx tsx` ad-hoc (não versionados no repositório); mudanças
que envolvem SQL/RLS são verificadas com um Postgres local via `psql`.

**Build de produção**:

```bash
npm run build
```
