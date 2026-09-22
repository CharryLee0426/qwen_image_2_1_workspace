import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { buildWorkflow, validateInput } from "@/lib/workflow";
import { comfyFetch, connectMonitor, clientId, mutationAllowed, saveJob } from "@/lib/comfy";
import type { ImageFile, Job } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!mutationAllowed(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 100 * 1024 * 1024) return Response.json({ error: "Images exceed 100 MB." }, { status: 413 });
  try {
    const form = await request.formData();
    const input = validateInput(JSON.parse(String(form.get("settings"))));
    const files = form.getAll("images");
    if (files.length > 10) throw new Error("Use up to 10 reference images.");
    if (files.some((file) => !(file instanceof File) || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024)) {
      throw new Error("Use PNG, JPEG, or WebP images under 20 MB.");
    }
    await comfyFetch("/system_stats");
    const id = randomUUID();
    const references: ImageFile[] = [];
    for (const [index, value] of files.entries()) {
      const file = value as File;
      let bytes: Buffer;
      try { bytes = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 }).rotate().png().toBuffer(); }
      catch { throw new Error(`“${file.name}” could not be opened as an image.`); }
      const upload = new FormData();
      upload.set("image", new Blob([new Uint8Array(bytes)], { type: "image/png" }), `${id}-${index + 1}.png`);
      upload.set("subfolder", "qwen-studio");
      upload.set("type", "input");
      const result = await (await comfyFetch("/upload/image", { method: "POST", body: upload })).json();
      references.push({ filename: result.name, subfolder: result.subfolder, type: "input" });
    }
    const prompt = buildWorkflow(input, references.map((image) => `${image.subfolder}/${image.filename}`), id);
    await connectMonitor();
    const result = await (await comfyFetch("/prompt", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, client_id: clientId, extra_data: { qwen_studio: { id, ...input } } }),
    })).json();
    const job: Job = { ...input, id, promptId: result.prompt_id, createdAt: new Date().toISOString(), status: "queued", phase: "Queued", progress: 0, references, images: [] };
    await saveJob(job);
    return Response.json(job, { status: 202 });
  } catch (error) {
    console.error(error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not start generation." }, { status: 400 });
  }
}
