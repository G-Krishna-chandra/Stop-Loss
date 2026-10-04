export function Logo({ className = "h-7 w-7 text-black" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path
        d="M16 2.5 4.5 7v8.2c0 7 4.9 12.6 11.5 14.3 6.6-1.7 11.5-7.3 11.5-14.3V7L16 2.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path d="M16 9.2 10 11.6v4.1c0 3.6 2.5 6.5 6 7.5 3.5-1 6-3.9 6-7.5v-4.1l-6-2.4Z" fill="currentColor" />
    </svg>
  );
}
