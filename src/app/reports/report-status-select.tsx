"use client";

/**
 * Select que se auto-envia ao trocar de valor — só isso. Nenhuma regra de
 * status mora aqui (quem decide o que acontece com o valor enviado é
 * sempre o Server Action que o `<form>` pai aponta, `updateReportStatusAction`
 * em `report-actions.ts`). Existe só pra evitar um botão "Salvar" extra
 * ocupando espaço numa linha de tabela — "interação compacta", pedido
 * explícito da Etapa "Separação Relatório Operacional × Documento de
 * Performance".
 */
export function ReportStatusSelect({
  name,
  defaultValue,
  className,
  options,
  disabled,
}: {
  name: string;
  defaultValue: string;
  className: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      disabled={disabled}
      className={className}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
