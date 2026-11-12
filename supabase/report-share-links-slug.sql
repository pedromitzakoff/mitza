-- Etapa "Link legível por cliente" (pedido explícito do usuário: "tem como
-- o link de cada cliente de dash ter o nome dele ao invés desse código
-- estranho?"): `report_share_links` passa a guardar também um `slug`
-- legível (derivado do nome do cliente, ex.: "Danielle Saqui" ->
-- "DanielleSaqui") — decisão consciente de trade-off de segurança,
-- explicitamente aceita pelo usuário: o nome do cliente deixa de ser
-- imprevisível (ao contrário do token aleatório de 256 bits), então
-- `/r/DanielleSaqui` só é seguro contra adivinhação/enumeração NO
-- CONTEXTO desta agência (sem perfil público, clientes não divulgados) —
-- nunca para uma agência cujos clientes são conhecidos/pesquisáveis.
--
-- `/r/[token]` passa a resolver primeiro por slug, depois por hash do
-- token (`lib/report-share-links.ts`, `resolveClientIdFromShareSlug` antes
-- de `resolveClientIdFromShareToken`) — links já enviados com o token
-- antigo continuam funcionando exatamente como antes (coluna/índice de
-- hash intocados); só um link GERADO DE NOVO (rotacionado) ganha slug.
--
-- Rode depois de supabase/report-share-links-store-token.sql.

alter table report_share_links add column if not exists slug text;

-- Único entre links ATIVOS (mesmo critério do índice por client_id abaixo)
-- — um slug revogado pode ser reutilizado por um link novo (do mesmo
-- cliente rotacionando, ou até de outro, depois do nome mudar), nunca trava
-- pra sempre.
create unique index if not exists report_share_links_active_slug_key
  on report_share_links (slug) where revoked_at is null and slug is not null;

comment on column report_share_links.slug is
  'Identificador legível do link público (ex.: "DanielleSaqui", derivado do nome do cliente) — Etapa "Link legível por cliente". `null` pra link gerado antes desta etapa (continua resolvendo só pelo token antigo, `/r/{token}`) ou na rara corrida em que a geração de slug falhou (nunca bloqueia a criação do link em si). Resolução de `/r/[token]` tenta este campo PRIMEIRO (busca indexada exata), cai pro hash do token só se não achar — nunca os dois caminhos usados pro mesmo link ao mesmo tempo, exceto o período de transição em que o link antigo (sem slug) ainda está ativo.';
