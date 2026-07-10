-- Etapa 31: origem do gasto real da sprint (manual x Meta API).
--
-- Hoje o "gasto real" nunca é uma coluna própria: é sempre a soma de
-- daily_spend dentro do intervalo da sprint (ver src/lib/sprint-financials.ts
-- e src/app/clients/[id]/page.tsx). Pra permitir edição manual enquanto a
-- sync do Meta não é a fonte real de testes, precisamos de um lugar pra
-- guardar esse valor manual e uma flag de qual fonte vale.
--
-- Não apaga nem migra dado nenhum: toda sprint existente nasce com
-- spend_source = 'meta_api' (comportamento idêntico ao atual — continua
-- somando daily_spend, como sempre foi) e manual_actual_spend nulo.

alter table sprints
  add column if not exists spend_source text not null default 'meta_api'
    check (spend_source in ('manual', 'meta_api')),
  add column if not exists manual_actual_spend numeric(12, 2);

-- Nenhuma mudança de RLS necessária: a policy "sprints_write" já é
-- admin-only (for all using (is_admin())) e cobre automaticamente as
-- colunas novas; "sprints_select" já cobre admin/gestor-do-cliente.
