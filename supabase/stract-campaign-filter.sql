-- Filtro de campanha no Import Service — nunca depende do provedor externo
-- (Stract) aplicar corretamente um filtro de campanha configurado na
-- extração (achado real: filtro configurado no Stract não excluiu as linhas
-- esperadas). Ambos os campos são opcionais; fonte sem os dois preenchidos
-- continua lendo todas as linhas da conta, exatamente como antes.
alter table import_sources
  add column if not exists campaign_name_column text,
  add column if not exists campaign_name_filter text;

comment on column import_sources.campaign_name_column is
  'Nome da coluna, na tabela de origem, que contém o nome da campanha. null = nenhum filtro de campanha aplicado (todas as linhas da conta contam).';
comment on column import_sources.campaign_name_filter is
  'Texto que precisa aparecer (contém, case-insensitive) no nome da campanha pra a linha ser considerada — aplicado pelo Import Service antes de qualquer agregação. Só usado junto de campaign_name_column; ambos null = sem filtro.';
