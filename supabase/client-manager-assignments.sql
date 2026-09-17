-- Etapa "Equipe — Fase 2: Histórico Temporal de Responsabilidade" — hoje
-- `clients.primary_manager_id` representa só "quem é responsável AGORA".
-- Este arquivo cria `client_manager_assignments`, a fonte canônica pra
-- responder "quem era responsável por este cliente NUMA DATA" — sem
-- reconstruir nem inventar o passado (ver decisão de backfill embaixo).
--
-- AUDITORIA (feita antes de escrever este arquivo — ver relatório da
-- etapa): existem exatamente 3 caminhos de aplicação que escrevem em
-- `clients.primary_manager_id` hoje —
--   1. `createClientAction`/`updateClientAction` (src/app/clients/actions.ts)
--   2. `updateClientPrimaryManagerAction` (src/app/settings/clients/actions.ts)
--   3. `moveClientAction` (src/app/agency-accounts-tree-actions.ts, drag-and-drop
--      da árvore "Contas da Agência")
-- Coordenar histórico nesses 3 pontos (cada um reescrevendo a mesma lógica
-- de abrir/fechar período) duplicaria regra e arriscaria os 3 divergirem
-- ao longo do tempo. Em vez disso, um TRIGGER em `clients` (abaixo) deriva
-- o histórico automaticamente de QUALQUER escrita em `primary_manager_id`,
-- por QUALQUER um dos 3 caminhos — nenhum dos três precisa saber que este
-- histórico existe, nenhuma duplicação de regra, e a integridade
-- (nunca dois gestores abertos pro mesmo cliente) fica garantida no nível
-- mais atômico possível (mesma transação da própria escrita).
--
-- `client_manager_assigned`/`client_manager_changed` (`operational_events`,
-- Etapa 56) continuam existindo, intocados — servem Timeline/auditoria
-- humana (quem clicou o quê, quando, com que metadata de origem) e têm
-- cobertura PARCIAL (só a partir de quando passaram a ser emitidos). Esta
-- tabela nova é a fonte estruturada e completa (a partir do deploy desta
-- etapa) pra perguntas temporais — os dois conceitos continuam
-- deliberadamente separados (ver relatório da etapa, seção "Integração com
-- eventos existentes").
--
-- Rode depois de supabase/team-members.sql e supabase/manager-move-clients-tree.sql.

-- ---------------------------------------------------------------------------
-- client_manager_assignments: um período por linha. `ended_at is null` =
-- período ainda aberto (o gestor ATUAL daquele cliente, nesse momento).
-- Meio-aberto por convenção ([started_at, ended_at)) — no instante exato
-- da troca, o período antigo termina e o novo começa no MESMO timestamp
-- (mesma transação, `now()` é estável dentro dela), sem gap nem overlap.
-- ---------------------------------------------------------------------------
create table if not exists client_manager_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  -- `on delete set null` (nunca cascade/restrict) — mesmo padrão de TODO
  -- outro FK pra `team_members` neste schema (tasks.assignee_id,
  -- comments.author_id, clients.primary_manager_id, etc., ver
  -- supabase/team-members.sql): se um membro for excluído definitivamente
  -- (`team_member_deleted`), o PERÍODO em si nunca é perdido — só perde a
  -- identidade de quem foi. Nunca acontece pra uma linha recém-criada.
  manager_id uuid references team_members (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

-- Regra de integridade PRINCIPAL (seção 3 do pedido): nunca dois períodos
-- abertos pro mesmo cliente — índice único parcial, a forma idiomática do
-- Postgres de expressar "no máximo 1 linha em aberto por cliente" sem
-- precisar de lock explícito ou de uma constraint de exclusão (que exigiria
-- a extensão btree_gist só pra isso). Como a ÚNICA escrita legítima nesta
-- tabela é o trigger abaixo (nunca um insert solto de aplicação — ver
-- policies no fim do arquivo), overlap entre períodos FECHADOS do mesmo
-- cliente também nunca acontece por construção: o trigger sempre fecha o
-- período aberto antes (ou no mesmo instante) de abrir o próximo, na MESMA
-- transação — nunca precisou de uma constraint de exclusão por range pra
-- garantir isso.
create unique index if not exists client_manager_assignments_open_unique
  on client_manager_assignments (client_id)
  where ended_at is null;

create index if not exists client_manager_assignments_client_idx
  on client_manager_assignments (client_id, started_at desc);

create index if not exists client_manager_assignments_manager_idx
  on client_manager_assignments (manager_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Trigger: deriva o histórico de QUALQUER escrita em
-- `clients.primary_manager_id` — insert (cliente criado já com gestor) e
-- update (troca, remoção, nova atribuição) pela MESMA função, ramificada por
-- `tg_op`. `security definer` (mesmo padrão de `guard_client_manager_update`,
-- `record_account_review` etc. neste schema) — roda com o privilégio do
-- dono da função, nunca do usuário logado, então funciona idêntico pra
-- admin ou gestor comum (RLS de `client_manager_assignments`, abaixo, nunca
-- entra no caminho de quem já pode escrever em `clients.primary_manager_id`
-- pelas policies existentes).
-- ---------------------------------------------------------------------------
create or replace function sync_client_manager_assignment() returns trigger as $$
declare
  v_org_id uuid;
begin
  if tg_op = 'INSERT' then
    if new.primary_manager_id is not null then
      select organization_id into v_org_id from team_members where id = new.primary_manager_id;
      insert into client_manager_assignments (organization_id, client_id, manager_id, started_at)
      values (v_org_id, new.id, new.primary_manager_id, now());
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE' — só reage quando a coluna de fato mudou (reordenar a
  -- árvore sem trocar de gestor, por exemplo, grava wallet_position sem
  -- tocar primary_manager_id: `is distinct from` cobre null corretamente e
  -- evita abrir/fechar período nenhum nesse caso).
  if new.primary_manager_id is distinct from old.primary_manager_id then
    if old.primary_manager_id is not null then
      -- Encerra o período aberto do gestor ANTERIOR — "remover o gestor
      -- deve encerrar o período atual" e "ao trocar, o período anterior
      -- deve ser encerrado" (seção 3 do pedido), na MESMA transação da
      -- escrita em `clients`.
      update client_manager_assignments
      set ended_at = now()
      where client_id = old.id and manager_id = old.primary_manager_id and ended_at is null;
    end if;

    if new.primary_manager_id is not null then
      -- Abre um período novo pro gestor NOVO — "um novo período deve ser
      -- criado" / "atribuir novamente deve iniciar um novo período".
      select organization_id into v_org_id from team_members where id = new.primary_manager_id;
      insert into client_manager_assignments (organization_id, client_id, manager_id, started_at)
      values (v_org_id, new.id, new.primary_manager_id, now());
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists clients_sync_manager_assignment_insert on clients;
create trigger clients_sync_manager_assignment_insert
  after insert on clients
  for each row execute function sync_client_manager_assignment();

drop trigger if exists clients_sync_manager_assignment_update on clients;
create trigger clients_sync_manager_assignment_update
  after update on clients
  for each row execute function sync_client_manager_assignment();

-- ---------------------------------------------------------------------------
-- RLS: leitura aberta a qualquer membro interno ativo da mesma organização
-- (mesma regra de `team_members`/`clients` — "não é uma área de RH", ver
-- Fase 1). NENHUMA policy de insert/update/delete pra ninguém, nem admin:
-- a ÚNICA escrita legítima é o trigger acima (`security definer`, ignora
-- RLS por rodar com o privilégio do dono da função) — qualquer tentativa
-- de escrever aqui diretamente (inclusive por engano, num script futuro)
-- é negada pela ausência de policy, nunca uma corrida entre uma escrita
-- manual e o trigger.
-- ---------------------------------------------------------------------------
alter table client_manager_assignments enable row level security;

create policy client_manager_assignments_select on client_manager_assignments
  for select using (organization_id = current_organization_id());

-- ---------------------------------------------------------------------------
-- Backfill (seção 4 do pedido — "NÃO inventar histórico"): decisão
-- explícita. Não sabemos, com confiança, DESDE QUANDO o gestor ATUAL de
-- cada cliente existente é responsável por ele — só sabemos que é ele
-- AGORA. `client_manager_assigned`/`client_manager_changed`
-- (`operational_events`) têm cobertura PARCIAL (só emitidos a partir da
-- Etapa 56) — usá-los pra alguns clientes e "agora" pra outros produziria
-- uma linha do tempo com confiabilidade INCONSISTENTE e sem sinalização
-- visível de qual é qual, mais confusa do que útil.
--
-- Estratégia escolhida (uniforme e honesta): todo cliente com
-- `primary_manager_id` preenchido no momento em que esta migration roda
-- ganha exatamente 1 período ABERTO, com `started_at = now()` — o instante
-- do deploy desta etapa, nunca uma data anterior inventada. A partir daqui,
-- a timeline é 100% real; antes daqui, ela simplesmente não existe (e a
-- aplicação nunca afirma o contrário — ver `lib/client-manager-assignments.ts`).
-- Roda pra QUALQUER cliente com gestor (inclusive pausado/excluído/
-- encerrado) — o filtro de "carteira ativa" é responsabilidade de quem
-- CONSOME o histórico, nunca desta tabela.
-- ---------------------------------------------------------------------------
insert into client_manager_assignments (organization_id, client_id, manager_id, started_at)
select tm.organization_id, c.id, c.primary_manager_id, now()
from clients c
join team_members tm on tm.id = c.primary_manager_id
where c.primary_manager_id is not null
  and not exists (
    select 1 from client_manager_assignments cma where cma.client_id = c.id and cma.ended_at is null
  );
