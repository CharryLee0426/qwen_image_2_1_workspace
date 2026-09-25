import { randomUUID } from "node:crypto";
import { authorized, serverlessMode, unauthorized } from "@/lib/auth";
import { mutationAllowed } from "@/lib/comfy";
import { signedBlobUrl } from "@/lib/serverless";

const types: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function POST(request: Request) {
  if (!authorized(request)) return unauthorized();
  if (!mutationAllowed(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  if (!serverlessMode) return Response.json({ error: "Direct uploads are for the hosted studio." }, { status: 400 });
  const { name, type, size } = await request.json() as { name?: string; type?: string; size?: number };
  if (!type || !types[type] || !size || size > 20 * 1024 * 1024 || size < 1) return Response.json({ error: "Use a PNG, JPEG, or WebP image under 20 MB." }, { status: 400 });
  const filename = `${randomUUID()}.${types[type]}`;
  const path = `studio/references/${randomUUID()}/${filename}`;
  const putUrl = await signedBlobUrl(path, "put", { contentType: type, maxBytes: 20 * 1024 * 1024, validForMs: 15 * 60_000 });
  return Response.json({ path, putUrl, filename, name: String(name || "Reference image").slice(0, 200) });
}
