"use client";

import clsx from "clsx";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({
  value,
  label = "Copy",
  iconOnly = false,
  compact = false,
}: {
  value: string;
  label?: string;
  iconOnly?: boolean;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={iconOnly ? `${label} ${value}` : undefined}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-line bg-white font-semibold text-ink shadow-[0_1px_2px_rgb(17_17_17/0.04)] hover:bg-neutral-50",
        compact ? "px-3.5 py-2 text-[14px]" : "px-5 py-3 text-[15px]",
      )}
    >
      <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} aria-hidden="true" />
      {iconOnly ? null : copied ? "Copied" : label}
    </button>
  );
}
