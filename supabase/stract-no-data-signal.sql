-- Sinalização de conexão Stract sem dados novos — pedido explícito do
-- usuário: "se uma conexão do Stract falhar e não trouxer dados novos quero
-- que a plataforma sinalize isso". Hoje `import_sources.status`/
-- `data_sync_runs.status` existiam só no banco, sem NENHUMA tela lendo esses
-- campos — uma fonte podia parar de trazer dado novo (tabela de origem
-- vazia) e continuar marcada como "active"/"sincronizada agora" pra sempre
-- (`runImportForSource` bumpava `last_success_at` mesmo com 0 linhas lidas).
--
-- Novo status 'no_data', distinto de 'error': a leitura da fonte funcionou
-- (nenhuma exceção, nenhuma linha inválida), mas a tabela de origem inteira
-- veio vazia — só possível de acontecer numa releitura COMPLETA (o cron
-- nunca filtra por data, relê a janela inteira todo dia — ver
-- lib/stract-sync.ts), então nunca é confundido com "um dia sem gasto"
-- (isso é normal e não passa por aqui: haveria outras linhas históricas).
--
-- Rode depois de supabase/instagram-integration.sql.

alter table import_sources drop constraint if exists import_sources_status_check;
alter table import_sources add constraint import_sources_status_check
  check (status in ('pending', 'active', 'error', 'disabled', 'no_data'));

comment on column import_sources.status is
  'Saúde/configuração da FONTE, persiste entre execuções (pending = configurada mas nunca rodou, active = última releitura completa trouxe dado, error = última execução falhou, disabled = desligada deliberadamente, no_data = última releitura completa rodou sem erro mas voltou com a tabela de origem inteira vazia). Não confundir com data_sync_runs.status, que descreve UMA execução.';

alter table data_sync_runs drop constraint if exists data_sync_runs_status_check;
alter table data_sync_runs add constraint data_sync_runs_status_check
  check (status in ('running', 'success', 'partial', 'failed', 'empty'));

comment on column data_sync_runs.status is
  'Status de UMA rodada (running/success/partial/failed/empty), nunca a saúde persistente da fonte (isso é import_sources.status). partial = alguma parte falhou ou alguma linha foi ignorada por dado inválido. empty = a rodada não encontrou nenhuma exceção, mas a leitura da fonte voltou com zero linhas.';
