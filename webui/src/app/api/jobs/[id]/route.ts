import { comfyFetch, mutationAllowed, readJob, refreshJob, saveJob } from "@/lib/comfy";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const job = await readJob(id);
  if (!job) return Response.json({ error: "Image not found." }, { status: 404 });
  try { return Response.json(await refreshJob(job), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Reconnecting to the image engine…" }, { status: 503 }); }
}

export async function DELETE(request: Request, context: Context) {
  if (!mutationAllowed(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  const { id } = await context.params;
  const job = await readJob(id);
  if (!job) return Response.json({ error: "Image not found." }, { status: 404 });
  if (!["queued", "running"].includes(job.status)) return Response.json(job);
  try {
    await comfyFetch("/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [job.promptId] }) });
    await comfyFetch("/interrupt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt_id: job.promptId }) });
    const cancelled = { ...job, status: "cancelled" as const, phase: "Cancelled" };
    await saveJob(cancelled);
    return Response.json(cancelled);
  } catch { return Response.json({ error: "Could not stop this generation. Try again." }, { status: 503 }); }
}
