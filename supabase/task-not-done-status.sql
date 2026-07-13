-- Adiciona o status "não realizado" a tasks — necessário pra reuniões e
-- entregas de criativo terem um terceiro estado terminal distinto de
-- "feito" (que hoje é o único jeito de "resolver" uma tarefa). Sem isso,
-- uma reunião que não aconteceu fica presa como "atrasado" pra sempre, sem
-- nenhum jeito de registrar formalmente "não realizada" com data de
-- confirmação e responsável.
--
-- NÃO EXECUTAR sem aprovação — ver relatório de entrega desta etapa.
--
-- Não apaga nem altera nenhuma linha existente: `nao_realizado` só passa a
-- ser um valor válido a mais; toda tarefa já existente continua com seu
-- status atual. `resolved_at` é nullable, sem default retroativo — tarefas
-- já concluídas antes desta migration continuam com `resolved_at` nulo
-- (mesmo padrão já usado por `completed_at` quando foi adicionado).

alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check
  check (status in ('pendente', 'feito', 'atrasado', 'nao_realizado'));

alter table tasks add column if not exists resolved_at timestamptz;

-- ---------------------------------------------------------------------------
-- mark_task_not_done_and_record_event: espelha exatamente
-- complete_task_and_record_event (mesma transação atômica, mesmo padrão de
-- idempotency_key, mesmo cálculo de atraso) — a única diferença é o status
-- final ('nao_realizado' em vez de 'feito') e o evento emitido
-- (meeting_cancelled/creative_delivery_late em vez de
-- meeting_completed/creative_delivery_completed). Nunca escreve em
-- completed_at (reservado exclusivamente pra conclusões reais — o indicador
-- "Tarefas concluídas" da Visão Geral conta por completed_at; contá-lo aqui
-- também inflaria esse indicador com tarefas que não foram concluídas).
--
-- Reaproveita os tipos de evento MEETING_CANCELLED/CREATIVE_DELIVERY_LATE,
-- já reservados na taxonomia de operational_events (lib/operational-events.ts)
-- mas nunca emitidos até agora — não introduz nenhum tipo de evento novo.
-- ---------------------------------------------------------------------------
create or replace function mark_task_not_done_and_record_event(
  p_task_id uuid,
  p_actor_team_member_id uuid,
  p_actor_auth_user_id uuid,
  p_source text default 'web'
) returns jsonb as $$
declare
  v_task tasks%rowtype;
  v_now timestamptz := now();
  v_due_end timestamptz;
  v_was_on_time boolean;
  v_delay_seconds integer;
  v_org_id uuid;
  v_type_event text;
begin
  select * into v_task from tasks where id = p_task_id for update;
  if v_task.id is null then
    raise exception 'Tarefa não encontrada';
  end if;

  if v_task.type not in ('reuniao', 'entrega_criativo') then
    raise exception 'Só reuniões e entregas de criativo podem ser marcadas como não realizadas por este fluxo';
  end if;

  select organization_id into v_org_id from team_members where id = p_actor_team_member_id;

  v_due_end := ((v_task.due_date + 1)::timestamp at time zone 'America/Sao_Paulo');
  v_was_on_time := v_now <= v_due_end;
  v_delay_seconds := greatest(0, extract(epoch from (v_now - v_due_end)))::int;

  update tasks
  set status = 'nao_realizado', resolved_at = v_now
  where id = p_task_id;

  v_type_event := case v_task.type
    when 'reuniao' then 'meeting_cancelled'
    when 'entrega_criativo' then 'creative_delivery_late'
  end;

  insert into operational_events (
    organization_id, event_type, actor_team_member_id, actor_auth_user_id,
    client_id, sprint_id, entity_type, entity_id, occurred_at, expected_at, completed_at,
    was_on_time, delay_seconds, source, idempotency_key, metadata
  ) values (
    v_org_id, v_type_event, p_actor_team_member_id, p_actor_auth_user_id,
    v_task.client_id, v_task.sprint_id, 'task', v_task.id, v_now, v_due_end, v_now,
    v_was_on_time, v_delay_seconds, p_source,
    v_type_event || ':' || v_task.id::text || ':' || v_now::text,
    jsonb_build_object(
      'task_title', v_task.title,
      'due_date', v_task.due_date,
      'assignee_team_member_id', v_task.assignee_id
    )
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  return jsonb_build_object('status', 'nao_realizado', 'resolvedAt', v_now);
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Taxonomia de operational_events: nenhum tipo novo — meeting_cancelled e
-- creative_delivery_late já estavam na constraint (reservados, nunca
-- emitidos). Nenhuma alteração de constraint necessária aqui.
-- ---------------------------------------------------------------------------
