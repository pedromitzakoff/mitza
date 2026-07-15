import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Fundação do Design System (Etapa 47) — aplicado só na Visão Geral por
 * enquanto. `Button`/`IconButton` consolidam o que hoje é escrito à mão em
 * cada Link/botão (ex.: os botões de navegação de mês, o gatilho do
 * popover de Filtros, a ação de linha da tabela) num único lugar com
 * estados consistentes (hover/focus/disabled).
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-hover",
  secondary:
    "border border-overview-border bg-overview-surface text-overview-text-primary hover:bg-overview-surface-hover hover:border-overview-border-strong",
  ghost: "text-overview-text-secondary hover:bg-overview-surface-hover hover:text-overview-text-primary",
  danger: "bg-overview-danger text-white hover:opacity-90",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-sm gap-2",
};

const BASE_CLASSES =
  "mitza-pressable inline-flex shrink-0 items-center justify-center rounded-md font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50";

interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Quando presente, renderiza como `<Link>` (navegação); caso contrário,
   * um `<button>` puro — quem chama controla type/onClick, então continua
   * utilizável dentro de Server Components (sem handler) ou Client
   * Components (com handler). */
  href?: string;
  children: ReactNode;
  className?: string;
}

export function Button({
  variant = "secondary",
  size = "md",
  href,
  children,
  className,
  ...rest
}: ButtonProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement> & ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
  const classes = `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className ?? ""}`;

  if (href) {
    return (
      <Link href={href} className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  );
}

interface IconButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  href?: string;
  children: ReactNode;
  className?: string;
  /** Obrigatório — nunca um ícone sem identificação acessível. */
  "aria-label": string;
}

export function IconButton({
  variant = "ghost",
  size = "md",
  href,
  children,
  className,
  "aria-label": ariaLabel,
  ...rest
}: IconButtonProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement> & ButtonHTMLAttributes<HTMLButtonElement>, "className" | "aria-label">) {
  const sizeClass = size === "sm" ? "h-7 w-7" : "h-8 w-8";
  const classes = `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${sizeClass} p-0 ${className ?? ""}`;

  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" aria-label={ariaLabel} className={classes} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  );
}
