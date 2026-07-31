-- AnalyticsReport Fase 1: tema visual do relatório.
--
-- O tema pertence ao domínio do cliente (não é uma preferência de sessão nem
-- do gerador de PDF), por isso vive em `clients` mesmo sem UI de seleção
-- ainda — hoje todo cliente nasce "mitza" e o renderer nunca deve escolher
-- o tema por conta própria.

alter table clients
  add column if not exists report_theme text not null default 'mitza'
    check (report_theme in ('mitza', 'white_label'));

-- Nenhuma mudança de RLS necessária: a policy de leitura/escrita de `clients`
-- já cobre a coluna nova automaticamente.
