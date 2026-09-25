import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { buildWorkflow, validateInput } from "@/lib/workflow";
import { comfyFetch, connectMonitor, clientId, mutationAllowed, readJob, reserveJob, saveJob } from "@/lib/comfy";
import type { ImageFile, Job } from "@/lib/types";
import { authorized, serverlessMode, unauthorized } from "@/lib/auth";
import { newJobId, readServerlessJob, reserveServerlessJob, safeBlobPath, saveServerlessJob, submitServerlessJob } from "@/lib/serverless";
import { readProject, validProjectId } from "@/lib/projects";

export const runtime = "nodejs";

async function uploadLocalReference(source: Buffer, id: string, index: number, name: string): Promise<ImageFile> {
  let bytes: Buffer;
  try { bytes = await sharp(source, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer(); }
  catch { throw new Error(`“${name}” could not be opened as an image.`); }
  const upload = new FormData();
  upload.set("image", new Blob([new Uint8Array(bytes)], { type: "image/png" }), `${id}-${index + 1}.png`);
  upload.set("subfolder", "qwen-studio");
  upload.set("type", "input");
  const result = await (await comfyFetch("/upload/image", { method: "POST", body: upload })).json() as { name: string; subfolder: string };
  return { filename: result.name, subfolder: result.subfolder, type: "input" };
}

export async function POST(request: Request) {
  if (!authorized(request)) return unauthorized();
  if (!mutationAllowed(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  if (serverlessMode) {
    if (Number(request.headers.get("content-length")) > 100_000) return Response.json({ error: "Generation request is too large." }, { status: 413 });
    try {
      const body = await request.json() as { settings?: unknown; references?: unknown; projectId?: unknown };
      const input = validateInput(body.settings);
      const referencePaths = body.references;
      if (!Array.isArray(referencePaths) || referencePaths.length > 10 || referencePaths.some((path) => typeof path !== "string" || (!safeBlobPath(path, "reference") && !safeBlobPath(path, "output")))) {
        throw new Error("Use up to 10 uploaded reference images.");
      }
      const id = body.projectId === undefined ? newJobId() : String(body.projectId);
      if (body.projectId !== undefined && (!validProjectId(id) || !await readProject(id))) throw new Error("Save this project draft before generating.");
      if (await readServerlessJob(id)) throw new Error("This picture has already been generated. Start a new project for another picture.");
      const references: ImageFile[] = referencePaths.map((blobPath, index) => ({ filename: `${id}-${index + 1}.png`, subfolder: "", type: blobPath.startsWith("studio/outputs/") ? "output" : "input", blobPath }));
      const prompt = buildWorkflow(input, references.map((image) => image.filename), id);
      const job: Job = { ...input, id, promptId: "", createdAt: new Date().toISOString(), status: "queued", phase: "Queued", progress: 0, references, images: [] };
      await reserveServerlessJob(job);
      try {
        const submitted = await submitServerlessJob(job, prompt, references);
        await saveServerlessJob(submitted);
        return Response.json(submitted, { status: 202 });
      } catch (error) {
        await saveServerlessJob({ ...job, status: "failed", phase: "Failed", error: error instanceof Error ? error.message : "Could not start generation." });
        throw error;
      }
    } catch (error) {
      console.error(error);
      return Response.json({ error: error instanceof Error ? error.message : "Could not start generation." }, { status: 400 });
    }
  }
  if (Number(request.headers.get("content-length")) > 100 * 1024 * 1024) return Response.json({ error: "Images exceed 100 MB." }, { status: 413 });
  try {
    const form = await request.formData();
    const input = validateInput(JSON.parse(String(form.get("settings"))));
    const projectId = form.get("projectId");
    const id = projectId === null ? randomUUID() : String(projectId);
    const project = projectId === null ? null : validProjectId(id) ? await readProject(id) : null;
    if (projectId !== null && !project) throw new Error("Save this project draft before generating.");
    if (await readJob(id)) throw new Error("This picture has already been generated. Start a new project for another picture.");
    const files = form.getAll("images");
    if (project && files.length) throw new Error("Saved project references are used automatically; do not upload them again.");
    if (files.length > 10) throw new Error("Use up to 10 reference images.");
    if (files.some((file) => !(file instanceof File) || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024)) {
      throw new Error("Use PNG, JPEG, or WebP images under 20 MB.");
    }
    await comfyFetch("/system_stats");
    const references: ImageFile[] = [];
    if (project) {
      for (const [index, image] of project.references.entries()) {
        if (image.type === "input") { references.push(image); continue; }
        const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: "output" });
        const response = await comfyFetch(`/view?${query}`);
        references.push(await uploadLocalReference(Buffer.from(await response.arrayBuffer()), id, index, image.filename));
      }
    } else {
      for (const [index, value] of files.entries()) {
        const file = value as File;
        references.push(await uploadLocalReference(Buffer.from(await file.arrayBuffer()), id, index, file.name));
      }
    }
    const prompt = buildWorkflow(input, references.map((image) => `${image.subfolder}/${image.filename}`), id);
    await connectMonitor();
    const job: Job = { ...input, id, promptId: "", createdAt: new Date().toISOString(), status: "queued", phase: "Queued", progress: 0, references, images: [] };
    await reserveJob(job);
    try {
      const result = await (await comfyFetch("/prompt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, client_id: clientId, extra_data: { qwen_studio: { id, ...input } } }),
      })).json() as { prompt_id?: string };
      if (!result.prompt_id) throw new Error("The image engine did not return a generation ID.");
      const submitted = { ...job, promptId: result.prompt_id };
      await saveJob(submitted);
      return Response.json(submitted, { status: 202 });
    } catch (error) {
      await saveJob({ ...job, status: "failed", phase: "Failed", error: error instanceof Error ? error.message : "Could not start generation." });
      throw error;
    }
  } catch (error) {
    console.error(error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not start generation." }, { status: 400 });
  }
}
