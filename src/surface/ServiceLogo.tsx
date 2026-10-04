"use client";

import clsx from "clsx";
import { useState } from "react";

const SIZES = { sm: "h-10 w-10 text-base", md: "h-12 w-12 text-lg", lg: "h-[88px] w-[88px] text-3xl" };

// The service's favicon, or its first letter when the icon cannot load.
export function ServiceLogo({ name, domain, size = "md" }: { name: string; domain: string; size?: keyof typeof SIZES }) {
  const [failed, setFailed] = useState(false);
  const box = clsx("flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line bg-white shadow-soft", SIZES[size]);
  if (failed || !domain) {
    return (
      <div className={clsx(box, "bg-ink font-semibold text-white")} aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    <div className={box}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`}
        alt=""
        className="h-[70%] w-[70%] object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
