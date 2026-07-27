-- Filtro de exclusão de campanha no Import Service — complementa
-- campaign_name_filter (inclusão). Achado real ao conectar a Vaapty SBC: a
-- conta mistura campanhas de RH/recrutamento ("RH | Vendedor", "RH | SDR")
-- sem nenhum texto em comum com as campanhas legítimas de marketing
-- (ENGA/VEND/FORM/LEAD) — "incluir só quem contém X" não resolve, mas
-- "excluir quem contém X" resolve.
alter table import_sources
  add column if not exists campaign_name_exclude text;

comment on column import_sources.campaign_name_exclude is
  'Texto que, se aparecer (contém, case-insensitive) no nome da campanha, exclui a linha da agregação — aplicado pelo Import Service independentemente de campaign_name_filter. Só usado junto de campaign_name_column; null = nenhuma exclusão.';
