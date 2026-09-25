import { applyRunpodStatus, readServerlessJob, saveServerlessJob, validWebhook } from "@/lib/serverless";
import { notifyCompletedJob } from "@/lib/push";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const sig = url.searchParams.get("sig") || "";
  if (!validWebhook(id, sig)) return Response.json({ error: "Invalid webhook." }, { status: 403 });
  const job = await readServerlessJob(id);
  if (!job) return Response.json({ error: "Unknown job." }, { status: 404 });
  const value = await request.json() as Record<string, unknown>;
  if (job.promptId && value.id !== job.promptId) return Response.json({ error: "Wrong Runpod job." }, { status: 400 });
  const updated = applyRunpodStatus(job, value);
  await saveServerlessJob(updated);
  if (updated.status === "completed") await notifyCompletedJob(updated);
  return Response.json({ ok: true });
}
