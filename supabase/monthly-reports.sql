-- Etapa 45: nova área "Relatórios" — Relatório Mensal de Gestão da Conta.
-- Rode depois de supabase/monthly-budget.sql.
--
-- Reaproveita o que já existe (clients, sprints, tasks, comments, orçamento
-- mensal, is_admin()/is_client_manager()) e só cria tabela nova pro que é
-- específico do relatório: KPIs configurados por cliente, o relatório em si
-- (status + campos narrativos), o valor mensal de cada KPI, a linha do
-- tempo de acontecimentos, os comentários selecionados pro fechamento e o
-- plano de ação do próximo mês.

-- ---------------------------------------------------------------------------
-- tasks.type ganha 'reuniao' e 'entrega_criativo' — o Bloco 3 do relatório
-- ("Execução da agência") mostra reuniões e entregas de criativos contando
-- tarefas desses tipos, em vez de inventar uma tabela de eventos paralela
-- pra algo que já é, na prática, uma tarefa operacional com prazo e
-- responsável (mesma tabela `tasks`, nunca duplicada).
-- ---------------------------------------------------------------------------
alter table tasks drop constraint if exists tasks_type_check;
alter table tasks add constraint tasks_type_check
  check (type in ('otimizacao', 'verificacao_saldo', 'report', 'outro', 'reuniao', 'entrega_criativo'));

-- ---------------------------------------------------------------------------
-- client_kpi_definitions: quais KPIs este cliente acompanha (configuração,
-- não dado de um mês específico) — "os KPIs exibidos devem depender da
-- configuração de cada cliente".
-- ---------------------------------------------------------------------------
create table if not exists client_kpi_definitions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  name text not null,
  unit text not null default 'numero' check (unit in ('numero', 'moeda', 'percentual')),
  target numeric(14, 2),
  -- Direção do KPI: pra CPL/CPA (custo), menor é melhor; pra Leads/ROAS/
  -- Vendas, maior é melhor. Sem isso, "Situação" (bateu meta?) adivinharia
  -- errado pra metade dos KPIs de mídia — nunca mostrar uma situação que
  -- pode estar invertida.
  direction text not null default 'maior_melhor' check (direction in ('maior_melhor', 'menor_melhor')),
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists client_kpi_definitions_client_idx
  on client_kpi_definitions (client_id, display_order);

alter table client_kpi_definitions enable row level security;

create policy client_kpi_definitions_select on client_kpi_definitions
  for select using (auth.uid() is not null);

create policy client_kpi_definitions_write on client_kpi_definitions
  for all using (is_admin() or is_client_manager(client_id))
  with check (is_admin() or is_client_manager(client_id));

-- ---------------------------------------------------------------------------
-- monthly_reports: um registro por cliente + mês. `snapshot` só é
-- preenchido na finalização (ver seção 13 do pedido) — antes disso o
-- relatório é sempre lido "ao vivo" a partir dos dados atuais.
-- ---------------------------------------------------------------------------
create table if not exists monthly_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  month_start date not null, -- primeiro dia do mês do relatório
  status text not null default 'nao_iniciado'
    check (status in ('nao_iniciado', 'em_andamento', 'pronto_revisao', 'finalizado')),
  executive_summary text,
  next_month_priority text,
  next_month_problems text,
  next_month_opportunities text,
  next_month_tests text,
  finalized_by uuid references profiles (id) on delete set null,
  finalized_at timestamptz,
  snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, month_start),
  -- só pode estar "finalizado" com quem finalizou e quando registrados —
  -- trava simples de integridade, sem precisar de trigger.
  check (status <> 'finalizado' or (finalized_by is not null and finalized_at is not null))
);

create index if not exists monthly_reports_client_month_idx
  on monthly_reports (client_id, month_start);

alter table monthly_reports enable row level security;

-- Select aberto pra qualquer autenticado — mesma colaboração já usada em
-- clients/sprints/tasks/comments desde a Etapa 15 (operation-collaboration-rls.sql).
create policy monthly_reports_select on monthly_reports
  for select using (auth.uid() is not null);

create policy monthly_reports_write on monthly_reports
  for all using (is_admin() or is_client_manager(client_id))
  with check (is_admin() or is_client_manager(client_id));

-- Resolve o client_id de um relatório — helper único, no mesmo espírito de
-- commentable_client_id (policies.sql), pra não repetir o join em cada
-- policy das tabelas abaixo, que só têm report_id.
create or replace function report_client_id(p_report_id uuid) returns uuid as $$
  select client_id from monthly_reports where id = p_report_id;
$$ language sql stable security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- report_kpi_values: resultado do mês de cada KPI configurado. O "resultado
-- do mês anterior" (Bloco 2) NUNCA é duplicado aqui — é lido buscando o
-- valor do relatório do mês anterior pro mesmo kpi_definition_id.
-- ---------------------------------------------------------------------------
create table if not exists report_kpi_values (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references monthly_reports (id) on delete cascade,
  kpi_definition_id uuid not null references client_kpi_definitions (id) on delete cascade,
  result numeric(14, 2),
  updated_at timestamptz not null default now(),
  unique (report_id, kpi_definition_id)
);

alter table report_kpi_values enable row level security;

create policy report_kpi_values_select on report_kpi_values
  for select using (auth.uid() is not null);

create policy report_kpi_values_write on report_kpi_values
  for all using (is_admin() or is_client_manager(report_client_id(report_id)))
  with check (is_admin() or is_client_manager(report_client_id(report_id)));

-- ---------------------------------------------------------------------------
-- report_timeline_events: Bloco 4, "Acontecimentos e decisões". Por enquanto
-- só alimentado manualmente ou pelo botão "Incluir no fechamento mensal" de
-- um comentário (source_comment_id) — outras origens automáticas (mudança
-- de orçamento, etc.) ficam preparadas pra uma etapa futura de automação,
-- não implementadas agora (seção 14 do pedido é explícita sobre isso).
-- ---------------------------------------------------------------------------
create table if not exists report_timeline_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references monthly_reports (id) on delete cascade,
  event_date date not null,
  type text not null default 'outro' check (type in (
    'orcamento', 'investimento', 'otimizacao', 'estrategia', 'teste_iniciado', 'teste_encerrado',
    'problema', 'reuniao', 'entrega_criativo', 'performance', 'comentario', 'outro'
  )),
  description text not null,
  responsible_id uuid references profiles (id) on delete set null,
  source_comment_id uuid references comments (id) on delete set null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists report_timeline_events_report_idx
  on report_timeline_events (report_id, event_date);
create index if not exists report_timeline_events_source_comment_idx
  on report_timeline_events (source_comment_id);

alter table report_timeline_events enable row level security;

create policy report_timeline_events_select on report_timeline_events
  for select using (auth.uid() is not null);

create policy report_timeline_events_write on report_timeline_events
  for all using (is_admin() or is_client_manager(report_client_id(report_id)))
  with check (is_admin() or is_client_manager(report_client_id(report_id)));

-- ---------------------------------------------------------------------------
-- report_comment_selections: quais comentários (de sprint) foram marcados
-- "incluir no fechamento mensal" — nunca duplica o texto do comentário,
-- só referencia `comments.id`.
-- ---------------------------------------------------------------------------
create table if not exists report_comment_selections (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references monthly_reports (id) on delete cascade,
  comment_id uuid not null references comments (id) on delete cascade,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (report_id, comment_id)
);

create index if not exists report_comment_selections_comment_idx
  on report_comment_selections (comment_id);

alter table report_comment_selections enable row level security;

create policy report_comment_selections_select on report_comment_selections
  for select using (auth.uid() is not null);

create policy report_comment_selections_write on report_comment_selections
  for all using (is_admin() or is_client_manager(report_client_id(report_id)))
  with check (is_admin() or is_client_manager(report_client_id(report_id)));

-- ---------------------------------------------------------------------------
-- report_action_items: Bloco 5, plano de ação estruturado. `sent_to_task_id`
-- registra a tarefa criada por "Enviar para próxima sprint" — impede reenvio
-- duplicado (a ação, ao rodar de novo, encontra isso preenchido e não cria
-- outra tarefa).
-- ---------------------------------------------------------------------------
create table if not exists report_action_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references monthly_reports (id) on delete cascade,
  description text not null,
  responsible_id uuid references profiles (id) on delete set null,
  due_date date,
  status text not null default 'pendente' check (status in ('pendente', 'em_andamento', 'concluido')),
  sent_to_task_id uuid references tasks (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists report_action_items_report_idx on report_action_items (report_id);

alter table report_action_items enable row level security;

create policy report_action_items_select on report_action_items
  for select using (auth.uid() is not null);

create policy report_action_items_write on report_action_items
  for all using (is_admin() or is_client_manager(report_client_id(report_id)))
  with check (is_admin() or is_client_manager(report_client_id(report_id)));
