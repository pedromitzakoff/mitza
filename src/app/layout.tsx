import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getCurrentProfile } from "@/lib/auth";
import { loadAgencyAccountsTree } from "@/lib/agency-accounts-tree-data";
import { flattenAgencyTree } from "@/lib/agency-accounts-tree";
import { AppShell } from "./app-shell";
import { ToastProvider } from "./toast-provider";
import { NavigationProgress } from "./navigation-progress";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mitza",
  description: "Gestão de clientes, financeiro e tarefas da agência",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Etapa "Otimização de carregamento — Item 3 (Layout raiz)":
  // `getCurrentProfile()` e `loadAgencyAccountsTree()` não trocam dados
  // entre si (a árvore nunca recebe nada derivado do profile) — antes
  // rodavam em sequência só porque o uso da árvore era condicional ao
  // profile existir. Verificado contra as policies de RLS reais
  // (`supabase/operation-collaboration-rls.sql`: `clients_select`/
  // `team_members_select` exigem `auth.uid() is not null`/
  // `current_organization_id()`, que são `null` sem sessão — SEM policy
  // que erre pra usuário anônimo, só filtra pra 0 linhas): numa rota
  // pública (`/login`, `/r/[token]` sem sessão), chamar a árvore em
  // paralelo nunca lança erro nem devolve dado de outra organização — só
  // soma 2 idas ao banco que voltam vazias, do mesmo jeito que o `[]`
  // que `walletClients` já usava quando `profile` era `null`. Resultado
  // final idêntico em todos os casos (o `?` abaixo continua decidindo se
  // a árvore é usada), só a espera passa a ser em paralelo.
  //
  // MITZA ONE — Fase 2.1 (Refinamento da Sidebar: mostrar só clientes
  // ativos): SEM `includeAllStatuses`, ou seja, com o filtro padrão de
  // `loadAgencyAccountsTree` (`status = ativo`), o mesmo já usado por `/`
  // e `/clients` antes da Fase 2. Cliente pausado/encerrado continua
  // existindo e acessível por link direto/`/clients` (ver
  // `clients/[id]/layout.tsx`, que busca o cliente direto por ID, sem
  // depender desta árvore) — só deixa de aparecer NA LISTA da carteira.
  // `flattenAgencyTree` é a MESMA ordenação oficial já usada por
  // anterior/próximo/seletor de antes desta fase (gestor, depois
  // `wallet_position`, "Sem responsável" por último) — nenhuma segunda
  // ordenação inventada.
  const [profile, agencyTree] = await Promise.all([getCurrentProfile(), loadAgencyAccountsTree()]);
  const walletClients = profile ? flattenAgencyTree(agencyTree) : [];

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <NavigationProgress />
        <ToastProvider>
          {profile ? (
            <AppShell profile={profile} walletClients={walletClients}>
              {children}
            </AppShell>
          ) : (
            children
          )}
        </ToastProvider>
      </body>
    </html>
  );
}
