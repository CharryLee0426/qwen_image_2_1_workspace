import { timingSafeEqual } from "node:crypto";
import { mutationAllowed } from "@/lib/comfy";
import { serverlessMode, sessionCookieName, sessionToken } from "@/lib/auth";

export async function POST(request: Request) {
  if (!serverlessMode) return Response.json({ ok: true });
  if (!mutationAllowed(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  const password = process.env.STUDIO_PASSWORD || "";
  const entered = String((await request.json() as { password?: string }).password || "");
  const enteredBytes = Buffer.from(entered);
  const passwordBytes = Buffer.from(password);
  if (!password || enteredBytes.length !== passwordBytes.length || !timingSafeEqual(enteredBytes, passwordBytes)) {
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }
  const response = Response.json({ ok: true });
  response.headers.set("Set-Cookie", `${sessionCookieName}=${sessionToken()}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`);
  return response;
}
