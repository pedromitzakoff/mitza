import type { CommentableType } from "@/lib/supabase/database.types";
import { createCommentAction } from "./comments-actions";

export interface CommentItem {
  id: string;
  commentable_id: string;
  content: string;
  created_at: string;
  author: { name: string } | null;
}

const commentDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function CommentThread({
  comments,
  commentableType,
  commentableId,
  clientId,
  returnTo,
}: {
  comments: CommentItem[];
  commentableType: CommentableType;
  commentableId: string;
  clientId: string;
  returnTo?: string;
}) {
  return (
    <div className="mt-2 border-t border-border pt-2">
      {comments.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {comments.map((comment) => (
            <li key={comment.id} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{comment.author?.name ?? "Alguém"}</span>{" "}
              · {commentDateFormatter.format(new Date(comment.created_at))}
              <p>{comment.content}</p>
            </li>
          ))}
        </ul>
      )}

      <form
        action={createCommentAction.bind(null, commentableType, commentableId, clientId)}
        className="mt-1.5 flex gap-2"
      >
        {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
        <input
          name="content"
          placeholder="Comentar..."
          required
          className="flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-xs text-foreground outline-none focus:border-zinc-500"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
