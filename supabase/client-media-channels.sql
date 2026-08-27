-- Etapa "Canais Ativos por Cliente" — fonte única de verdade de "em quais
-- plataformas este cliente investe" (`clients.media_channels`). Nunca
-- confundir com `import_sources.enabled` (só diz se há sincronização
-- AUTOMÁTICA configurada — um cliente com lançamento manual pode não ter
-- nenhuma linha lá) nem com presença de `daily_spend`/`daily_performance`
-- num mês (um canal configurado sem investimento neste mês continua sendo
-- um canal configurado — ver `resolveSelectedChannelScope`,
-- src/lib/traffic-channels.ts).
--
-- Auditoria feita antes desta migration (ver relatório completo na
-- conversa): não existe hoje nenhum campo em `clients` que já represente
-- isso. `meta_ad_account_id` é `not null` desde o schema ORIGINAL — todo
-- cliente cadastrado, sem exceção, sempre teve conta Meta configurada. Não
-- existe equivalente obrigatório pro Google.

alter table clients add column if not exists media_channels text[];

-- ---------------------------------------------------------------------------
-- PRÉ-CHECAGEM (rode ANTES do UPDATE abaixo pra conferir a distribuição
-- antes de aplicar em produção — nenhuma linha é alterada por esta query):
--
-- select
--   count(*) filter (where google_signal) as meta_e_google,
--   count(*) filter (where not google_signal) as so_meta,
--   count(*) as total
-- from (
--   select
--     c.id,
--     exists (
--       select 1 from import_sources i
--       where i.client_id = c.id and i.channel = 'google' and i.enabled = true
--     ) or exists (
--       select 1 from monthly_budget_changes b
--       where b.client_id = c.id and b.channel = 'google'
--     ) as google_signal
--   from clients c
--   where c.deleted_at is null
-- ) t;
--
-- Se o número de "meta_e_google" parecer baixo demais (Google configurado
-- de um jeito que não passa por import_sources nem por
-- monthly_budget_changes — ex.: só via lançamento manual em
-- performance_records sem nunca ter tido um plano de canal criado), SINALIZE
-- antes de aplicar: pode haver clientes Google reais que este backfill
-- classificaria erroneamente como "só Meta". Nesse caso, gere a lista de
-- exceções manualmente (join com `performance_records`/`daily_performance`
-- filtrando `channel = 'google'` OU pergunte ao time operacional) e
-- corrija-os com um UPDATE pontual depois desta migration, nunca alterando
-- a regra abaixo pra "inferir por dado de um mês" (é exatamente o que a
-- Etapa pediu pra evitar).
-- ---------------------------------------------------------------------------

-- Backfill: Meta é garantido pra TODO cliente existente (constraint
-- `not null` da coluna original, nunca foi opcional). Google só entra
-- quando há um sinal de CONFIGURAÇÃO real — nunca a presença/ausência de
-- dado de um mês isolado:
--   (a) import_sources.enabled = true pro canal 'google' (integração
--       automática ligada, em qualquer momento da história, não só hoje);
--   (b) OU pelo menos um monthly_budget_changes já criado pro canal
--       'google', em qualquer mês (alguém deliberadamente configurou um
--       plano de investimento pra esse canal — evento administrativo, não
--       dado orgânico de sincronização).
--
-- `guard_client_manager_update()` (manager-edit-clients.sql) bloqueia
-- update em qualquer coluna de `clients` fora de `primary_manager_id`/
-- `wallet_position` quando não há contexto de admin/gestor autenticado
-- (`auth.uid()`) — que é exatamente o caso rodando esta migration pelo SQL
-- Editor. `agency-wallet-position.sql` nunca bateu nisso por só tocar uma
-- das 2 colunas isentas; esta migration toca `media_channels`, que não é
-- isenta, então o gatilho precisa ser desligado só durante este UPDATE
-- (nunca permanentemente — religa logo em seguida, dentro da mesma
-- transação: se algo falhar no meio, tudo desfaz junto, o gatilho nunca
-- fica desligado de verdade).
begin;

alter table clients disable trigger clients_guard_manager_update;

update clients c
set media_channels = array_remove(
  array[
    'meta',
    case
      when exists (
        select 1 from import_sources i
        where i.client_id = c.id and i.channel = 'google' and i.enabled = true
      ) or exists (
        select 1 from monthly_budget_changes b
        where b.client_id = c.id and b.channel = 'google'
      ) then 'google'
    end
  ],
  null
)
where media_channels is null;

alter table clients enable trigger clients_guard_manager_update;

commit;

alter table clients alter column media_channels set default array['meta']::text[];
alter table clients alter column media_channels set not null;

alter table clients drop constraint if exists clients_media_channels_valid;
alter table clients add constraint clients_media_channels_valid
  check (media_channels <@ array['meta', 'google']::text[]);

alter table clients drop constraint if exists clients_media_channels_not_empty;
alter table clients add constraint clients_media_channels_not_empty
  check (cardinality(media_channels) >= 1);
