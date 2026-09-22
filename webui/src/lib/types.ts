export type GenerationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ImageFile = { filename: string; subfolder: string; type: "input" | "output" };

export type GenerationInput = {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  resolution: number;
};

export type Job = GenerationInput & {
  id: string;
  promptId: string;
  createdAt: string;
  status: GenerationStatus;
  phase: string;
  progress: number;
  references: ImageFile[];
  images: ImageFile[];
  error?: string;
  duration?: number;
};

export function imageUrl(image: ImageFile, download = false) {
  return `/api/image?${new URLSearchParams({ ...image, ...(download ? { download: "1" } : {}) })}`;
}
