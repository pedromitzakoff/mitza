import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getCurrentProfile } from "@/lib/auth";
import { AppShell } from "./app-shell";
import { ToastProvider } from "./toast-provider";

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

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ToastProvider>{profile ? <AppShell profile={profile}>{children}</AppShell> : children}</ToastProvider>
      </body>
    </html>
  );
}
