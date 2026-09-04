-- Etapa "Link Externo V1": armazenamento dos links compartilháveis do
-- Performance Report (`/r/[token]`) — cada linha vincula um token a
-- EXATAMENTE um client_id. O token bruto NUNCA é persistido: só um hash
-- sha256 (hex) para comparação, gerado/entregue uma única vez no momento da
-- criação (`lib/report-share-links.ts`).
--
-- Sem NENHUMA policy de RLS (nem para `anon` nem para `authenticated`) —
-- deliberado, nunca `using (true)`: esta tabela só é lida/gravada por código
-- de servidor de confiança via `createAdminClient()` (service role, ignora
-- RLS), depois de decidir sozinho quem pode agir (admin-only nas Server
-- Actions de gerar/revogar; resolução do token em `/r/[token]` não depende
-- de nenhuma sessão). Nenhum client Supabase do browser jamais consulta esta
-- tabela — RLS habilitada só como cinto-e-suspensório caso algum caminho
-- futuro use um client comum por engano.
create table if not exists report_share_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Unicidade do hash: colisão de um token de 256 bits é praticamente
-- impossível, mas o índice único também é o que torna a busca por token em
-- `/r/[token]` uma leitura indexada direta.
create unique index if not exists report_share_links_token_hash_key on report_share_links (token_hash);

-- Suporta tanto "existe link ativo deste cliente?" (painel "Link do
-- cliente") quanto a revogação em massa ao rotacionar.
create index if not exists report_share_links_client_id_idx on report_share_links (client_id) where revoked_at is null;

alter table report_share_links enable row level security;

comment on table report_share_links is
  'V1 do link externo seguro do Performance Report (/r/[token]) — cada linha vincula um token (só o hash é armazenado) a exatamente um client_id. Sem nenhuma policy de RLS: leitura/escrita só via createAdminClient() (service role), nunca a partir de um client do browser.';
comment on column report_share_links.token_hash is
  'sha256 hex do token bruto entregue ao usuário uma única vez no momento da geração (lib/report-share-links.ts) — o valor original nunca é persistido e não é recuperável depois.';
comment on column report_share_links.revoked_at is
  'not null = link revogado. /r/[token] trata um token revogado exatamente como um token inexistente (resposta neutra — nunca revela se o client_id existe).';
