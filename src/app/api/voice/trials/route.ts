// For the voice assistant: products in a category with a free trial of a paid plan right now.
import { findTrials } from "@/terms";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const topic = new URL(req.url).searchParams.get("topic")?.trim();
  if (!topic) return Response.json({ error: "Pass ?topic=" }, { status: 400 });
  const trials = await findTrials(topic).catch(() => []);
  return Response.json({ topic, trials });
}
