import { COMFY_URL } from "@/lib/comfy";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const filename = query.get("filename") || "";
  const subfolder = query.get("subfolder") || "";
  const type = query.get("type") || "output";
  if (!filename || /[/\\\x00-\x1f]/.test(filename) || filename.includes("..") || /[\\\x00-\x1f]/.test(subfolder) || subfolder.split("/").some((part) => part === "..") || subfolder.startsWith("/") || !["input", "output"].includes(type)) {
    return Response.json({ error: "Invalid image." }, { status: 400 });
  }
  try {
    const response = await fetch(`${COMFY_URL}/view?${new URLSearchParams({ filename, subfolder, type })}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) return Response.json({ error: "Image not found." }, { status: 404 });
    const headers: Record<string, string> = { "Content-Type": response.headers.get("content-type") || "image/png", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" };
    if (query.has("download")) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
    return new Response(response.body, { headers });
  } catch { return Response.json({ error: "The image engine is unavailable." }, { status: 503 }); }
}
