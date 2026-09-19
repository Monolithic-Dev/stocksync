const COLORS = [
  "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
];

/** Deterministic so the same counter always renders the same color, without a shared color registry. */
function colorFor(counterId: string): string {
  let hash = 0;
  for (let i = 0; i < counterId.length; i += 1) hash = (hash * 31 + counterId.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export interface AttributionBadgeProps {
  counterId: string | undefined;
}

/** Small colored tag showing which counter last touched a field (field_last_writer). */
export function AttributionBadge({ counterId }: AttributionBadgeProps) {
  if (!counterId) return null;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorFor(counterId)}`}>
      {counterId}
    </span>
  );
}
