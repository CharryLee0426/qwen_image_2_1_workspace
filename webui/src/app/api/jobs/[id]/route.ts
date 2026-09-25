import { comfyFetch, mutationAllowed, readJob, refreshJob, saveJob } from "@/lib/comfy";
import { authorized, serverlessMode, unauthorized } from "@/lib/auth";
import { readServerlessJob, refreshServerlessJob, runpodFetch, saveServerlessJob } from "@/lib/serverless";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  if (!authorized(request)) return unauthorized();
  const { id } = await context.params;
  if (serverlessMode) {
    const job = await readServerlessJob(id);
    if (!job) return Response.json({ error: "Image not found." }, { status: 404 });
    try { return Response.json(await refreshServerlessJob(job), { headers: { "Cache-Control": "no-store" } }); }
    catch { return Response.json({ error: "Reconnecting to Runpod…" }, { status: 503 }); }
  }
  const job = await readJob(id);
  if (!job) return Response.json({ error: "Image not found." }, { status: 404 });
  try { return Response.json(await refreshJob(job), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Reconnecting to the image engine…" }, { status: 503 }); }
}

export async function DELETE(request: Request, context: Context) {
  if (!authorized(request)) return unauthorized();
  if (!mutationAllowed(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  const { id } = await context.params;
  if (serverlessMode) {
    const job = await readServerlessJob(id);
    if (!job) return Response.json({ error: "Image not found." }, { status: 404 });
    if (!["queued", "running"].includes(job.status) || !job.promptId) return Response.json(job);
    try {
      await runpodFetch(`cancel/${encodeURIComponent(job.promptId)}`, { method: "POST" });
      const cancelled = { ...job, status: "cancelled" as const, phase: "Cancelled" };
      await saveServerlessJob(cancelled);
      return Response.json(cancelled);
    } catch { return Response.json({ error: "Could not stop this generation. Try again." }, { status: 503 }); }
  }
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
