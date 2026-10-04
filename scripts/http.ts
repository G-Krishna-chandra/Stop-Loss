// Tiny adapter between node:http and the Web Request/Response the modules use.
import type { IncomingMessage, ServerResponse } from "node:http";

export async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(`http://localhost${req.url ?? "/"}`, {
    method: req.method ?? "GET",
    headers,
    ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
  });
}

export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
}
