"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  {
    href: "/",
    label: "Facilities",
    desc: "batch extract → DB",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M12 10v4M10 12h4" />
      </svg>
    ),
  },
  {
    href: "/doctors",
    label: "Doctors",
    desc: "profile → DRX",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-7m0 0h-4m4 0h4M7 3h10v5a5 5 0 0 1-10 0V3Zm-3 5H3v2a3 3 0 0 0 3 3m14-5h1v2a3 3 0 0 1-3 3" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    desc: "processor config",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.5-3a7.5 7.5 0 0 0-.15-1.5l2-1.55-2-3.46-2.36.95a7.5 7.5 0 0 0-2.6-1.5L14 2h-4l-.39 2.44a7.5 7.5 0 0 0-2.6 1.5l-2.36-.95-2 3.46 2 1.55a7.5 7.5 0 0 0 0 3l-2 1.55 2 3.46 2.36-.95a7.5 7.5 0 0 0 2.6 1.5L10 22h4l.39-2.44a7.5 7.5 0 0 0 2.6-1.5l2.36.95 2-3.46-2-1.55c.1-.5.15-1 .15-1.5Z" />
      </svg>
    ),
  },
  {
    href: "/history",
    label: "History",
    desc: "cron ticks",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 2.5M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-sidebar-bg text-sidebar-text md:flex">
      {/* brand */}
      <div className="flex items-center gap-3 px-5 pb-6 pt-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-xl font-bold text-sidebar-bg">
          +
        </div>
        <div>
          <p className="text-sm font-bold leading-tight">DRZ Scrapping</p>
          <p className="text-[11px] text-sidebar-text-muted">data pipeline</p>
        </div>
      </div>

      {/* nav */}
      <p className="px-5 pb-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-text-muted">
        Scrape
      </p>
      <nav className="flex flex-col gap-1 px-3">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                active ? "bg-sidebar-active font-semibold text-sidebar-bg" : "text-sidebar-text hover:bg-sidebar-hover"
              }`}
            >
              <span className={active ? "" : "text-sidebar-text-muted"}>{item.icon}</span>
              <span className="flex-1">
                <span className="block text-sm leading-tight">{item.label}</span>
                <span className={`block text-[11px] ${active ? "text-sidebar-bg/70" : "text-sidebar-text-muted"}`}>
                  {item.desc}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>

      {/* footer */}
      <div className="mt-auto px-5 py-5">
        <div className="rounded-xl bg-sidebar-hover p-3">
          <p className="text-[11px] font-medium text-sidebar-text">jina + gemini</p>
          <p className="mt-0.5 text-[11px] leading-snug text-sidebar-text-muted">
            Keys load from <span className="font-mono">.env.local</span>
          </p>
        </div>
      </div>
    </aside>
  );
}
