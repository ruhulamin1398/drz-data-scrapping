"use client";

export const QUEUE_STATUSES = ["pending", "processing", "in_progress", "success", "failed"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number] | "skipped";
export type QueueFilter = "all" | QueueStatus;
export type QueueCounts = Partial<Record<QueueStatus, number>>;

export function statusLabel(status: string) {
  return status === "in_progress" ? "in progress" : status;
}

export function queueTotal(counts: QueueCounts, statuses: readonly QueueStatus[] = QUEUE_STATUSES) {
  return statuses.reduce((n, s) => n + (counts[s] ?? 0), 0);
}

// One tab strip for every queue page (facilities, doctors, prewarm, updates and
// any future queue). Counts are exclusive: all = pending + processing +
// in_progress + success + failed (+ skipped). Pass custom statuses for queues
// with extra terminal states.
export default function QueueTabs({
  counts,
  filter,
  onChange,
  statuses = QUEUE_STATUSES,
}: {
  counts: QueueCounts;
  filter: QueueFilter;
  onChange: (f: QueueFilter) => void;
  statuses?: readonly QueueStatus[];
}) {
  const tabs: QueueFilter[] = ["all", ...statuses];
  const total = queueTotal(counts, statuses);
  return (
    <div className="mt-4 flex gap-1 overflow-x-auto rounded-xl bg-surface-alt p-1 text-sm">
      {tabs.map((f) => {
        const n = f === "all" ? total : counts[f] ?? 0;
        return (
          <button key={f} type="button" onClick={() => onChange(f)}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 font-medium capitalize transition ${
              filter === f ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
            }`}>
            {statusLabel(f)} ({n})
          </button>
        );
      })}
    </div>
  );
}
