import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-xl py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">Not found</p>
      <h1 className="mt-2 text-[34px] font-bold tracking-tight text-ink">That page isn’t here.</h1>
      <p className="mt-2 text-lg text-muted">It may have been removed, or the link is wrong.</p>
      <Link href="/positions" className="mt-6 inline-block font-medium text-ink underline decoration-neutral-300 underline-offset-4 hover:decoration-ink">
        Back to positions
      </Link>
    </div>
  );
}
