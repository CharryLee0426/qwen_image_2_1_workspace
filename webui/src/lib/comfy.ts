import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import type { Job } from "./types";

export const COMFY_URL = process.env.COMFY_URL || "http://127.0.0.1:8188";
const JOBS_DIR = path.join(process.cwd(), ".data", "jobs");
const CLIENT_ID = "qwen-image-studio";
type Progress = { phase: string; progress: number };
type Monitor = { socket?: WebSocket; connecting?: Promise<void>; progress: Map<string, Progress> };
const globalState = globalThis as typeof globalThis & {
  qwenMonitor?: Monitor;
};
const monitor: Monitor = globalState.qwenMonitor ??= { progress: new Map<string, Progress>() };

export async function comfyFetch(endpoint: string, init?: RequestInit) {
  const response = await fetch(COMFY_URL + endpoint, { ...init, cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const text = await response.text();
    console.error(`ComfyUI ${endpoint}:`, text.slice(0, 3000));
    throw new Error(response.status === 400 ? "The workflow could not be queued. Check the model files and reference images." : "The image engine is unavailable.");
  }
  return response;
}

export async function connectMonitor() {
  if (monitor.socket?.readyState === WebSocket.OPEN) return;
  if (monitor.connecting) return monitor.connecting;
  monitor.connecting = new Promise<void>((resolve) => {
    const url = new URL("/ws", COMFY_URL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("clientId", CLIENT_ID);
    const socket = new WebSocket(url, { handshakeTimeout: 4000 });
    monitor.socket = socket;
    socket.on("open", resolve);
    socket.on("error", () => resolve());
    socket.on("close", () => { if (monitor.socket === socket) monitor.socket = undefined; });
    socket.on("message", (raw, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(raw.toString());
      const { type, data } = message;
      if (!data?.prompt_id) return;
      const old = monitor.progress.get(data.prompt_id) || { phase: "Preparing", progress: 0 };
      if (type === "progress" && data.max > 0) {
        monitor.progress.set(data.prompt_id, { phase: "Generating", progress: Math.round(data.value / data.max * 100) });
      } else if (type === "executing" && data.node) {
        const phases: Record<string, string> = { "451": "Loading", "453": "Loading", "454": "Loading", "452": "Preparing", "458": "Generating", "457": "Finishing", "461": "Saving" };
        monitor.progress.set(data.prompt_id, { ...old, phase: phases[data.node] || "Preparing" });
      }
      if (monitor.progress.size > 200) monitor.progress.delete(monitor.progress.keys().next().value!);
    });
  }).finally(() => { monitor.connecting = undefined; });
  return monitor.connecting;
}

export const clientId = CLIENT_ID;

function jobPath(id: string) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error("Invalid image ID.");
  return path.join(JOBS_DIR, `${id}.json`);
}

export async function saveJob(job: Job) {
  await mkdir(JOBS_DIR, { recursive: true });
  const file = jobPath(job.id);
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(job, null, 2));
  await rename(tmp, file);
}

export async function reserveJob(job: Job) {
  await mkdir(JOBS_DIR, { recursive: true });
  try { await writeFile(jobPath(job.id), JSON.stringify(job, null, 2), { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("This picture has already been generated. Start a new project for another picture.");
    throw error;
  }
}

export async function readJob(id: string): Promise<Job | null> {
  try { return JSON.parse(await readFile(jobPath(id), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function listJobs(): Promise<Job[]> {
  await mkdir(JOBS_DIR, { recursive: true });
  const files = (await readdir(JOBS_DIR)).filter((file) => file.endsWith(".json"));
  const jobs = await Promise.all(files.map((file) => readJob(file.slice(0, -5))));
  return jobs.filter((job): job is Job => !!job).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function refreshJob(job: Job): Promise<Job> {
  if (["completed", "failed", "cancelled"].includes(job.status)) return job;
  await connectMonitor();
  const history = await (await comfyFetch(`/history/${encodeURIComponent(job.promptId)}`)).json();
  const entry = history[job.promptId];
  if (entry) {
    const events = entry.status.messages as [string, Record<string, unknown>][];
    const error = events.find(([type]) => type === "execution_error");
    const interrupted = events.some(([type]) => type === "execution_interrupted");
    job.images = Object.values(entry.outputs as Record<string, { images?: Job["images"] }>).flatMap((value) => value.images || []);
    job.status = interrupted ? "cancelled" : entry.status.status_str === "success" && job.images.length ? "completed" : "failed";
    job.phase = job.status === "completed" ? "Complete" : job.status === "cancelled" ? "Cancelled" : "Failed";
    job.progress = job.status === "completed" ? 100 : job.progress;
    if (job.status === "failed") job.error = error ? String(error[1].exception_message || "Generation failed.").slice(0, 400) : "Generation did not produce an image.";
    const start = events.find(([type]) => type === "execution_start")?.[1].timestamp;
    const end = events.at(-1)?.[1].timestamp;
    if (typeof start === "number" && typeof end === "number") job.duration = (end - start) / 1000;
    await saveJob(job);
    return job;
  }
  const queue = await (await comfyFetch("/queue")).json();
  const running = queue.queue_running.some((item: unknown[]) => item[1] === job.promptId);
  const pending = queue.queue_pending.some((item: unknown[]) => item[1] === job.promptId);
  if (running) return { ...job, status: "running", ...(monitor.progress.get(job.promptId) || { phase: "Generating", progress: 0 }) };
  if (pending) return { ...job, status: "queued", phase: "Queued" };
  if (Date.now() - Date.parse(job.createdAt) > 30000) {
    job = { ...job, status: "failed", phase: "Failed", error: "This generation is no longer in the engine queue. Try again." };
    await saveJob(job);
  }
  return job;
}

export function mutationAllowed(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin);
    const host = request.headers.get("host") || new URL(request.url).host;
    return ["http:", "https:"].includes(source.protocol) && source.host === host;
  } catch { return false; }
}
