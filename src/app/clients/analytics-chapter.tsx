import type { ReactNode } from "react";

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V"];

/**
 * Capítulo do relatório — Etapa "Analytics como Relatório": o rótulo de
 * cada seção é a PERGUNTA que ela responde, nunca um nome genérico tipo
 * "KPIs"/"Overview" (pedido explícito do usuário — cada seção existe pra
 * responder uma pergunta específica: como foi o resultado, o que explica,
 * onde aconteceu, o que mudou, o que fizemos). A régua entre capítulos
 * (`border-t`) é a única separação visual — nunca um card/borda ao redor de
 * cada seção, pra manter a sensação de página de reportagem, não de
 * dashboard de widgets.
 */
export function AnalyticsChapter({ index, question, children }: { index: number; question: string; children: ReactNode }) {
  return (
    <section className="border-t border-border py-8 first:border-t-0 first:pt-0 sm:py-10">
      <p className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border font-serif text-[11px] italic text-brand">
          {ROMAN_NUMERALS[index - 1] ?? index}
        </span>
        {question}
      </p>
      {children}
    </section>
  );
}
