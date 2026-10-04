// Mints a short-lived ElevenLabs conversation token so the browser never sees ELEVENLABS_API_KEY.
// Behind the APP_PASSWORD gate like every other route.
export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.ELEVENLABS_API_KEY;
  const agent = process.env.ELEVENLABS_AGENT_ID;
  if (!key || !agent) {
    return Response.json({ error: "Voice isn't set up yet: ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID are needed." }, { status: 503 });
  }
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agent)}`, {
    headers: { "xi-api-key": key },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  if (!res.ok || !body.token) return Response.json({ error: "ElevenLabs did not return a conversation token." }, { status: 502 });
  return Response.json({ token: body.token });
}
