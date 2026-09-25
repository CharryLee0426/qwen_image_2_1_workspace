import { authorized, unauthorized } from "@/lib/auth";
import { mutationAllowed } from "@/lib/comfy";
import { ProjectConflictError, ProjectValidationError, readProject, saveProject, validProjectId, validateProjectDraft } from "@/lib/projects";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  if (!authorized(request)) return unauthorized();
  const { id } = await context.params;
  if (!validProjectId(id)) return Response.json({ error: "Invalid project ID." }, { status: 400 });
  try {
    const project = await readProject(id);
    return project ? Response.json(project, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Project not found." }, { status: 404 });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Could not load the project draft." }, { status: 503 });
  }
}

export async function PUT(request: Request, context: Context) {
  if (!authorized(request)) return unauthorized();
  if (!mutationAllowed(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  const { id } = await context.params;
  if (!validProjectId(id)) return Response.json({ error: "Invalid project ID." }, { status: 400 });
  if (Number(request.headers.get("content-length")) > 100_000) return Response.json({ error: "Project draft is too large." }, { status: 413 });
  try {
    const project = validateProjectDraft(await request.json(), id);
    return Response.json(await saveProject(project), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProjectValidationError || error instanceof SyntaxError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof ProjectConflictError) return Response.json({ error: error.message }, { status: 409 });
    console.error(error);
    return Response.json({ error: "Could not save the project draft." }, { status: 503 });
  }
}
