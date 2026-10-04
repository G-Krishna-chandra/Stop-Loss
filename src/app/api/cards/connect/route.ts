// "Connect Link wallet": creates the Kernel Link wallet if needed and sends the user to Link's hosted sign-in.
import { redirect } from "next/navigation";
import { connectWallet } from "@/cards";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.KERNEL_API_KEY) return Response.json({ error: "KERNEL_API_KEY is not set." }, { status: 503 });
  let url: string | null;
  try {
    url = await connectWallet();
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Could not start the Link connection." }, { status: 502 });
  }
  redirect(url ?? "/settings#cards");
}
