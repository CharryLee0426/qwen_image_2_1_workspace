export type GenerationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ImageFile = {
  filename: string;
  subfolder: string;
  type: "input" | "output";
  blobPath?: string;
  previewPath?: string;
  width?: number;
  height?: number;
  bytes?: number;
};

export type GenerationInput = {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  resolution: number;
};

export type Project = {
  id: string;
  createdAt: string;
  updatedAt: string;
  prompt: string;
  negativePrompt: string;
  quality: "Fast" | "Standard" | "High";
  ratio: "1:1" | "4:3" | "3:4" | "16:9";
  seed: string;
  references: ImageFile[];
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
  completedAt?: string;
};

export function imageUrl(image: ImageFile, download = false, preview = false) {
  const path = preview && image.previewPath ? image.previewPath : image.blobPath;
  return `/api/image?${new URLSearchParams(path ? { path, ...(download ? { download: "1" } : {}) } : { filename: image.filename, subfolder: image.subfolder, type: image.type, ...(download ? { download: "1" } : {}) })}`;
}
