import { createHmac, timingSafeEqual } from "node:crypto";

export const serverlessMode = Boolean(process.env.RUNPOD_ENDPOINT_ID);
export const sessionCookieName = "qwen_studio_session";

export function sessionToken() {
  const password = process.env.STUDIO_PASSWORD;
  if (!password) return null;
  return createHmac("sha256", password).update("qwen-image-studio-session-v1").digest("hex");
}

export function hasSession(value: string | undefined | null) {
  if (!serverlessMode) return true;
  const expected = sessionToken();
  if (!expected || !value || value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

export function authorized(request: Request) {
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookieName}=`));
  return hasSession(cookie?.slice(sessionCookieName.length + 1));
}

export function unauthorized() {
  return Response.json({ error: "Sign in to use the studio." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
