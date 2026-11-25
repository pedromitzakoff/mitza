-- Etapa "Conexão Google Ads" — base de schema para a integração com o
-- Google Ads, seguindo EXATAMENTE o mesmo padrão já usado pela Meta:
--
-- 1. `clients.google_ads_customer_id` — a conta de anúncios em si
--    (cadastro), mesmo papel de `clients.meta_ad_account_id`: um campo de
--    identidade/sugestão preenchido no Cadastro do Cliente, condicional a
--    "google" estar em `media_channels` (já suportado — `media_channels`
--    aceita 'google' desde `client-media-channels.sql`). Formato: Customer
--    ID do Google Ads, sempre 10 dígitos, sem hífen (a UI do Google mostra
--    "123-456-7890", mas a API sempre usa só os dígitos).
-- 2. `import_sources.provider = 'google_ads'` — novo provedor, mesma
--    abstração que já distingue 'stract'/'meta_api' ("como este cliente
--    recebe dados"). `channel = 'google'` já é um valor aceito em
--    `import_sources` desde sempre (`stract-integration.sql`) — nenhuma
--    mudança necessária aí.
-- 3. `daily_performance.provider` precisa do mesmo valor novo, pela mesma
--    razão que ganhou 'meta_api' em `meta-api-import-source.sql`: o
--    upsert de resultado do pipeline Google Ads usaria esse provider.
--
-- Os campos "*_column"/"table_name" de `import_sources` (specíficos do
-- Stract) já são nullable desde `meta-api-import-source.sql` e a
-- constraint `import_sources_stract_fields_required` já só exige esses
-- campos quando `provider = 'stract'` — nenhuma mudança adicional
-- necessária pra 'google_ads' se encaixar no mesmo molde que 'meta_api'
-- já usa.
--
-- NÃO EXECUTAR sem aprovação — mesmo padrão de toda migration deste
-- projeto que altera schema já em produção.

alter table clients add column if not exists google_ads_customer_id text;

alter table clients drop constraint if exists clients_google_ads_customer_id_check;
alter table clients add constraint clients_google_ads_customer_id_check
  check (google_ads_customer_id is null or google_ads_customer_id ~ '^[0-9]{10}$');

comment on column clients.google_ads_customer_id is
  'Customer ID do Google Ads (10 dígitos, sem hífen) — mesmo papel de meta_ad_account_id: identidade/sugestão no Cadastro do Cliente, obrigatória condicionalmente quando "google" está em media_channels (validado na aplicação, nunca aqui — mesmo padrão de validateMetaAccountRequirement). A conta precisa já estar vinculada à conta Gerenciadora (MCC) da Mitza fora do sistema antes de qualquer sincronização funcionar.';

alter table import_sources drop constraint if exists import_sources_provider_check;
alter table import_sources add constraint import_sources_provider_check check (provider in ('stract', 'meta_api', 'google_ads'));

alter table daily_performance drop constraint if exists daily_performance_provider_check;
alter table daily_performance add constraint daily_performance_provider_check check (provider in ('stract', 'meta_api', 'google_ads'));
