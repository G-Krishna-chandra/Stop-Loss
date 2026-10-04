// Starts an agent sign-up in a live Kernel browser after the user confirms. Accepts a website or a product name;
// a name is resolved to the product's official site first.
import { after } from "next/server";
import { z } from "zod";
import { executeSignup, prepareSignup } from "@/agent";
import { findOfficialSite } from "@/terms";

export const maxDuration = 300;

const Body = z.object({ url: z.string().min(2).max(300) });

function looksLikeSite(input: string): boolean {
  return /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(input.trim());
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send the product's website or name as url." }, { status: 400 });
  if (!process.env.KERNEL_API_KEY) return Response.json({ error: "KERNEL_API_KEY is not set." }, { status: 503 });
  let target = parsed.data.url.trim();
  if (!looksLikeSite(target)) {
    const site = await findOfficialSite(target).catch(() => null);
    if (!site) return Response.json({ error: `Couldn't find ${target}'s website.` }, { status: 404 });
    target = site.url;
  }
  let run;
  try {
    run = await prepareSignup(target);
  } catch {
    return Response.json({ error: "That doesn't look like a website." }, { status: 400 });
  }
  after(() => executeSignup(run.id));
  return Response.json({ runId: run.id, website: target });
}
