import { listJobs } from "@/lib/comfy";

export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(await listJobs(), { headers: { "Cache-Control": "no-store" } });
}
