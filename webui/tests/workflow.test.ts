import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PHOTO_NEGATIVE_PROMPT } from "../src/lib/photo-preset";
import { buildWorkflow, validateInput } from "../src/lib/workflow";

const input = { prompt: "A blue ceramic teapot", negativePrompt: "", width: 1024, height: 768, steps: 25, seed: 42, resolution: 1024 };

test("v1.1 photo preset is active and matches the importable ComfyUI workflow", () => {
  const api = JSON.parse(readFileSync(new URL("../../workflows/qwen-image-2.1-q4_k_m-api.json", import.meta.url), "utf8"));
  assert.equal(api["452"].inputs.negative_prompt, PHOTO_NEGATIVE_PROMPT);
  assert.equal(api["458"].inputs.cfg, 2);
  assert.equal(api["458"].inputs.steps, 40);
  const graph = buildWorkflow({ ...input, negativePrompt: PHOTO_NEGATIVE_PROMPT, steps: 40 }, [], "photo");
  assert.equal(graph["452"].inputs.negative_prompt, PHOTO_NEGATIVE_PROMPT);
  assert.equal(graph["458"].inputs.cfg, 2);
});

test("negative prompts actually engage the negative conditioning branch", () => {
  assert.equal(buildWorkflow(input, [], "test")["458"].inputs.cfg, 1);
  const graph = buildWorkflow({ ...input, negativePrompt: "red, text" }, [], "test");
  assert.equal(graph["458"].inputs.cfg, 2);
  assert.equal(graph["452"].inputs.negative_prompt, "red, text");
  assert.deepEqual(graph["458"].inputs.negative, ["452", 1]);
});

test("references use both vision conditioning and encoded VAE latents in stable order", () => {
  const graph = buildWorkflow({ ...input, negativePrompt: "blurry" }, ["qwen-studio/one.png", "qwen-studio/two.png"], "test");
  assert.deepEqual(graph["452"].inputs.vae, ["454", 0]);
  assert.deepEqual(graph["452"].inputs["images.image_1"], ["500", 0]);
  assert.deepEqual(graph["452"].inputs["images.image_2"], ["501", 0]);
  assert.equal(graph["501"].inputs.image, "qwen-studio/two.png");
  assert.deepEqual(graph["458"].inputs.latent_image, ["452", 2]);
  assert.equal(graph["456"], undefined);
});

test("text generation retains the chosen aspect ratio", () => {
  const graph = buildWorkflow(input, [], "test");
  assert.deepEqual(graph["456"].inputs, { width: 1024, height: 768, batch_size: 1 });
  assert.equal(graph["452"].inputs.vae, undefined);
});

test("invalid job inputs are rejected before any uploads or inference", () => {
  for (const invalid of [{ prompt: " " }, { width: 1025 }, { seed: -1 }, { steps: 0 }, { resolution: 999 }]) {
    assert.throws(() => validateInput({ ...input, ...invalid }));
  }
  assert.throws(() => buildWorkflow(input, Array(11).fill("image.png"), "test"));
  assert.equal(validateInput({ ...input, prompt: "  fox  " }).prompt, "fox");
});
