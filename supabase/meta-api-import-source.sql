-- Etapa "Gestão de Funis Estratégicos por Cliente" — preparação pro pipeline
-- n8n + API oficial da Meta (decisão do usuário, com orientação do mentor:
-- extração via n8n, MITZA continua Supabase + modelo interno de dados;
-- workflows do n8n NÃO fazem parte desta migration).
--
-- Adiciona 'meta_api' como um PROVIDER novo em import_sources — mesma
-- abstração que já distingue métodos de extração (hoje só 'stract'). Nunca
-- uma tabela nova: import_sources já é "identidade de uma integração
-- externa por cliente" (comentário original, stract-integration.sql) —
-- exatamente o que uma conta registrada pro n8n também é.
--
-- Diferença de forma de entrega: Stract expõe uma TABELA (lida via
-- table_name/account_id_column/date_column/spend_column, todos
-- configuráveis porque o nome das colunas varia por extração); n8n ENTREGA
-- via POST HTTP num endpoint próprio (`/api/n8n/meta-insights`), com um
-- contrato de campos FIXO (documentado em docs/N8N_META_INGESTION_GUIDE.md)
-- — por isso os 4 campos "*_column"/"table_name" de configuração Stract não
-- fazem sentido pra uma fonte 'meta_api' (não há tabela pra ler, nem nome de
-- coluna variável: o próprio endpoint já sabe os nomes fixos do contrato).
-- Viram NULLABLE (só continuam obrigatórios quando provider = 'stract',
-- reforçado pela constraint abaixo) — nunca um valor fictício preenchido só
-- pra satisfazer NOT NULL.
--
-- NÃO EXECUTAR sem aprovação — mesmo padrão de toda migration deste projeto
-- que altera schema já em produção.

alter table import_sources drop constraint if exists import_sources_provider_check;
alter table import_sources add constraint import_sources_provider_check check (provider in ('stract', 'meta_api'));

alter table import_sources alter column table_name drop not null;
alter table import_sources alter column account_id_column drop not null;
alter table import_sources alter column date_column drop not null;
alter table import_sources alter column spend_column drop not null;

alter table import_sources drop constraint if exists import_sources_stract_fields_required;
alter table import_sources add constraint import_sources_stract_fields_required check (
  provider <> 'stract'
  or (table_name is not null and account_id_column is not null and date_column is not null and spend_column is not null)
);

comment on column import_sources.table_name is
  'Nome da tabela física do Stract — só se aplica a provider = ''stract''. Null pra provider = ''meta_api'' (o endpoint de ingestão n8n não lê tabela nenhuma, recebe POST com contrato fixo).';
comment on column import_sources.account_id_column is
  'Nome da coluna de conta na tabela de origem do Stract — só provider = ''stract''. Null pra ''meta_api''.';
comment on column import_sources.date_column is
  'Nome da coluna de data na tabela de origem do Stract — só provider = ''stract''. Null pra ''meta_api'' (o contrato do endpoint sempre usa o campo fixo "date").';
comment on column import_sources.spend_column is
  'Nome da coluna de investimento na tabela de origem do Stract — só provider = ''stract''. Null pra ''meta_api'' (o contrato do endpoint sempre usa o campo fixo "spend").';

-- daily_performance.provider tem a mesma constraint isolada (rastreia de
-- onde veio cada linha de resultado, independente de import_sources) —
-- precisa do mesmo valor novo, senão o upsert de resultado do pipeline n8n
-- falharia na constraint.
alter table daily_performance drop constraint if exists daily_performance_provider_check;
alter table daily_performance add constraint daily_performance_provider_check check (provider in ('stract', 'meta_api'));

comment on table import_sources is
  'Identidade de uma integração externa por cliente ("como este cliente recebe dados") — nunca métrica/performance, isso é metric_mappings. Dois provedores possíveis hoje: ''stract'' (lê uma tabela física, nome/colunas configuráveis) e ''meta_api'' (recebe POST do pipeline n8n + API oficial da Meta, contrato de campos fixo — ver docs/N8N_META_INGESTION_GUIDE.md). external_account_id (act_...) é sempre a chave de relacionamento real, nunca table_name/nome de tabela.';
