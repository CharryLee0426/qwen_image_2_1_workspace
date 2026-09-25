import { authorized, serverlessMode, unauthorized } from "@/lib/auth";
import { vapidDetails } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorized(request)) return unauthorized();
  let details = null;
  try { details = serverlessMode ? await vapidDetails() : null; }
  catch (error) { console.error("Could not load browser notification keys:", error); }
  return Response.json(details ? { available: true, publicKey: details.publicKey } : { available: false }, {
    headers: { "Cache-Control": "no-store" },
  });
}
