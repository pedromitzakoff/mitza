-- Etapa "Configuração inteligente de métricas por cliente" — corrige um bug
-- real encontrado na auditoria (B1): existiam DUAS gravações independentes
-- do "objetivo principal" de um cliente, que nunca se sincronizavam entre
-- si:
--   1. `updateClientPerformanceGoalAction` (seletor rápido, toolbar da
--      Sprint) — escrevia só em `clients.performance_goal`.
--   2. `setClientGoalPrimaryAction` → RPC `set_client_goal_primary`
--      (botão "Definir como principal", em "Objetivos da conta") — escrevia
--      só em `client_goals.is_primary`.
-- Um gestor usando os dois seletores em momentos diferentes podia deixar
-- `clients.performance_goal` e o objetivo marcado como principal em
-- `client_goals` apontando pra coisas diferentes — o Dashboard (que lê
-- `clients.performance_goal`) podia mostrar um objetivo diferente do que o
-- card "Objetivos da conta" dizia ser o principal.
--
-- Solução: uma única função, chamada pelos DOIS caminhos de entrada —
-- nenhuma das duas tabelas é escrita fora dela daqui pra frente. Uma função
-- PL/pgSQL inteira já roda numa única transação implícita do Postgres (não
-- precisa de BEGIN/COMMIT explícito na aplicação).
--
-- Reaproveita 100% do que já existe: a MESMA tabela `client_goals` (nunca um
-- sistema de configuração paralelo), o MESMO índice único parcial
-- (`client_goals_one_primary_per_client`) como rede de segurança.
-- `set_client_goal_primary` (a função antiga) é mantida — outra chamada
-- direta a ela nunca mais deveria existir no código da aplicação após esta
-- etapa, mas removê-la do banco não é necessário nem seguro (poderia haver
-- uso externo/script não migrado).
--
-- Depende da migração `performance-goal-conversations-registrations.sql`
-- pra aceitar 'conversations'/'registrations' — se esta rodar ANTES
-- daquela, a função funciona normalmente pros 3 objetivos já existentes e
-- só passa a aceitar os 2 novos depois que a outra migração também rodar
-- (nunca um erro silencioso: `raise exception` deixa claro qual valor foi
-- rejeitado).
--
-- NÃO EXECUTAR sem aprovação — mesmo padrão de toda migration deste projeto
-- que altera schema já em produção.

create or replace function set_client_primary_performance_goal(
  p_client_id uuid,
  p_result_type text
) returns void as $$
begin
  if p_result_type not in ('leads', 'sales', 'followers', 'conversations', 'registrations') then
    raise exception 'Objetivo inválido: %', p_result_type;
  end if;

  -- Rebaixa qualquer outro objetivo que estivesse marcado como principal —
  -- SEMPRE antes de promover o novo (ver nota abaixo), nunca passa por um
  -- estado com 2 simultâneos (mesma garantia de `set_client_goal_primary`,
  -- agora reaproveitada aqui também).
  --
  -- Ordem importa de verdade, não é só estilo: `client_goals_one_primary_
  -- per_client` é um índice único NÃO adiável — Postgres checa a violação
  -- ao FINAL de cada statement, não da transação inteira. Promover o novo
  -- objetivo primeiro (is_primary = true) enquanto o antigo ainda está
  -- true faria duas linhas true ao mesmo tempo nesse instante — violação
  -- imediata, a função inteira falharia. Rebaixar primeiro garante que
  -- nunca existe mais de uma linha true, em nenhum ponto da execução.
  update client_goals set is_primary = false
  where client_id = p_client_id and result_type <> p_result_type and is_primary;

  -- Cria o objetivo em `client_goals` se o cliente ainda não o tinha (caso
  -- comum: cliente "simples", nunca passou pela tela "Objetivos da conta",
  -- só tem `clients.performance_goal` configurado) — nasce sem restrição de
  -- canal (mesma convenção de sempre) e fonte automática. Se já existia,
  -- só promove a principal — nunca sobrescreve `channels`/`result_source`
  -- de um objetivo já configurado manualmente.
  insert into client_goals (client_id, result_type, channels, is_primary, result_source)
  values (p_client_id, p_result_type, '{}', true, 'automatic')
  on conflict (client_id, result_type) do update set is_primary = true;

  -- Mantém a coluna legada em sincronia — consumidores ainda não migrados
  -- pra múltiplos objetivos (Dashboard, Relatório, Exploração, Metas) leem
  -- `clients.performance_goal` diretamente; nunca mais diverge de
  -- `client_goals.is_primary`.
  update clients set performance_goal = p_result_type where id = p_client_id;
end;
$$ language plpgsql;

comment on function set_client_primary_performance_goal is
  'Único ponto de escrita do objetivo PRINCIPAL de um cliente (Etapa "Configuração inteligente de métricas por cliente", corrige bug B1) — atualiza client_goals.is_primary e clients.performance_goal na MESMA transação. Substitui as duas gravações independentes que existiam antes (set_client_goal_primary sozinha + UPDATE direto em clients.performance_goal); set_client_goal_primary continua existindo no banco por compatibilidade, mas nenhum código da aplicação deveria chamá-la diretamente depois desta etapa.';
