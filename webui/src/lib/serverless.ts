import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { BlobPreconditionFailedError, get, issueSignedToken, presignUrl, put } from "@vercel/blob";
import type { ImageFile, Job } from "./types";
import { notifyCompletedJob } from "./push";

const INDEX_PATH = "studio/jobs-v1.json";
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID;
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_WEBHOOK_SECRET = process.env.RUNPOD_WEBHOOK_SECRET;

type Index = { jobs: Job[]; etag?: string };

function runpodUrl(suffix: string) {
  if (!RUNPOD_ENDPOINT_ID || !/^[a-zA-Z0-9_-]+$/.test(RUNPOD_ENDPOINT_ID)) throw new Error("Runpod endpoint is not configured.");
  if (!RUNPOD_API_KEY) throw new Error("Runpod API key is not configured.");
  return `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/${suffix}`;
}

export async function runpodFetch(suffix: string, init?: RequestInit) {
  const response = await fetch(runpodUrl(suffix), {
    ...init,
    headers: { Authorization: `Bearer ${RUNPOD_API_KEY}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Runpod returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response;
}

async function readIndex(): Promise<Index> {
  const result = await get(INDEX_PATH, { access: "private", useCache: false });
  if (!result || !result.stream) return { jobs: [] };
  if (result.statusCode !== 200) throw new Error("Could not load the image library.");
  const data = await new Response(result.stream).json() as { jobs?: Job[] };
  // Private Blob GETs expose a weak HTTP ETag (W/"..."). Conditional PUTs
  // require the strong ETag for the same object.
  return { jobs: Array.isArray(data.jobs) ? data.jobs : [], etag: result.blob.etag.replace(/^W\//, "") };
}

async function changeIndex(change: (jobs: Job[]) => Job[]) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await readIndex();
    const jobs = change(current.jobs).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    try {
      await put(INDEX_PATH, JSON.stringify({ jobs }), {
        access: "private", contentType: "application/json", cacheControlMaxAge: 60,
        ...(current.etag ? { ifMatch: current.etag } : { allowOverwrite: false }),
      });
      return;
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) && (current.etag || !(await readIndex()).etag)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  throw new Error("The image library is busy. Try again.");
}

export async function listServerlessJobs() { return (await readIndex()).jobs; }
export async function readServerlessJob(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  return (await readIndex()).jobs.find((job) => job.id === id) || null;
}
export async function saveServerlessJob(job: Job) {
  await changeIndex((jobs) => {
    const existing = jobs.find((item) => item.id === job.id);
    const incomingActive = ["queued", "running"].includes(job.status);
    const existingFinished = existing && ["completed", "failed", "cancelled"].includes(existing.status);
    return [incomingActive && existingFinished ? existing : job, ...jobs.filter((item) => item.id !== job.id)];
  });
}

export async function reserveServerlessJob(job: Job) {
  await changeIndex((jobs) => {
    if (jobs.some((item) => item.id === job.id)) throw new Error("This picture has already been generated. Start a new project for another picture.");
    return [job, ...jobs];
  });
}

export function safeBlobPath(value: string, kind: "reference" | "output") {
  const prefix = kind === "reference" ? "studio/references/" : "studio/outputs/";
  return typeof value === "string" && value.startsWith(prefix) && /^studio\/[a-z0-9/_-]+\.(png|jpg|jpeg|webp)$/.test(value);
}

export async function signedBlobUrl(pathname: string, operation: "get" | "put", options?: { contentType?: string; maxBytes?: number; validForMs?: number }) {
  const validUntil = Date.now() + (options?.validForMs || (operation === "get" ? 15 * 60_000 : 4 * 60 * 60_000));
  const signed = await issueSignedToken({
    pathname, operations: [operation], validUntil,
    ...(operation === "put" ? { allowedContentTypes: [options?.contentType || "application/octet-stream"], maximumSizeInBytes: options?.maxBytes || 100 * 1024 * 1024, addRandomSuffix: false } : {}),
  });
  return (await presignUrl(signed, {
    pathname, operation, access: "private", validUntil,
    ...(operation === "put" ? { allowedContentTypes: [options?.contentType || "application/octet-stream"], maximumSizeInBytes: options?.maxBytes || 100 * 1024 * 1024, addRandomSuffix: false } : {}),
  } as Parameters<typeof presignUrl>[1])).presignedUrl;
}

function webhookUrl(id: string) {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base || !RUNPOD_WEBHOOK_SECRET) return undefined;
  const url = new URL("/api/runpod-webhook", base);
  url.searchParams.set("id", id);
  url.searchParams.set("sig", createHmac("sha256", RUNPOD_WEBHOOK_SECRET).update(id).digest("hex"));
  return url.toString();
}

export function validWebhook(id: string, signature: string) {
  if (!RUNPOD_WEBHOOK_SECRET || !/^[a-f0-9-]{36}$/.test(id)) return false;
  const expected = createHmac("sha256", RUNPOD_WEBHOOK_SECRET).update(id).digest("hex");
  return signature.length === expected.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function submitServerlessJob(job: Job, workflow: unknown, references: ImageFile[]) {
  const images = await Promise.all(references.map(async (image, index) => ({
    name: `${job.id}-${index + 1}.png`,
    url: await signedBlobUrl(image.blobPath!, "get", { validForMs: 4 * 60 * 60_000 }),
  })));
  const imagePath = `studio/outputs/${job.id}/image.png`;
  const previewPath = `studio/outputs/${job.id}/preview.webp`;
  const output = {
    image: { path: imagePath, putUrl: await signedBlobUrl(imagePath, "put", { contentType: "image/png", maxBytes: 100 * 1024 * 1024 }) },
    preview: { path: previewPath, putUrl: await signedBlobUrl(previewPath, "put", { contentType: "image/webp", maxBytes: 5 * 1024 * 1024 }) },
  };
  const response = await runpodFetch("run", {
    method: "POST",
    body: JSON.stringify({ input: { studioId: job.id, workflow, images, output }, webhook: webhookUrl(job.id) }),
  });
  const value = await response.json() as { id?: string; status?: string };
  if (!value.id) throw new Error("Runpod did not return a job ID.");
  return { ...job, promptId: value.id, status: "queued" as const, phase: "Queued" };
}

export function applyRunpodStatus(job: Job, value: Record<string, unknown>): Job {
  if (["completed", "failed", "cancelled"].includes(job.status)) return job;
  const status = value.status;
  const output = (value.output && typeof value.output === "object" ? value.output : {}) as Record<string, unknown>;
  if (status === "COMPLETED" && Array.isArray(output.images) && output.images.length) {
    const images = output.images.filter((image): image is ImageFile => {
      if (!image || typeof image !== "object") return false;
      const value = image as Record<string, unknown>;
      return typeof value.blobPath === "string" && typeof value.previewPath === "string" &&
        value.blobPath.startsWith(`studio/outputs/${job.id}/`) && value.previewPath.startsWith(`studio/outputs/${job.id}/`);
    });
    if (images.length) return { ...job, status: "completed", phase: "Complete", progress: 100, images, completedAt: new Date().toISOString(), duration: typeof value.executionTime === "number" ? value.executionTime / 1000 : job.duration };
  }
  if (["FAILED", "TIMED_OUT", "COMPLETED"].includes(String(status))) return { ...job, status: "failed", phase: "Failed", error: String(output.error || value.error || "Generation failed."), progress: job.progress };
  if (status === "CANCELLED") return { ...job, status: "cancelled", phase: "Cancelled" };
  if (status === "IN_PROGRESS") return { ...job, status: "running", phase: "Generating" };
  return { ...job, status: "queued", phase: "Queued" };
}

export async function refreshServerlessJob(job: Job) {
  if (job.status === "completed") {
    await notifyCompletedJob(job);
    return job;
  }
  if (!job.promptId || ["failed", "cancelled"].includes(job.status)) return job;
  const value = await (await runpodFetch(`status/${encodeURIComponent(job.promptId)}`)).json() as Record<string, unknown>;
  const refreshed = applyRunpodStatus(job, value);
  if (refreshed.status !== job.status || refreshed.images.length !== job.images.length) await saveServerlessJob(refreshed);
  if (refreshed.status === "completed") await notifyCompletedJob(refreshed);
  return refreshed;
}

export function newJobId() { return randomUUID(); }
