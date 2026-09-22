import { comfyFetch } from "@/lib/comfy";

export const dynamic = "force-dynamic";
export async function GET() {
  try { await comfyFetch("/system_stats"); return Response.json({ connected: true }); }
  catch { return Response.json({ connected: false }); }
}
