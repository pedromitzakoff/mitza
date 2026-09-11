import { randomBytes, createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Etapa "Link Externo V1" — núcleo do token do link compartilhável do
 * Performance Report (`/r/[token]`).
 *
 * Token = 32 bytes (256 bits) de `crypto.randomBytes`, codificado em
 * base64url — criptograficamente aleatório, impossível de adivinhar por
 * força bruta.
 *
 * Etapa "Link Externo — token recuperável" (pedido explícito do usuário,
 * decisão consciente de trade-off de segurança): o token BRUTO agora
 * também é persistido (`report_share_links.token`, ver
 * `supabase/report-share-links-store-token.sql`), ao lado do hash de
 * sempre (`token_hash`, sha256 hex) — que continua existindo e é quem
 * resolve `/r/[token]` (busca indexada por hash, nunca pelo valor bruto).
 * Antes desta etapa o token só existia uma única vez, na tela, no momento
 * da geração — perdê-lo ali obrigava a gerar um novo (revogando o
 * anterior). Isso mudou porque o Relatório de Performance é só leitura
 * (nada editável, nenhum dado além do que o relatório já mostra pro
 * gestor) — o risco de guardar o token recuperável é menor do que o
 * incômodo operacional de nunca poder reexibi-lo. Quem tem acesso a esta
 * tabela (só `createAdminClient()`, nunca um client do browser) passa a
 * conseguir ver o link de qualquer cliente — aceito deliberadamente, não
 * um descuido.
 *
 * `ReportShareLinkStore` isola toda leitura/escrita em `report_share_links`/
 * `clients` — mesma razão de `RateLimitBackend` em `lib/rate-limit.ts`: este
 * ambiente de teste não tem Supabase real, então a lógica de
 * autorização (qual token resolve pra qual cliente, revogado nunca resolve,
 * cliente excluído nunca resolve) precisa ser testável injetando um store em
 * memória (`__setReportShareLinkStoreForTests`), sem tocar rede/banco real.
 * A implementação de produção (`SupabaseReportShareLinkStore`) sempre usa
 * `createAdminClient()` (service role) — `report_share_links` não tem
 * NENHUMA policy de RLS, nunca é lida por um client comum do browser.
 */

const TOKEN_BYTES = 32;

function generateShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface ActiveReportShareLink {
  clientId: string;
  createdAt: string;
  /** `null` só pra link ativo criado ANTES desta etapa (linha antiga sem
   * `token` persistido) — nesse caso o painel cai pro estado "sem valor
   * visível, gere novamente" só daquela vez; qualquer link novo sempre tem
   * valor. */
  token: string | null;
}

export interface ReportShareLinkStore {
  /** `null` = token inexistente OU revogado — as duas situações nunca se
   * distinguem pra quem chama. */
  findActiveByTokenHash(tokenHash: string): Promise<{ clientId: string } | null>;
  /** `false` também cobre "cliente não existe" — mesmo critério do resto da
   * plataforma (`clients...is("deleted_at", null)`). */
  isClientLive(clientId: string): Promise<boolean>;
  findActiveForClient(clientId: string): Promise<ActiveReportShareLink | null>;
  revokeActiveForClient(clientId: string): Promise<void>;
  insert(clientId: string, token: string, tokenHash: string): Promise<void>;
}

class SupabaseReportShareLinkStore implements ReportShareLinkStore {
  async findActiveByTokenHash(tokenHash: string): Promise<{ clientId: string } | null> {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("report_share_links")
      .select("client_id")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .maybeSingle();

    if (error) {
      console.error("[report-share-links] falha ao resolver token", error);
      return null;
    }
    return data ? { clientId: data.client_id } : null;
  }

  async isClientLive(clientId: string): Promise<boolean> {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("clients").select("id").eq("id", clientId).is("deleted_at", null).maybeSingle();

    if (error) {
      console.error("[report-share-links] falha ao confirmar cliente do token", error);
      return false;
    }
    return Boolean(data);
  }

  async findActiveForClient(clientId: string): Promise<ActiveReportShareLink | null> {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("report_share_links")
      .select("client_id, created_at, token")
      .eq("client_id", clientId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[report-share-links] falha ao consultar status do link", error);
      return null;
    }
    return data ? { clientId: data.client_id, createdAt: data.created_at, token: data.token } : null;
  }

  async revokeActiveForClient(clientId: string): Promise<void> {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("report_share_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .is("revoked_at", null);

    if (error) {
      console.error("[report-share-links] falha ao revogar link", error);
      throw new Error("Não foi possível revogar o link — tente novamente.");
    }
  }

  async insert(clientId: string, token: string, tokenHash: string): Promise<void> {
    const supabase = createAdminClient();
    const { error } = await supabase.from("report_share_links").insert({ client_id: clientId, token, token_hash: tokenHash });

    if (error) {
      console.error("[report-share-links] falha ao criar link", error);
      throw new Error("Não foi possível gerar o link — tente novamente.");
    }
  }
}

let store: ReportShareLinkStore = new SupabaseReportShareLinkStore();

/** Só para testes (scripts/test-report-share-links.ts) — instala um store em
 * memória no lugar do Supabase real. Chamar com `null` restaura o store de
 * produção. Nunca chamado pela aplicação. */
export function __setReportShareLinkStoreForTests(testStore: ReportShareLinkStore | null): void {
  store = testStore ?? new SupabaseReportShareLinkStore();
}

/**
 * `/r/[token]` chama isto pra descobrir o `client_id` — a ÚNICA fonte de
 * verdade sobre qual cliente um token representa. Retorna `null` tanto para
 * token inexistente quanto revogado quanto cliente já excluído
 * (soft-delete) — de propósito, os três casos são indistinguíveis pra quem
 * chama (comportamento neutro: nunca revela qual dos três aconteceu). Nunca
 * loga o token. Continua resolvendo pelo HASH (`findActiveByTokenHash`),
 * nunca pelo valor bruto persistido — a leitura pública não muda, só o
 * painel administrativo (`getReportShareLinkStatus`) passa a enxergar o
 * valor bruto.
 */
export async function resolveClientIdFromShareToken(token: string): Promise<string | null> {
  if (!token) return null;

  const link = await store.findActiveByTokenHash(hashShareToken(token));
  if (!link) return null;

  const isLive = await store.isClientLive(link.clientId);
  return isLive ? link.clientId : null;
}

export interface ReportShareLinkStatus {
  active: boolean;
  createdAt: string | null;
  /** URL pública completa (`https://.../r/<token>`) do link ativo, sempre
   * que existir um — Etapa "Link Externo — token recuperável": o token
   * bruto fica persistido desde a geração (ver `ActiveReportShareLink.token`),
   * então esta função consegue reconstruir a URL a qualquer momento, não só
   * no instante em que o link foi gerado. `null` sem link ativo, ou pra um
   * link ativo criado antes desta etapa (sem valor persistido — nesse caso
   * peça pra gerar um novo). */
  url: string | null;
}

/**
 * Achado real em produção: a Vercel protege por padrão a URL única de CADA
 * deployment (`mitza-<hash>-mitza.vercel.app`) com login da própria Vercel
 * ("Deployment Protection") — só o domínio de produção alocado ao projeto
 * (`mitza.vercel.app`) fica público de verdade. Se a URL fosse montada no
 * cliente via `window.location.origin`, um admin gerando o link enquanto
 * navega numa URL de deployment com hash geraria um link OK pra ele (já
 * logado na Vercel), mas inacessível pra qualquer cliente real.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` é uma env var que a própria Vercel injeta
 * automaticamente (sem precisar configurar nada) em todo build/runtime,
 * sempre com o domínio de produção real do projeto — nunca a URL do
 * deployment atual. Por isso a URL final é sempre montada no servidor,
 * nunca no browser. Vive aqui (não em `report-share-link-actions.ts`, que
 * é "use server" — só pode exportar Server Actions async) porque tanto a
 * geração (`generateReportShareLinkAction`) quanto a leitura de status
 * (`getReportShareLinkStatus`, abaixo) precisam montar a mesma URL.
 */
export function resolvePublicShareLinkBaseUrl(): string {
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionUrl) return `https://${productionUrl}`;
  // Fora da Vercel (ex.: next dev local) essa env var não existe.
  return "http://localhost:3000";
}

/** Estado exibido no painel "Link do cliente" — se existe um link ativo,
 * desde quando, e a URL completa (reexibível a qualquer momento desde a
 * Etapa "Link Externo — token recuperável"; ver comentário no topo do
 * arquivo sobre o trade-off). */
export async function getReportShareLinkStatus(clientId: string): Promise<ReportShareLinkStatus> {
  const active = await store.findActiveForClient(clientId);
  const url = active?.token ? `${resolvePublicShareLinkBaseUrl()}/r/${active.token}` : null;
  return { active: Boolean(active), createdAt: active?.createdAt ?? null, url };
}

/**
 * Gera um novo link, revogando primeiro qualquer link ativo anterior do
 * MESMO cliente — nunca mais de um link ativo por cliente ao mesmo tempo
 * (a UI só tem um estado "ativo" por vez: "Gerar novo link" sempre rotaciona
 * o anterior, nunca acumula). Retorna o token bruto — desde a Etapa "Link
 * Externo — token recuperável" ele também fica persistido (nunca só nesta
 * chamada), então `getReportShareLinkStatus` consegue devolvê-lo de novo
 * depois, a qualquer momento.
 */
export async function rotateReportShareLink(clientId: string): Promise<string> {
  await store.revokeActiveForClient(clientId);
  const token = generateShareToken();
  await store.insert(clientId, token, hashShareToken(token));
  return token;
}

/** Revoga qualquer link ativo do cliente — idempotente (sem link ativo, é
 * um no-op silencioso, nunca erro). */
export async function revokeReportShareLink(clientId: string): Promise<void> {
  await store.revokeActiveForClient(clientId);
}

/** Exportado só para os testes exercitarem hash/entropia sem duplicar a
 * lógica. Nunca chamado pela aplicação fora deste módulo. */
export const __testing = { generateShareToken, hashShareToken };
