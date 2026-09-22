import assert from "node:assert/strict";
import test from "node:test";
import { mutationAllowed } from "../src/lib/comfy";

test("browser origins match the public Host even when Next normalizes its request URL", () => {
  assert.equal(mutationAllowed(new Request("http://localhost:3000/api/generate", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } })), true);
  assert.equal(mutationAllowed(new Request("http://localhost:3000/api/generate", { headers: { host: "127.0.0.1:3000", origin: "https://example.com" } })), false);
  assert.equal(mutationAllowed(new Request("http://localhost:3000/api/generate", { headers: { origin: "null" } })), false);
});
