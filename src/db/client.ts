import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let cached: NeonQueryFunction<false, false> | null = null;

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

// One HTTP query function per process. Throws a clear error when DATABASE_URL is missing.
export function sql() {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Add your Neon connection string to .env.local.");
    cached = neon(url);
  }
  return cached;
}

// The driver parses timestamptz into Date. Every row leaves src/db with ISO strings instead.
export function iso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
