// Password gate for deployed StopLoss. With APP_PASSWORD set, every page and API route asks for HTTP Basic auth
// (any username, that password). The AgentMail webhook and the cron route are exempt: they check their own
// signature and bearer secret. Without APP_PASSWORD (local dev) nothing is gated.
import { NextResponse, type NextRequest } from "next/server";

const OPEN = ["/api/webhooks/agentmail", "/api/cron/stops"];

function passwordFrom(header: string | null): string | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice(6));
    return decoded.slice(decoded.indexOf(":") + 1);
  } catch {
    return null;
  }
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const expected = process.env.APP_PASSWORD;
  if (!expected || OPEN.some((p) => request.nextUrl.pathname.startsWith(p))) return NextResponse.next();
  const given = passwordFrom(request.headers.get("authorization"));
  if (given && same(given, expected)) return NextResponse.next();
  return new NextResponse("StopLoss needs a password.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="StopLoss", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
