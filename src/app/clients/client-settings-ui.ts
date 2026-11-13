/**
 * Etapa "Configurações do Cliente" (pedido explícito do usuário, ponto 7):
 * "Não force um salvamento global se as operações são independentes.
 * Mantenha a arquitetura atual, mas padronize visualmente os botões e os
 * feedbacks de salvamento." — cada Server Action desta tela continua 100%
 * independente (nenhuma unificação de transação); só o ESTILO do botão que
 * de fato comete uma alteração (nunca um link de navegação/Cancelar) passa
 * a vir de um lugar só, em duas variantes de tamanho (a ação principal da
 * tela vs. ações compactas por card/seção) — antes cada seção escrevia sua
 * própria string quase idêntica (e às vezes divergente, como o "Salvar" de
 * configuração avançada de objetivo, que usava o estilo de botão SECUNDÁRIO
 * apesar de ser uma ação que grava de verdade).
 */
export const CLIENT_SETTINGS_SAVE_BUTTON_CLASSES_LG =
  "rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover";

export const CLIENT_SETTINGS_SAVE_BUTTON_CLASSES =
  "rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover";
