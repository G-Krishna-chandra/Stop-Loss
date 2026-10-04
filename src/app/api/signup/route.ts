// Starts an agent sign-up in a live Kernel browser after the user confirms in the dialog.
import { after } from "next/server";
import { z } from "zod";
import { executeSignup, prepareSignup } from "@/agent";

export const maxDuration = 300;

const Body = z.object({ url: z.string().min(3).max(300) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send the product's website as url." }, { status: 400 });
  if (!process.env.KERNEL_API_KEY) return Response.json({ error: "KERNEL_API_KEY is not set." }, { status: 503 });
  let run;
  try {
    run = await prepareSignup(parsed.data.url);
  } catch {
    return Response.json({ error: "That doesn't look like a website." }, { status: 400 });
  }
  after(() => executeSignup(run.id));
  return Response.json({ runId: run.id });
}
