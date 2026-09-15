-- Etapa "Simplificação do Cadastro do Cliente" — `meta_ad_account_id` deixa
-- de ser obrigatório pra TODO cliente. Até aqui a coluna era `not null`
-- desde o schema original (`schema.sql`), então mesmo um cliente Google-only
-- precisava inventar uma conta Meta só pra passar no cadastro — incoerência
-- que a auditoria desta etapa confirmou (ver `clients.media_channels`,
-- `client-media-channels.sql`: Meta é hoje só UM dos canais possíveis, não
-- mais garantido pra todo cliente).
--
-- Nenhuma linha existente é afetada por este relaxamento: a constraint
-- `not null` nunca permitiu um valor nulo até hoje (confirmado no comentário
-- de `client-media-channels.sql`, linha 12-14 — "todo cliente cadastrado,
-- sem exceção, sempre teve conta Meta configurada"), então não há nenhum
-- backfill necessário. Só muda o que passa a ser ACEITO daqui pra frente.
--
-- A obrigatoriedade CONDICIONAL ("se `media_channels` inclui 'meta', a
-- conta precisa estar configurada") fica só na aplicação
-- (`createClientAction`/`updateClientAction`, `src/app/clients/actions.ts`)
-- — mesmo padrão já usado pra "media_channels precisa ter pelo menos 1
-- canal", nunca uma constraint SQL condicional a outra coluna (mais frágil
-- e mais difícil de dar uma mensagem de erro legível ao usuário).

alter table clients alter column meta_ad_account_id drop not null;

-- O check de formato (`act_` + dígitos) continua existindo, só passa a
-- aceitar `null` também — um valor PREENCHIDO continua tendo que respeitar
-- o formato de sempre, nunca um texto livre.
alter table clients drop constraint if exists clients_meta_ad_account_id_check;
alter table clients add constraint clients_meta_ad_account_id_check
  check (meta_ad_account_id is null or meta_ad_account_id ~ '^act_[0-9]+$');
