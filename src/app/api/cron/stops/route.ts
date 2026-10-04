// The scheduled stop check. Vercel Cron calls this with Authorization: Bearer $CRON_SECRET.
import { checkStops } from "@/agent";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pending = await checkStops();
  return Response.json({ ok: true, stops_pending: pending });
}
