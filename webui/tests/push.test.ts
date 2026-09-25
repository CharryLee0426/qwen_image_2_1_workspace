import assert from "node:assert/strict";
import { test } from "node:test";
import webPush from "web-push";
import { parsePushSubscription, vapidDetails } from "../src/lib/push";

const valid = {
  endpoint: "https://fcm.googleapis.com/fcm/send/browser-token",
  expirationTime: null,
  keys: {
    p256dh: Buffer.alloc(65, 4).toString("base64url"),
    auth: Buffer.alloc(16, 7).toString("base64url"),
  },
};

test("browser push subscription accepts a standard HTTPS push endpoint and keys", () => {
  assert.deepEqual(parsePushSubscription(valid), valid);
});

test("browser push subscription rejects arbitrary URLs and malformed keys", () => {
  assert.equal(parsePushSubscription({ ...valid, endpoint: "http://127.0.0.1/push" }), null);
  assert.equal(parsePushSubscription({ ...valid, endpoint: "https://example.com/push" }), null);
  assert.equal(parsePushSubscription({ ...valid, keys: { ...valid.keys, auth: "short" } }), null);
  assert.equal(parsePushSubscription({ ...valid, expirationTime: "tomorrow" }), null);
});

async function withPushEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const keys = ["PUBLIC_BASE_URL", "WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_VAPID_SUBJECT"];
  const old = keys.map((key) => process.env[key]);
  keys.forEach((key) => { if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key]; });
  try { await run(); }
  finally {
    keys.forEach((key, index) => {
      if (old[index] === undefined) delete process.env[key];
      else process.env[key] = old[index];
    });
  }
}

test("browser push uses a complete explicit VAPID override", async () => {
  const pair = webPush.generateVAPIDKeys();
  await withPushEnv({ WEB_PUSH_VAPID_PUBLIC_KEY: pair.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: pair.privateKey,
    WEB_PUSH_VAPID_SUBJECT: "mailto:studio@example.com" }, async () => {
    assert.deepEqual(await vapidDetails(), { ...pair, subject: "mailto:studio@example.com" });
  });
});

test("browser push derives an HTTPS subject from the deployed base URL", async () => {
  const pair = webPush.generateVAPIDKeys();
  await withPushEnv({ PUBLIC_BASE_URL: "https://studio.example.com/some/path", WEB_PUSH_VAPID_PUBLIC_KEY: pair.publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: pair.privateKey }, async () => {
    assert.deepEqual(await vapidDetails(), { ...pair, subject: "https://studio.example.com" });
  });
});

test("browser push preserves an explicit HTTPS contact URL", async () => {
  const pair = webPush.generateVAPIDKeys();
  await withPushEnv({ WEB_PUSH_VAPID_SUBJECT: "https://studio.example.com/contact", WEB_PUSH_VAPID_PUBLIC_KEY: pair.publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: pair.privateKey }, async () => {
    assert.equal((await vapidDetails())?.subject, "https://studio.example.com/contact");
  });
});

test("browser push requires a valid subject and rejects partial or mismatched key overrides", async () => {
  const pair = webPush.generateVAPIDKeys();
  const other = webPush.generateVAPIDKeys();
  await withPushEnv({}, async () => { assert.equal(await vapidDetails(), null); });
  await withPushEnv({ PUBLIC_BASE_URL: "http://localhost:3000" }, async () => { assert.equal(await vapidDetails(), null); });
  await withPushEnv({ PUBLIC_BASE_URL: "https://127.0.0.1:3000" }, async () => { assert.equal(await vapidDetails(), null); });
  await withPushEnv({ PUBLIC_BASE_URL: "https://studio.example.com", WEB_PUSH_VAPID_PUBLIC_KEY: pair.publicKey }, async () => {
    assert.equal(await vapidDetails(), null);
  });
  await withPushEnv({ PUBLIC_BASE_URL: "https://studio.example.com", WEB_PUSH_VAPID_PUBLIC_KEY: pair.publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: other.privateKey }, async () => { assert.equal(await vapidDetails(), null); });
});
