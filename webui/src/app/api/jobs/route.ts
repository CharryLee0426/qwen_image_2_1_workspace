import { listJobs } from "@/lib/comfy";
import { authorized, serverlessMode, unauthorized } from "@/lib/auth";
import { listServerlessJobs } from "@/lib/serverless";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!authorized(request)) return unauthorized();
  return Response.json(serverlessMode ? await listServerlessJobs() : await listJobs(), { headers: { "Cache-Control": "no-store" } });
}
