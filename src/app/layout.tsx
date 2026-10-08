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
  const profile = await getCurrentProfile();

  // MITZA ONE — Fase 2.1 (Refinamento da Sidebar: mostrar só clientes
  // ativos): busca a carteira UMA vez aqui no layout raiz (toda rota
  // autenticada passa por aqui) — SEM `includeAllStatuses`, ou seja, com o
  // filtro padrão de `loadAgencyAccountsTree` (`status = ativo`), o mesmo
  // já usado por `/` e `/clients` antes da Fase 2. Cliente pausado/
  // encerrado continua existindo e acessível por link direto/`/clients`
  // (ver `clients/[id]/layout.tsx`, que busca o cliente direto por ID,
  // sem depender desta árvore) — só deixa de aparecer NA LISTA da
  // carteira. `flattenAgencyTree` é a MESMA ordenação oficial já usada por
  // anterior/próximo/seletor de antes desta fase (gestor, depois
  // `wallet_position`, "Sem responsável" por último) — nenhuma segunda
  // ordenação inventada.
  const walletClients = profile ? flattenAgencyTree(await loadAgencyAccountsTree()) : [];

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
