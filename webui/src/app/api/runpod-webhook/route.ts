import { applyRunpodStatus, readServerlessJob, saveServerlessJob, validWebhook } from "@/lib/serverless";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const sig = url.searchParams.get("sig") || "";
  if (!validWebhook(id, sig)) return Response.json({ error: "Invalid webhook." }, { status: 403 });
  const job = await readServerlessJob(id);
  if (!job) return Response.json({ error: "Unknown job." }, { status: 404 });
  const value = await request.json() as Record<string, unknown>;
  if (job.promptId && value.id !== job.promptId) return Response.json({ error: "Wrong Runpod job." }, { status: 400 });
  await saveServerlessJob(applyRunpodStatus(job, value));
  return Response.json({ ok: true });
}
