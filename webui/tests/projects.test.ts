import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { serverlessMode } from "../src/lib/auth";
import { readJob, reserveJob } from "../src/lib/comfy";
import { ProjectConflictError, listProjects, saveProject, validateProjectDraft } from "../src/lib/projects";
import type { Job } from "../src/lib/types";

const id = randomUUID();
const draft = {
  id, createdAt: "", updatedAt: "", prompt: "", negativePrompt: "avoid blur", quality: "Standard", ratio: "1:1", seed: "", references: [],
};

test("drafts accept empty prompts but reject unsafe reference paths and settings", () => {
  assert.equal(validateProjectDraft(draft, id, false).prompt, "");
  assert.throws(() => validateProjectDraft({ ...draft, id: randomUUID() }, id, false));
  assert.throws(() => validateProjectDraft({ ...draft, references: Array(11).fill({ filename: "x.png", subfolder: "qwen-studio", type: "input" }) }, id, false));
  assert.throws(() => validateProjectDraft({ ...draft, references: [{ filename: "../x.png", subfolder: "qwen-studio", type: "input" }] }, id, false));
  assert.throws(() => validateProjectDraft({ ...draft, references: [{ filename: "x.png", subfolder: "", type: "input", blobPath: "studio/outputs/x.png" }] }, id, true));
  assert.equal(validateProjectDraft({ ...draft, references: [{ filename: "x.png", subfolder: "", type: "output", blobPath: "studio/outputs/x.png" }] }, id, true).references.length, 1);
});

if (!serverlessMode) test("local project saves keep every draft and reject stale revisions", async () => {
  const secondId = randomUUID();
  const file = (projectId: string) => path.join(process.cwd(), ".data", "projects", `${projectId}.json`);
  try {
    const first = await saveProject(validateProjectDraft(draft, id, false));
    const second = await saveProject(validateProjectDraft({ ...draft, id: secondId }, secondId, false));
    assert.equal(first.id, id);
    assert.equal(second.id, secondId);
    assert.ok((await listProjects()).some((project) => project.id === id));
    assert.ok((await listProjects()).some((project) => project.id === secondId));
    const updated = await saveProject({ ...first, prompt: "a photo" });
    assert.notEqual(updated.updatedAt, first.updatedAt);
    await assert.rejects(saveProject({ ...first, prompt: "a stale photo" }), ProjectConflictError);
  } finally {
    await Promise.all([unlink(file(id)).catch(() => {}), unlink(file(secondId)).catch(() => {})]);
  }
});

if (!serverlessMode) test("one picture project can reserve only one generation", async () => {
  const jobId = randomUUID();
  const file = path.join(process.cwd(), ".data", "jobs", `${jobId}.json`);
  const job: Job = { id: jobId, promptId: "", createdAt: new Date().toISOString(), prompt: "a bicycle", negativePrompt: "", width: 512, height: 512, steps: 20, seed: 1, resolution: 512, status: "queued", phase: "Queued", progress: 0, references: [], images: [] };
  try {
    await Promise.allSettled([reserveJob(job), reserveJob(job)]).then((results) => {
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    });
    assert.equal((await readJob(jobId))?.id, jobId);
  } finally { await unlink(file).catch(() => {}); }
});
