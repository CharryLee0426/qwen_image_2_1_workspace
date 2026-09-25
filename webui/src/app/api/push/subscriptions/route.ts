import { authorized, serverlessMode, unauthorized } from "@/lib/auth";
import { mutationAllowed } from "@/lib/comfy";
import { parsePushSubscription, removePushSubscription, savePushSubscription, vapidDetails } from "@/lib/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unavailable() {
  return Response.json({ error: "Browser notifications are not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

async function jsonBody(request: Request) {
  if (Number(request.headers.get("content-length")) > 8192) throw new Error("Subscription request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing subscription request.");
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new Error("Subscription request is too large."); }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode()) as Record<string, unknown>;
}

export async function POST(request: Request) {
  if (!authorized(request)) return unauthorized();
  if (!mutationAllowed(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  if (!serverlessMode) return unavailable();
  try {
    if (!await vapidDetails()) return unavailable();
    const body = await jsonBody(request);
    const subscription = parsePushSubscription(body?.subscription);
    if (!subscription) return Response.json({ error: "Invalid browser subscription." }, { status: 400 });
    await savePushSubscription(subscription);
    return Response.json({ ok: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.message === "Subscription request is too large.")) {
      return Response.json({ error: error.message }, { status: error instanceof SyntaxError ? 400 : 413 });
    }
    console.error("Could not save browser subscription:", error);
    return Response.json({ error: "Could not save browser notifications. Try again." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  if (!authorized(request)) return unauthorized();
  if (!mutationAllowed(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  if (!serverlessMode) return unavailable();
  try {
    if (!await vapidDetails()) return unavailable();
    const body = await jsonBody(request);
    if (typeof body?.endpoint !== "string" || body.endpoint.length > 2048) return Response.json({ error: "Invalid browser subscription." }, { status: 400 });
    await removePushSubscription(body.endpoint);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.message === "Subscription request is too large.")) {
      return Response.json({ error: error.message }, { status: error instanceof SyntaxError ? 400 : 413 });
    }
    console.error("Could not remove browser subscription:", error);
    return Response.json({ error: "Could not update browser notifications. Try again." }, { status: 503 });
  }
}
