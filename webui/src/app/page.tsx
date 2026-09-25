import Studio from "@/components/studio";
import Login from "@/components/login";
import { cookies } from "next/headers";
import { hasSession, sessionCookieName } from "@/lib/auth";

export default async function Home() {
  const cookie = (await cookies()).get(sessionCookieName)?.value;
  return hasSession(cookie) ? <Studio /> : <Login />;
}
