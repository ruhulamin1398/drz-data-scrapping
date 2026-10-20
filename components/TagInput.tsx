"use client";

import { useMemo, useRef, useState } from "react";
import { MAX_TAGS, normalizeTag } from "@/lib/tags";
import type { TagSuggestion } from "@/lib/cron-types";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: TagSuggestion[];
  placeholder?: string;
};

// Multi-select tag input with autocomplete. Existing tags come from the API;
// typing a new name and pressing Enter creates it.
export default function TagInput({ value, onChange, suggestions, placeholder = "Add a tag…" }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = text.trim().toLowerCase().replace(/^#+/, "");
  const options = useMemo(
    () =>
      suggestions
        .filter((s) => !value.includes(s.name) && (!query || s.name.includes(query)))
        .slice(0, 8),
    [suggestions, value, query]
  );

  function add(raw: string) {
    const tag = normalizeTag(raw);
    if (!tag) return;
    if (value.length >= MAX_TAGS) return;
    if (!value.includes(tag)) onChange([...value, tag]);
    setText("");
    setActive(0);
    setOpen(true);
    inputRef.current?.focus();
  }

  function remove(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && options[active]) add(options[active].name);
      else add(text);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(0, options.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Backspace" && !text && value.length) {
      remove(value[value.length - 1]);
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <div
        className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface-alt px-2 py-1.5 focus-within:border-primary"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary-dark">
            <span className="text-primary-dark/60">#</span>
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(tag);
              }}
              className="ml-0.5 rounded-full px-1 text-primary-dark/70 hover:bg-primary/20 hover:text-primary-dark"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder={value.length ? "" : placeholder}
          disabled={value.length >= MAX_TAGS}
          className="min-w-24 flex-1 bg-transparent px-1 py-1 text-sm text-text-primary outline-none placeholder:text-text-muted disabled:opacity-50"
        />
      </div>

      {open && (options.length > 0 || query) && (
        <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          {options.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                add(s.name);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                i === active ? "bg-surface-alt text-text-primary" : "text-text-secondary"
              }`}
            >
              <span className="text-text-muted">#</span>
              <span className="flex-1 truncate">{s.name}</span>
              <span className="text-[11px] text-text-muted">{s.count}</span>
            </button>
          ))}
          {query && !options.some((s) => s.name === normalizeTag(query)) && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                add(text);
              }}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-primary-dark hover:bg-surface-alt"
            >
              <span className="text-text-muted">#</span>
              <span className="flex-1 truncate">Create “{normalizeTag(query)}”</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
