import { randomBytes, createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Etapa "Link Externo V1" — núcleo do token do link compartilhável do
 * Performance Report (`/r/[token]`).
 *
 * Token = 32 bytes (256 bits) de `crypto.randomBytes`, codificado em
 * base64url — criptograficamente aleatório, impossível de adivinhar por
 * força bruta, e nunca persistido em si: só `hashShareToken(token)` (sha256
 * hex) vai para `report_share_links.token_hash`. Isso é suficiente (não
 * precisa de um hash lento tipo bcrypt/scrypt, que existe pra mitigar senha
 * de BAIXA entropia escolhida por humano) — a segurança aqui vem inteira da
 * entropia do token, o mesmo raciocínio de qualquer API token/session token
 * de alta entropia (GitHub PAT, chave de API, etc.).
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
  insert(clientId: string, tokenHash: string): Promise<void>;
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
      .select("client_id, created_at")
      .eq("client_id", clientId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[report-share-links] falha ao consultar status do link", error);
      return null;
    }
    return data ? { clientId: data.client_id, createdAt: data.created_at } : null;
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

  async insert(clientId: string, tokenHash: string): Promise<void> {
    const supabase = createAdminClient();
    const { error } = await supabase.from("report_share_links").insert({ client_id: clientId, token_hash: tokenHash });

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
 * loga o token nem o hash.
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
}

/** Estado exibido no painel "Link do cliente" — nunca o token em si (não é
 * recuperável depois de gerado), só se existe um link ativo e desde quando. */
export async function getReportShareLinkStatus(clientId: string): Promise<ReportShareLinkStatus> {
  const active = await store.findActiveForClient(clientId);
  return { active: Boolean(active), createdAt: active?.createdAt ?? null };
}

/**
 * Gera um novo link, revogando primeiro qualquer link ativo anterior do
 * MESMO cliente — nunca mais de um link ativo por cliente ao mesmo tempo
 * (a UI só tem um estado "ativo" por vez: "Gerar novo link" sempre rotaciona
 * o anterior, nunca acumula). Retorna o token BRUTO — a única vez que ele
 * existe fora de quem o gerou; só o hash fica no banco.
 */
export async function rotateReportShareLink(clientId: string): Promise<string> {
  await store.revokeActiveForClient(clientId);
  const token = generateShareToken();
  await store.insert(clientId, hashShareToken(token));
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
