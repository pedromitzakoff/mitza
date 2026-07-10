import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getCurrentProfile } from "@/lib/auth";
import { Sidebar } from "./sidebar";

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
        {profile ? (
          <div className="flex min-h-full flex-col md:flex-row">
            <Sidebar profile={profile} />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
