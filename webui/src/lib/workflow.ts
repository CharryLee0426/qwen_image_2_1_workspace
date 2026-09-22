import type { GenerationInput } from "./types";

export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export function validateInput(value: unknown): GenerationInput {
  if (!value || typeof value !== "object") throw new Error("Invalid generation settings.");
  const v = value as Record<string, unknown>;
  if (typeof v.prompt !== "string" || !v.prompt.trim()) throw new Error("Add a prompt.");
  if (v.prompt.length > 12000 || typeof v.negativePrompt !== "string" || v.negativePrompt.length > 6000) {
    throw new Error("The prompt is too long.");
  }
  for (const name of ["width", "height"] as const) {
    if (!Number.isInteger(v[name]) || Number(v[name]) < 256 || Number(v[name]) > 2048 || Number(v[name]) % 32) {
      throw new Error("Image dimensions must be multiples of 32 between 256 and 2048.");
    }
  }
  if (!Number.isInteger(v.steps) || Number(v.steps) < 1 || Number(v.steps) > 50) throw new Error("Choose between 1 and 50 steps.");
  if (!Number.isSafeInteger(v.seed) || Number(v.seed) < 0) throw new Error("Invalid seed.");
  if (![256, 512, 1024, 2048].includes(Number(v.resolution))) throw new Error("Invalid resolution.");
  return {
    prompt: v.prompt.trim(), negativePrompt: v.negativePrompt.trim(),
    width: Number(v.width), height: Number(v.height), steps: Number(v.steps),
    seed: Number(v.seed), resolution: Number(v.resolution),
  };
}

export function buildWorkflow(input: GenerationInput, references: string[], id: string): Graph {
  if (references.length > 10) throw new Error("Use up to 10 reference images.");
  const graph: Graph = {
    "451": { class_type: "UnetLoaderGGUF", inputs: { unet_name: "qwen-image-2.1-Q4_K_M.gguf" } },
    "453": { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_8b_bf16.safetensors", type: "qwen_image", device: "default" } },
    "454": { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    "452": { class_type: "TextEncodeQwenImage21", inputs: {
      clip: ["453", 0], prompt: input.prompt, negative_prompt: input.negativePrompt, resolution: input.resolution,
    } },
    "458": { class_type: "KSampler", inputs: {
      model: ["451", 0], positive: ["452", 0], negative: ["452", 1],
      latent_image: references.length ? ["452", 2] : ["456", 0],
      seed: input.seed, steps: input.steps, cfg: input.negativePrompt ? 2 : 1,
      sampler_name: "euler", scheduler: "simple", denoise: 1,
    } },
    "457": { class_type: "VAEDecode", inputs: { samples: ["458", 0], vae: ["454", 0] } },
    "461": { class_type: "SaveImage", inputs: { images: ["457", 0], filename_prefix: `QwenStudio/${id}` } },
  };
  if (references.length) {
    graph["452"].inputs.vae = ["454", 0];
    references.forEach((image, index) => {
      const nodeId = String(500 + index);
      graph[nodeId] = { class_type: "LoadImage", inputs: { image } };
      graph["452"].inputs[`images.image_${index + 1}`] = [nodeId, 0];
    });
  } else {
    graph["456"] = { class_type: "EmptyLatentImage", inputs: { width: input.width, height: input.height, batch_size: 1 } };
  }
  return graph;
}
