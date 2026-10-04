"use client";

import clsx from "clsx";
import { Activity, CreditCard, Home, Mail, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/positions", label: "Positions", icon: CreditCard },
  { href: "/inbox", label: "Inbox", icon: Mail },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(href: string, path: string): boolean {
  if (href === "/") return path === "/" || path.startsWith("/voice");
  if (href === "/activity") return path.startsWith("/activity") || path.startsWith("/runs");
  return path.startsWith(href);
}

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar px-3 py-6 text-slate-300 md:flex">
      <Link href="/" className="mb-9 flex items-center gap-2.5 px-3">
        <Logo />
        <span className="text-[21px] font-semibold tracking-tight text-white">StopLoss</span>
      </Link>
      <nav className="flex flex-col gap-1" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, path);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors",
                active ? "bg-sidebar-active text-white" : "hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

// Phone-width navigation: the same links in a scrolling row under the top bar.
export function MobileNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 md:hidden" aria-label="Main">
      {NAV.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={clsx(
            "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium",
            isActive(href, path) ? "bg-slate-900 text-white" : "text-slate-600",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
