# Linguagem de Interação da Plataforma Mitza

## Objetivo do documento

Registrar, num único lugar, como qualquer interação da Plataforma Mitza
deve se comportar — motion, hover, foco, cursor, pressed state, drawers,
popovers, chevrons, densidade, empty states, loading e toasts. Consolida
o que foi definido em três etapas anteriores (Interaction Physics 1.0,
Interaction Delight 1.0, densidade operacional) e no Platform Flow System
1.0, que auditou a plataforma inteira e formalizou este documento.

Este documento é a referência que qualquer tela nova deve seguir. Ver
Decisão 013 em `DECISIONS.md`: nenhuma tela nova pode criar uma interação
diferente da descrita aqui sem justificativa arquitetural registrada.

## 1. Motion tokens

Única fonte de duração/curva — `src/app/globals.css`, bloco `:root`:

| Token | Valor | Uso |
|---|---|---|
| `--motion-instant` | 90ms | pressed state |
| `--motion-fast` | 150ms | hover, backdrop, popover |
| `--motion-standard` | 220ms | entradas padrão, chevrons |
| `--motion-panel` | 260ms | drawers grandes |
| `--ease-enter` | `cubic-bezier(0.22,1,0.36,1)` | toda entrada/expansão |
| `--ease-exit` | `cubic-bezier(0.4,0,1,1)` | toda saída |

Nenhuma animação nova deve declarar duração/curva solta — sempre
referenciar um destes tokens.

## 2. Drawers

Todo drawer lateral usa `mitza-backdrop-in` (fundo) + `mitza-panel-in`
(painel, fade + `translateX`). Modais centralizados (ex.: agendar
reunião) usam `mitza-modal-in` (fade + scale) em vez do padrão lateral.

O backdrop de todo drawer deve ser clicável (fecha ao clicar fora) — um
`<div>` sem `onClick`/`href` nunca é aceitável como backdrop.

Saída animada (`mitza-backdrop-out`/`mitza-panel-out`) existe hoje só no
piloto (`task-drawer-panel.tsx`) — os demais fecham instantaneamente.
Generalizar exige o mesmo mecanismo de navegação adiada (ver
`src/lib/focus-restore.tsx` e o comentário em `task-drawer-panel.tsx`).

Foco: todo drawer deve receber `autoFocus` no primeiro controle útil ao
abrir. Devolver o foco pra quem abriu ao fechar é o padrão-alvo, mas hoje
só está implementado no drawer de tarefa e no editor de orçamento mensal
(`src/lib/focus-restore.tsx`).

## 3. Popovers e menus pequenos

Todo popover/menu ancorado (não um drawer de borda) usa `mitza-menu-in`
(fade + scale, nasce do próprio botão). `transform-origin` padrão é
`top right`; popovers alinhados à esquerda devem sobrescrever para
`top left` via `style` inline.

## 4. Chevrons

Toda seta de accordion (▸) usa a classe `mitza-chevron` (duração/curva
explícitas via token) junto com `group-open:rotate-90` — nunca
`transition-transform` genérico.

## 5. Botões — hover, pressed state, foco, cursor

- Hover: todo elemento com classe `hover:` precisa de uma transição
  (`transition-colors` ou a classe `mitza-pressable`).
- Pressed state: botões reais (não links de texto simples) usam
  `mitza-pressable` — cobre hover de cor (`color`/`background-color`/
  `border-color`) e o "afundar" (`scale(0.97)` em `:active:not(:disabled)`),
  nunca ativo quando desabilitado.
- Foco: todo elemento interativo precisa de indicador visível ao
  navegar por teclado. Hoje coexistem dois idiomas — `focus-visible:outline
  focus-visible:outline-2 focus-visible:outline-offset-2
  focus-visible:outline-brand` (botões, Sidebar, `Select`) e
  `focus:border-zinc-500`/`transition-colors` (a maioria dos inputs de
  texto). Nenhum elemento deve ficar sem os dois.
- Cursor: `cursor-pointer` em qualquer elemento clicável que não seja
  nativamente um botão/link; `disabled:cursor-not-allowed` sempre junto
  de `disabled:opacity-*`.

## 6. Densidade

Ver `page.tsx` (Visão Geral) como referência: containers de página usam
`py-4`; blocos de destaque usam `py-4 sm:py-5`; cabeçalhos de
seção/tabela usam `py-2`; linhas de lista clicáveis mantêm no mínimo
`min-h-[44px]` (nunca menos, por acessibilidade de clique). Reduzir
espaçamento nunca pode comprometer legibilidade, hierarquia ou conforto
de clique.

## 7. Empty states

`src/components/ui/empty-state.tsx` (`<EmptyState>texto</EmptyState>`) é
o padrão-base da plataforma — usar sempre que o estado vazio for uma
frase única. `src/components/workspace/empty-state.tsx` (título +
descrição + ação) é a variante mais rica, reservada à Visão Geral
enquanto o Design System novo (Etapa 47) não é promovido ao resto da
plataforma. Nenhuma tela deve escrever `<p>`/`<td>`/`<li>` com cor solta
pra um estado vazio — sempre um dos dois componentes.

## 8. Loading

Toda ação pendente responde por texto (ex.: "Salvando...") + `disabled`
+ `opacity-60` — nunca um spinner, nunca um skeleton. `SubmitButton`
(`useFormStatus`) e `ToastActionButton` (`useTransition`) já cobrem os
casos comuns; qualquer novo caso deve seguir a mesma fórmula.

## 9. Toasts

`ToastProvider`/`useToast` (`src/app/toast-provider.tsx`) é o único
mecanismo de confirmação de sucesso da plataforma — uma pílula discreta
no rodapé, nunca bloqueia, nunca navega. Nenhuma tela deve construir sua
própria confirmação (banner de sucesso, texto "Salvo" inline, etc.) — ver
recomendações do Platform Flow Audit pra exceções ainda não migradas.

## 10. Scroll

Toda navegação que só troca um parâmetro da própria página (filtro, aba,
abrir/fechar drawer, paginação) usa `<Link scroll={false}>`. Só uma
navegação pra uma página genuinely diferente deve rolar pro topo.

## 11. O que ainda não está unificado (dívida conhecida)

- **Cards**: coexistem `border-border`/`bg-card`/`rounded-lg` (a maior
  parte da plataforma) e `border-overview-border`/`bg-overview-surface`
  (Visão Geral, Design System novo da Etapa 47) — dois vocabulários de
  card em paralelo, por design (ver comentário em `globals.css`: quando
  o sistema novo for promovido, os tokens `overview-*` viram os globais).
- **Selects/inputs**: 4 convenções de foco coexistem hoje (`focus-visible:
  outline-brand`, `focus:border-zinc-500`, `focus:border-brand`, nenhuma).
  Unificar exige tocar ~15 arquivos de formulário — fora do escopo de um
  ajuste de baixo risco.
- **Tabs**: só existe uma instância (Sprints) — não há ainda um
  componente `Tabs` reutilizável, só um padrão de `<Link>`s com estado
  ativo.
