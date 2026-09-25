import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { BlobPreconditionFailedError, get, list, put } from "@vercel/blob";
import { serverlessMode } from "./auth";
import { safeBlobPath } from "./serverless";
import type { ImageFile, Project } from "./types";

const PROJECTS_DIR = path.join(process.cwd(), ".data", "projects");
const BLOB_PREFIX = "studio/projects/";
const projectIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const qualities = ["Fast", "Standard", "High"] as const;
const ratios = ["1:1", "4:3", "3:4", "16:9"] as const;

export class ProjectValidationError extends Error {}
export class ProjectConflictError extends Error {
  constructor() { super("This draft changed elsewhere. Reload it before saving again."); }
}

export function validProjectId(id: string) { return projectIdPattern.test(id); }

function localPath(id: string) {
  if (!validProjectId(id)) throw new ProjectValidationError("Invalid project ID.");
  return path.join(PROJECTS_DIR, `${id}.json`);
}

function blobPath(id: string) {
  if (!validProjectId(id)) throw new ProjectValidationError("Invalid project ID.");
  return `${BLOB_PREFIX}${id}.json`;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProjectValidationError("Invalid project draft.");
  return value as Record<string, unknown>;
}

function reference(value: unknown, hosted: boolean): ImageFile {
  const image = record(value);
  const filename = image.filename;
  const subfolder = image.subfolder;
  const type = image.type;
  if (typeof filename !== "string" || !filename || filename.length > 255 || /[\\/\x00-\x1f]/.test(filename) || filename.includes("..") ||
      typeof subfolder !== "string" || subfolder.length > 255 || /[\\\x00-\x1f]/.test(subfolder) || subfolder.startsWith("/") || subfolder.split("/").some((part) => part === "..") ||
      (type !== "input" && type !== "output")) {
    throw new ProjectValidationError("Invalid reference image.");
  }
  const result: ImageFile = { filename, subfolder, type };
  if (hosted) {
    if (typeof image.blobPath !== "string" || !safeBlobPath(image.blobPath, type === "input" ? "reference" : "output")) {
      throw new ProjectValidationError("Invalid hosted reference image.");
    }
    result.blobPath = image.blobPath;
  } else if (image.blobPath !== undefined) {
    throw new ProjectValidationError("Hosted reference images cannot be used locally.");
  }
  if (image.previewPath !== undefined) {
    if (!hosted || type !== "output" || typeof image.previewPath !== "string" || !safeBlobPath(image.previewPath, "output")) {
      throw new ProjectValidationError("Invalid reference preview.");
    }
    result.previewPath = image.previewPath;
  }
  for (const key of ["width", "height", "bytes"] as const) {
    const number = image[key];
    if (number !== undefined) {
      if (!Number.isSafeInteger(number) || (number as number) < 1) throw new ProjectValidationError("Invalid reference image size.");
      result[key] = number as number;
    }
  }
  return result;
}

/** Parse an untrusted full draft. Timestamps are assigned when the draft is saved. */
export function validateProjectDraft(value: unknown, id: string, hosted = serverlessMode): Project {
  if (!validProjectId(id)) throw new ProjectValidationError("Invalid project ID.");
  const draft = record(value);
  if (draft.id !== id) throw new ProjectValidationError("Project ID does not match the URL.");
  if (typeof draft.prompt !== "string" || draft.prompt.length > 12_000 ||
      typeof draft.negativePrompt !== "string" || draft.negativePrompt.length > 6_000 ||
      !qualities.includes(draft.quality as Project["quality"]) ||
      !ratios.includes(draft.ratio as Project["ratio"]) ||
      typeof draft.seed !== "string" || draft.seed.length > 32 ||
      !Array.isArray(draft.references) || draft.references.length > 10) {
    throw new ProjectValidationError("Invalid project settings.");
  }
  if (draft.createdAt !== undefined && typeof draft.createdAt !== "string") throw new ProjectValidationError("Invalid project date.");
  if (draft.updatedAt !== undefined && typeof draft.updatedAt !== "string") throw new ProjectValidationError("Invalid project date.");
  return {
    id,
    createdAt: typeof draft.createdAt === "string" ? draft.createdAt : "",
    updatedAt: typeof draft.updatedAt === "string" ? draft.updatedAt : "",
    prompt: draft.prompt,
    negativePrompt: draft.negativePrompt,
    quality: draft.quality as Project["quality"],
    ratio: draft.ratio as Project["ratio"],
    seed: draft.seed,
    references: draft.references.map((image) => reference(image, hosted)),
  };
}

function savedVersion(input: Project, previous: Project | null): Project {
  if (previous && input.updatedAt !== previous.updatedAt) throw new ProjectConflictError();
  const timestamp = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
  return { ...input, createdAt: previous?.createdAt || timestamp, updatedAt: timestamp };
}

async function readLocalProject(id: string): Promise<Project | null> {
  try { return JSON.parse(await readFile(localPath(id), "utf8")) as Project; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function withLocalLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  await mkdir(PROJECTS_DIR, { recursive: true });
  const lockPath = `${localPath(id)}.lock`;
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { lock = await open(lockPath, "wx"); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try { if (Date.now() - (await stat(lockPath)).mtimeMs > 60_000) await unlink(lockPath); }
      catch (staleError) { if ((staleError as NodeJS.ErrnoException).code !== "ENOENT") throw staleError; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!lock) throw new ProjectConflictError();
  try { return await action(); }
  finally { await lock.close(); await unlink(lockPath); }
}

async function readHostedProject(id: string): Promise<{ project: Project; etag: string } | null> {
  const result = await get(blobPath(id), { access: "private", useCache: false });
  if (!result || !result.stream) return null;
  if (result.statusCode !== 200) throw new Error("Could not load the project draft.");
  return { project: await new Response(result.stream).json() as Project, etag: result.blob.etag.replace(/^W\//, "") };
}

export async function readProject(id: string): Promise<Project | null> {
  if (!validProjectId(id)) return null;
  return serverlessMode ? (await readHostedProject(id))?.project || null : readLocalProject(id);
}

export async function listProjects(): Promise<Project[]> {
  const projects: Project[] = [];
  if (serverlessMode) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: BLOB_PREFIX, limit: 1000, cursor });
      const ids = page.blobs.map((item) => item.pathname.slice(BLOB_PREFIX.length).replace(/\.json$/, ""))
        .filter((id) => validProjectId(id));
      for (let i = 0; i < ids.length; i += 20) {
        const batch = await Promise.all(ids.slice(i, i + 20).map((id) => readHostedProject(id)));
        projects.push(...batch.filter((item): item is { project: Project; etag: string } => !!item).map((item) => item.project));
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } else {
    await mkdir(PROJECTS_DIR, { recursive: true });
    const ids = (await readdir(PROJECTS_DIR)).filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -5)).filter((id) => validProjectId(id));
    projects.push(...(await Promise.all(ids.map((id) => readLocalProject(id)))).filter((item): item is Project => !!item));
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveProject(input: Project): Promise<Project> {
  if (!validProjectId(input.id)) throw new ProjectValidationError("Invalid project ID.");
  if (!serverlessMode) {
    return withLocalLock(input.id, async () => {
      const next = savedVersion(input, await readLocalProject(input.id));
      const filename = localPath(input.id);
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify(next, null, 2)); await rename(temporary, filename); }
      finally { try { await unlink(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
      return next;
    });
  }
  const previous = await readHostedProject(input.id);
  const next = savedVersion(input, previous?.project || null);
  try {
    await put(blobPath(input.id), JSON.stringify(next), {
      access: "private", contentType: "application/json", cacheControlMaxAge: 60,
      ...(previous ? { ifMatch: previous.etag } : { allowOverwrite: false }),
    });
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError || (!previous && await readHostedProject(input.id))) throw new ProjectConflictError();
    throw error;
  }
  return next;
}
