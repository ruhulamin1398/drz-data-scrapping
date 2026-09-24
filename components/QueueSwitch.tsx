"use client";

import type { ReactNode } from "react";

type Props = {
  on: boolean;
  onToggle: () => void;
  title: string;
  hint?: string;
  children?: ReactNode;
};

// Shared processor/queue switch — same look on /settings, / and /doctors.
// Optional children render inside the card (e.g. per-queue tasks-per-tick).
export default function QueueSwitch({ on, onToggle, title, hint, children }: Props) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-3">
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
      {children && <div className="mt-3 border-t border-border pt-3">{children}</div>}
    </div>
  );
}

// Per-queue tasks-per-tick number field — lives inside a QueueSwitch card.
export function TasksPerTickInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="flex-1">
        <span className="font-medium text-text-primary">Tasks per tick</span>
        <span className="block text-xs text-text-secondary">Each cron run tops up to this many active</span>
      </span>
      <input
        type="number"
        min={1}
        max={50}
        value={value}
        onChange={(e) => onChange(Math.min(Math.max(1, Math.floor(Number(e.target.value)) || 1), 50))}
        className="w-20 rounded-xl border border-border bg-surface-alt px-3 py-2 text-text-primary outline-none focus:border-primary"
      />
    </label>
  );
}
