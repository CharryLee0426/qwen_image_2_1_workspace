import { createECDH, createHash } from "node:crypto";
import { isIP } from "node:net";
import { del, get, put, BlobPreconditionFailedError } from "@vercel/blob";
import webPush, { type PushSubscription, WebPushError } from "web-push";
import { sessionToken } from "./auth";
import type { Job } from "./types";

const SUBSCRIPTIONS_PATH = "studio/push/subscriptions-v1.json";
const VAPID_PATH = "studio/push/vapid-v1.json";
const MAX_SUBSCRIPTIONS = 50;

type StoredSubscription = PushSubscription & { createdAt: string; updatedAt: string; sessionVersion: string };
type SubscriptionIndex = { subscriptions: StoredSubscription[]; etag?: string };
type VapidPair = { publicKey: string; privateKey: string };
type VapidDetails = VapidPair & { subject: string };
let cachedVapid: { config: string; promise: Promise<VapidDetails | null> } | null = null;

function currentSessionVersion() {
  const token = sessionToken();
  return token ? createHash("sha256").update(token).digest("hex") : null;
}

function decodedLength(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return 0;
  return Buffer.from(value, "base64url").length;
}

function allowedPushEndpoint(endpoint: string) {
  if (endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.hash &&
      (!url.port || url.port === "443") && !!url.pathname && (
        host === "fcm.googleapis.com" || /^fcm-[a-z0-9-]+\.googleapis\.com$/.test(host) ||
        host === "updates.push.services.mozilla.com" ||
        host === "web.push.apple.com" || host.endsWith(".push.apple.com") ||
        host.endsWith(".notify.windows.com")
      );
  } catch { return false; }
}

/** Validate the browser's PushSubscription JSON before storing a push endpoint. */
export function parsePushSubscription(value: unknown): PushSubscription | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const keys = item.keys;
  if (typeof item.endpoint !== "string" || !allowedPushEndpoint(item.endpoint) ||
    !keys || typeof keys !== "object" || Array.isArray(keys)) return null;
  const record = keys as Record<string, unknown>;
  if (typeof record.p256dh !== "string" || typeof record.auth !== "string" ||
    decodedLength(record.p256dh) !== 65 || decodedLength(record.auth) !== 16) return null;
  if (item.expirationTime !== undefined && item.expirationTime !== null &&
    (typeof item.expirationTime !== "number" || !Number.isSafeInteger(item.expirationTime))) return null;
  return {
    endpoint: item.endpoint,
    expirationTime: typeof item.expirationTime === "number" ? item.expirationTime : null,
    keys: { p256dh: record.p256dh, auth: record.auth },
  };
}

function validVapidPair(pair: VapidPair) {
  if (decodedLength(pair.publicKey) !== 65 || decodedLength(pair.privateKey) !== 32) return false;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(pair.privateKey, "base64url"));
    return ecdh.getPublicKey(undefined, "uncompressed").equals(Buffer.from(pair.publicKey, "base64url"));
  } catch { return false; }
}

function vapidSubject() {
  const publicHost = (hostname: string) => hostname.includes(".") && !hostname.endsWith(".localhost") && !isIP(hostname);
  const explicit = process.env.WEB_PUSH_VAPID_SUBJECT?.trim();
  if (explicit) {
    if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/.test(explicit)) return explicit;
    try {
      const url = new URL(explicit);
      if (url.protocol === "https:" && !url.username && !url.password && !url.hash && publicHost(url.hostname)) return explicit;
    } catch { /* Invalid override. */ }
    return null;
  }
  try {
    const url = new URL(process.env.PUBLIC_BASE_URL || "");
    return url.protocol === "https:" && !url.username && !url.password && publicHost(url.hostname) ? url.origin : null;
  } catch { return null; }
}

async function readStoredVapid(): Promise<VapidPair | null> {
  const result = await get(VAPID_PATH, { access: "private", useCache: false });
  if (!result || !result.stream) return null;
  if (result.statusCode !== 200) throw new Error("Could not load browser notification keys.");
  const value = await new Response(result.stream).json() as unknown;
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const pair = { publicKey: record.publicKey, privateKey: record.privateKey };
  if (typeof pair.publicKey !== "string" || typeof pair.privateKey !== "string" || !validVapidPair(pair as VapidPair)) {
    throw new Error("Stored browser notification keys are invalid.");
  }
  return pair as VapidPair;
}

async function getOrCreateVapidPair(): Promise<VapidPair> {
  const stored = await readStoredVapid();
  if (stored) return stored;
  const generated = webPush.generateVAPIDKeys();
  try {
    await put(VAPID_PATH, JSON.stringify(generated), {
      access: "private", contentType: "application/json", allowOverwrite: false,
    });
    return generated;
  } catch (error) {
    // The first function instance creates the fixed Blob pathname; concurrent
    // instances read its winning keypair instead of using their own.
    for (let attempt = 0; attempt < 5; attempt++) {
      const winner = await readStoredVapid();
      if (winner) return winner;
      if (!(error instanceof BlobPreconditionFailedError)) break;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
    throw error;
  }
}

async function resolveVapidDetails(): Promise<VapidDetails | null> {
  const subject = vapidSubject();
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  if (!subject || Boolean(publicKey) !== Boolean(privateKey)) return null;
  const pair = publicKey && privateKey ? { publicKey, privateKey } : await getOrCreateVapidPair();
  if (!validVapidPair(pair)) return null;
  try {
    webPush.setVapidDetails(subject, pair.publicKey, pair.privateKey);
    return { subject, ...pair };
  } catch { return null; }
}

/** Auto-generates one durable private keypair unless explicit VAPID keys are set. */
export async function vapidDetails(): Promise<VapidDetails | null> {
  const config = [process.env.PUBLIC_BASE_URL, process.env.WEB_PUSH_VAPID_SUBJECT,
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY, process.env.WEB_PUSH_VAPID_PRIVATE_KEY].join("\0");
  if (cachedVapid?.config === config) return cachedVapid.promise;
  const promise = resolveVapidDetails();
  cachedVapid = { config, promise };
  try { return await promise; }
  catch (error) {
    // Storage failures are transient; a later request should try Blob again.
    if (cachedVapid?.promise === promise) cachedVapid = null;
    throw error;
  }
}

async function readSubscriptions(): Promise<SubscriptionIndex> {
  const result = await get(SUBSCRIPTIONS_PATH, { access: "private", useCache: false });
  if (!result || !result.stream) return { subscriptions: [] };
  if (result.statusCode !== 200) throw new Error("Could not load browser subscriptions.");
  const value = await new Response(result.stream).json() as { subscriptions?: unknown };
  const subscriptions = Array.isArray(value.subscriptions) ? value.subscriptions.flatMap((item) => {
    const parsed = parsePushSubscription(item);
    const createdAt = item && typeof item === "object" && typeof item.createdAt === "string" ? item.createdAt : "";
    const updatedAt = item && typeof item === "object" && typeof item.updatedAt === "string" ? item.updatedAt : "";
    const sessionVersion = item && typeof item === "object" && typeof item.sessionVersion === "string" ? item.sessionVersion : "";
    return parsed && Number.isFinite(Date.parse(createdAt)) && /^[a-f0-9]{64}$/.test(sessionVersion) ? [{ ...parsed, createdAt, updatedAt, sessionVersion }] : [];
  }) : [];
  return { subscriptions, etag: result.blob.etag.replace(/^W\//, "") };
}

async function changeSubscriptions(change: (subscriptions: StoredSubscription[]) => StoredSubscription[]) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await readSubscriptions();
    const subscriptions = change(current.subscriptions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_SUBSCRIPTIONS);
    try {
      await put(SUBSCRIPTIONS_PATH, JSON.stringify({ subscriptions }), {
        access: "private", contentType: "application/json", cacheControlMaxAge: 60,
        ...(current.etag ? { ifMatch: current.etag } : { allowOverwrite: false }),
      });
      return;
    } catch (error) {
      // The first writer creates the index; later writers use its strong ETag.
      if (!(error instanceof BlobPreconditionFailedError) && (current.etag || !(await readSubscriptions()).etag)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  throw new Error("Browser subscriptions are busy. Try again.");
}

export async function savePushSubscription(subscription: PushSubscription) {
  const sessionVersion = currentSessionVersion();
  if (!sessionVersion) throw new Error("The studio password is not configured.");
  await changeSubscriptions((subscriptions) => {
    const now = new Date().toISOString();
    const existing = subscriptions.find((item) => item.endpoint === subscription.endpoint && item.sessionVersion === sessionVersion);
    return [
      { ...subscription, createdAt: existing?.createdAt || now, updatedAt: now, sessionVersion },
      ...subscriptions.filter((item) => item.endpoint !== subscription.endpoint),
    ];
  });
}

export async function removePushSubscription(endpoint: string) {
  await changeSubscriptions((subscriptions) => subscriptions.filter((item) => item.endpoint !== endpoint));
}

async function claimNotification(jobId: string, endpoint: string) {
  const endpointHash = createHash("sha256").update(endpoint).digest("hex");
  const path = `studio/push/notified/${jobId}/${endpointHash}.json`;
  try {
    await put(path, JSON.stringify({ jobId, claimedAt: new Date().toISOString() }), {
      access: "private", contentType: "application/json", allowOverwrite: false,
    });
    return path;
  } catch (error) {
    // Creating a fixed pathname without overwrite is an atomic, durable claim.
    if (await get(path, { access: "private", useCache: false })) return null;
    throw error;
  }
}

/** Called after a completed job has been persisted. Each browser has a claim; transient failures can retry. */
export async function notifyCompletedJob(job: Job) {
  if (job.status !== "completed" || !job.completedAt || !/^[a-f0-9-]{36}$/.test(job.id)) return;
  const sessionVersion = currentSessionVersion();
  if (!sessionVersion) return;
  try {
    const vapid = await vapidDetails();
    if (!vapid) return;
    const { subscriptions: allSubscriptions } = await readSubscriptions();
    const subscriptions = allSubscriptions.filter((item) => item.sessionVersion === sessionVersion && Date.parse(item.createdAt) <= Date.parse(job.completedAt!));
    if (!subscriptions.length) return;
    const payload = JSON.stringify({ projectId: job.id, status: "completed" });
    const stale = new Set<string>();
    const results = await Promise.allSettled(subscriptions.map(async (subscription) => {
      const claim = await claimNotification(job.id, subscription.endpoint);
      if (!claim) return;
      try {
        await webPush.sendNotification(subscription, payload, {
          vapidDetails: vapid, TTL: 24 * 60 * 60, timeout: 8000, urgency: "normal", topic: job.id.replaceAll("-", ""),
        });
      } catch (error) {
        if (error instanceof WebPushError && [404, 410].includes(error.statusCode)) stale.add(subscription.endpoint);
        else {
          console.error("Could not send image notification:", error);
          // A later status request or webhook retry can try this browser again.
          await del(claim);
        }
      }
    }));
    if (results.some((result) => result.status === "rejected")) console.error("Some image notifications could not be sent.");
    if (stale.size) await changeSubscriptions((items) => items.filter((item) => !stale.has(item.endpoint)));
  } catch (error) {
    // Notification delivery must not turn a completed generation into an API error.
    console.error("Could not deliver image notifications:", error);
  }
}
