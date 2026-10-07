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

  // MITZA ONE — Fase 2 (Sidebar = Carteira de Clientes): busca a carteira
  // UMA vez aqui no layout raiz (toda rota autenticada passa por aqui) —
  // `includeAllStatuses: true` porque a Sidebar nunca deve assumir exclusão
  // de cliente pausado/encerrado (seção 1 do pedido); `flattenAgencyTree`
  // é a MESMA ordenação oficial já usada por anterior/próximo/seletor de
  // antes desta fase (gestor, depois `wallet_position`, "Sem responsável"
  // por último) — nenhuma segunda ordenação inventada. `loadAgencyAccountsTree`
  // é `cache()`'d por request: se outra parte da árvore de renderização
  // também pedir a árvore ativo-only (`/clients`, `/`), é uma chamada
  // DIFERENTE (argumento diferente), não uma segunda consulta da MESMA
  // população.
  const walletClients = profile ? flattenAgencyTree(await loadAgencyAccountsTree({ includeAllStatuses: true })) : [];

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
