import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-xl py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Not found</p>
      <h1 className="mt-2 text-[34px] font-bold tracking-tight text-slate-900">That page isn’t here.</h1>
      <p className="mt-2 text-lg text-slate-500">It may have been removed, or the link is wrong.</p>
      <Link href="/positions" className="mt-6 inline-block font-medium text-brand hover:underline">
        Back to positions
      </Link>
    </div>
  );
}
