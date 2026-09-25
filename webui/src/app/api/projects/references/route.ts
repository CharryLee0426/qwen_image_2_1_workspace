import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { authorized, serverlessMode, unauthorized } from "@/lib/auth";
import { comfyFetch, mutationAllowed } from "@/lib/comfy";
import type { ImageFile } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!authorized(request)) return unauthorized();
  if (!mutationAllowed(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  if (serverlessMode) return Response.json({ error: "Use hosted reference uploads in the cloud studio." }, { status: 400 });
  if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return Response.json({ error: "Reference image exceeds 20 MB." }, { status: 413 });
  try {
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File) || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size < 1 || file.size > 20 * 1024 * 1024) {
      return Response.json({ error: "Use a PNG, JPEG, or WebP image under 20 MB." }, { status: 400 });
    }
    let bytes: Buffer;
    try { bytes = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 }).rotate().png().toBuffer(); }
    catch { return Response.json({ error: "This reference image could not be opened." }, { status: 400 }); }
    const upload = new FormData();
    upload.set("image", new Blob([new Uint8Array(bytes)], { type: "image/png" }), `${randomUUID()}.png`);
    upload.set("subfolder", "qwen-studio");
    upload.set("type", "input");
    const result = await (await comfyFetch("/upload/image", { method: "POST", body: upload })).json() as { name?: string; subfolder?: string };
    if (!result.name || typeof result.subfolder !== "string") throw new Error("Image engine did not save the reference.");
    const image: ImageFile = { filename: result.name, subfolder: result.subfolder, type: "input" };
    return Response.json(image, { status: 201 });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Could not save the reference image." }, { status: 503 });
  }
}
