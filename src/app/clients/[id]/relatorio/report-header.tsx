import Link from "next/link";
import { Download } from "lucide-react";

/**
 * Etapa "Otimização Mobile do Performance Report" — cabeçalho compartilhado
 * entre `/clients/[id]/relatorio` (interno) e `/r/[token]` (link externo,
 * sem login). Extraído porque a auditoria mobile encontrou dois problemas
 * reais e correlatos:
 *
 * 1. `/r/[token]` nunca mostrava o nome do cliente em lugar nenhum — a
 *    hierarquia mobile pedida ("De quem é esse relatório?" primeiro) não
 *    tinha resposta na tela. `document.clientName` já existe no
 *    `PerformanceReportDocument` (usado pelo hero do HTML/PDF) — só nunca
 *    tinha sido puxado pra esta página; nenhuma query nova.
 * 2. Em telas ~320-430px o antigo cabeçalho (título 24px + seletor + botão
 *    "Baixar PDF" do mesmo peso visual, todos na mesma linha) competia por
 *    espaço e empurrava o seletor pra um trigger pequeno demais. Aqui o
 *    nome do cliente vira o identificador (eyebrow), o título fica
 *    secundário e menor no mobile, o período ganha a largura disponível
 *    (mais fácil de tocar com o polegar) e "Baixar PDF" vira um botão
 *    circular de ícone (44×44px) — ação claramente secundária, nunca do
 *    mesmo peso do seletor.
 *
 * `pt-14` no mobile (removido em `md:`) afasta o cabeçalho do botão
 * hambúrguer flutuante da Sidebar (`fixed left-3 top-3 h-9 w-9`,
 * `app/sidebar.tsx`) — a auditoria confirmou que a caixa desse botão
 * (x:12-48, y:12-48) colidia com o link "← Cliente" no topo da página
 * (x:24, y:24 com o padding antigo). Correção só nesta página — a Sidebar
 * em si é problema estrutural fora do escopo desta etapa (sinalizado no
 * relatório de entrega, não redesenhado aqui).
 */
export function ReportHeader({
  clientName,
  backHref,
  pdfHref,
  periodControl,
  clearsMobileMenuButton = false,
}: {
  clientName: string;
  /** Presente só na página interna — vira link "← Cliente" pra
   * `/clients/[id]`. Ausente no link público (`/r/[token]`), que nunca tem
   * navegação interna: o nome do cliente aparece como texto simples. */
  backHref?: string;
  /** Ausente no link público (V1, fora de escopo — só o relatório interno
   * gera PDF). */
  pdfHref?: string;
  periodControl: React.ReactNode;
  /** `true` só na página interna (dentro do `AppShell`) — afasta o
   * cabeçalho do botão hambúrguer flutuante da Sidebar em mobile (ver nota
   * acima). `/r/[token]` nunca é renderizada dentro do `AppShell`, então
   * nunca precisa desse respiro. */
  clearsMobileMenuButton?: boolean;
}) {
  return (
    <header className={clearsMobileMenuButton ? "pt-14 md:pt-0" : undefined}>
      {backHref ? (
        <Link href={backHref} className="text-sm font-semibold text-[#6F6B65] hover:text-[#17171A]">
          &larr; {clientName}
        </Link>
      ) : (
        <p className="text-sm font-semibold text-[#6F6B65]">{clientName}</p>
      )}

      <h1 className="mt-0.5 text-xl font-bold tracking-tight text-[#17171A] sm:text-2xl">Relatório de Performance</h1>

      <div className="mt-3.5 flex items-center gap-2.5">
        <div className="min-w-0 flex-1 sm:flex-none">{periodControl}</div>
        {pdfHref && (
          <a
            href={pdfHref}
            aria-label="Baixar PDF"
            title="Baixar PDF"
            className="mitza-pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#C8BEAD] bg-white text-[#17171A] hover:bg-[#EFE9E0] sm:h-auto sm:w-auto sm:gap-1.5 sm:rounded-md sm:border-none sm:bg-brand sm:px-3.5 sm:py-1.5 sm:text-sm sm:font-medium sm:text-white sm:hover:bg-brand-hover"
          >
            <Download className="h-[18px] w-[18px] sm:hidden" aria-hidden="true" />
            <span className="hidden sm:inline">Baixar PDF</span>
          </a>
        )}
      </div>
    </header>
  );
}
