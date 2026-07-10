function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-card p-3">
      <div className="h-3 w-20 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-2 h-5 w-14 rounded bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="animate-pulse">
        <div className="h-7 w-72 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-2 h-4 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <div className="mt-6 h-12 rounded-lg border border-border bg-card" />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      <div className="mt-4 h-64 animate-pulse rounded-lg border border-border bg-card" />

      <div className="mt-6 h-40 animate-pulse rounded-lg border border-border bg-card" />
      <div className="mt-6 h-40 animate-pulse rounded-lg border border-border bg-card" />
    </div>
  );
}
