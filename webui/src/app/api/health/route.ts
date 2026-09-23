import { comfyFetch } from "@/lib/comfy";
import { authorized, serverlessMode, unauthorized } from "@/lib/auth";
import { runpodFetch } from "@/lib/serverless";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!authorized(request)) return unauthorized();
  if (serverlessMode) {
    try { await runpodFetch("health"); return Response.json({ connected: true, mode: "runpod" }); }
    catch { return Response.json({ connected: false, mode: "runpod" }); }
  }
  try { await comfyFetch("/system_stats"); return Response.json({ connected: true }); }
  catch { return Response.json({ connected: false }); }
}
