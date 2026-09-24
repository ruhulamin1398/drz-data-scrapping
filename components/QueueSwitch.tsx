"use client";

type Props = {
  on: boolean;
  onToggle: () => void;
  title: string;
  hint?: string;
};

// Shared processor/queue switch — same look on /settings, / and /doctors.
export default function QueueSwitch({ on, onToggle, title, hint }: Props) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex-1">
        <p className="text-sm font-semibold text-text-primary">{title}</p>
        {hint && <p className="text-xs text-text-secondary">{hint}</p>}
      </div>
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={on}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "bg-success" : "bg-border"}`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`}
        />
      </button>
    </div>
  );
}
