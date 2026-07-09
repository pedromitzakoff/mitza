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
}: {
  comments: CommentItem[];
  commentableType: CommentableType;
  commentableId: string;
  clientId: string;
}) {
  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-900">
      {comments.length > 0 && (
        <ul className="flex flex-col gap-2">
          {comments.map((comment) => (
            <li key={comment.id} className="text-xs text-zinc-600 dark:text-zinc-400">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {comment.author?.name ?? "Alguém"}
              </span>{" "}
              · {commentDateFormatter.format(new Date(comment.created_at))}
              <p>{comment.content}</p>
            </li>
          ))}
        </ul>
      )}

      <form
        action={createCommentAction.bind(null, commentableType, commentableId, clientId)}
        className="mt-2 flex gap-2"
      >
        <input
          name="content"
          placeholder="Comentar..."
          required
          className="flex-1 rounded-md border border-zinc-300 px-2 py-1 text-xs text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-black hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-900"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
