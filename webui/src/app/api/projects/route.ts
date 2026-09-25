import { authorized, unauthorized } from "@/lib/auth";
import { listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorized(request)) return unauthorized();
  try { return Response.json(await listProjects(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    console.error(error);
    return Response.json({ error: "Could not load project drafts." }, { status: 503 });
  }
}
