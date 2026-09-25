"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { imageUrl, type ImageFile, type Job, type Project } from "@/lib/types";
import { PHOTO_NEGATIVE_PROMPT } from "@/lib/photo-preset";

type Reference = { id: string; url: string; name: string; file?: File; remote?: ImageFile };
const qualities = { Fast: { resolution: 512, steps: 20 }, Standard: { resolution: 1024, steps: 40 }, High: { resolution: 2048, steps: 40 } };
type Quality = keyof typeof qualities;
const ratios = [{ name: "Square", value: "1:1", x: 1, y: 1 }, { name: "Landscape", value: "4:3", x: 4, y: 3 }, { name: "Portrait", value: "3:4", x: 3, y: 4 }, { name: "Wide", value: "16:9", x: 16, y: 9 }];
const terminal = (job?: Job | null) => !job || !["queued", "running"].includes(job.status);

export default function Studio() {
  const [view, setView] = useState<"studio" | "library">("studio");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftState, setDraftState] = useState<"unsaved" | "saved">("unsaved");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState(PHOTO_NEGATIVE_PROMPT);
  const [negativeLocked, setNegativeLocked] = useState(true);
  const [quality, setQuality] = useState<Quality>("Standard");
  const [ratio, setRatio] = useState("1:1");
  const [seed, setSeed] = useState("");
  const [references, setReferences] = useState<Reference[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [hostedMode, setHostedMode] = useState(false);
  const [modeLoaded, setModeLoaded] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const [imageSize, setImageSize] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [pushKey, setPushKey] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const previewDialog = useRef<HTMLDialogElement>(null);
  const ownedUrls = useRef(new Set<string>());
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const projectIds = new Set(projects.map((project) => project.id));
  const currentJob = jobsById.get(projectId);
  const busy = submitting || savingDraft || Boolean(currentJob && !terminal(currentJob));
  const completed = jobs.filter((job) => job.status === "completed" && job.images.length);
  const result = selected?.images[0];
  const projectItems = [...projects.map((project) => ({ id: project.id, project, job: jobsById.get(project.id) || null })),
    ...jobs.filter((job) => !projectIds.has(job.id)).map((job) => ({ id: job.id, project: null, job }))]
    .sort((a, b) => (b.project?.updatedAt || b.job?.createdAt || "").localeCompare(a.project?.updatedAt || a.job?.createdAt || ""));

  const updateJob = useCallback((job: Job) => setJobs((old) => {
    const existing = old.find((item) => item.id === job.id);
    const next = existing && terminal(existing) && !terminal(job) ? existing : job;
    return [next, ...old.filter((item) => item.id !== job.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }), []);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const [projectResponse, jobResponse] = await Promise.all([fetch("/api/projects", { cache: "no-store" }), fetch("/api/jobs", { cache: "no-store" })]);
        if (!projectResponse.ok || !jobResponse.ok) throw new Error("Your projects could not be loaded.");
        const savedProjects = await projectResponse.json() as Project[];
        const savedJobs = await jobResponse.json() as Job[];
        if (disposed) return;
        setProjects(savedProjects);
        setJobs(savedJobs);
        const requestedId = new URLSearchParams(location.search).get("project");
        const id = requestedId || savedJobs.find((job) => !terminal(job))?.id || savedProjects[0]?.id || savedJobs[0]?.id;
        const project = savedProjects.find((item) => item.id === id);
        const job = savedJobs.find((item) => item.id === id);
        if (project || job) {
          setProjectId(id!);
          setPrompt(project?.prompt ?? job?.prompt ?? "");
          setNegativePrompt(project?.negativePrompt ?? job?.negativePrompt ?? PHOTO_NEGATIVE_PROMPT);
          const projectQuality = project?.quality || Object.entries(qualities).find(([, value]) => value.resolution === job?.resolution)?.[0] || "Standard";
          setQuality(projectQuality as Quality);
          setRatio(project?.ratio || ratios.find((shape) => job && Math.abs(shape.x / shape.y - job.width / job.height) < 0.08)?.value || "1:1");
          setSeed(project?.seed || (job ? String(job.seed) : ""));
          const images = project?.references || job?.references || [];
          setReferences(images.map((image, index) => ({ id: crypto.randomUUID(), name: image.filename || `Reference ${index + 1}`, url: imageUrl(image), remote: image })));
          setSelected(job?.status === "completed" ? job : null);
          setDraftState(project ? "saved" : "unsaved");
        } else {
          setProjectId(crypto.randomUUID());
          try {
            const draft = JSON.parse(localStorage.getItem("qwen-studio-draft") || "{}");
            setPrompt(typeof draft.prompt === "string" ? draft.prompt : "");
            if (draft.negativePromptVersion === 2 && typeof draft.negativePrompt === "string") setNegativePrompt(draft.negativePrompt);
            if (draft.quality in qualities) setQuality(draft.quality);
            if (ratios.some((r) => r.value === draft.ratio)) setRatio(draft.ratio);
            setSeed(typeof draft.seed === "string" ? draft.seed : "");
          } catch { /* A fresh draft is valid when browser storage is unavailable. */ }
        }
      } catch (e) { if (!disposed) { setProjectId(crypto.randomUUID()); setError((e as Error).message); } }
      finally { if (!disposed) setReady(true); }
    };
    load();
    const health = () => fetch("/api/health").then((r) => { if (!r.ok) throw new Error("Health check failed."); return r.json(); }).then((d) => { setConnected(d.connected); setHostedMode(d.mode === "runpod"); setModeLoaded(true); }).catch(() => setConnected(false));
    health(); const timer = setInterval(health, 15000);
    const urls = ownedUrls.current;
    return () => { disposed = true; clearInterval(timer); urls.forEach(URL.revokeObjectURL); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem("qwen-studio-draft", JSON.stringify({ prompt, negativePrompt, negativePromptVersion: 2, quality, ratio, seed })); } catch { /* In-memory editing remains available. */ }
  }, [prompt, negativePrompt, quality, ratio, seed, ready]);

  const activeIds = jobs.filter((job) => !terminal(job)).map((job) => job.id).sort().join(",");
  useEffect(() => {
    if (!activeIds) return;
    let disposed = false;
    const poll = async () => {
      await Promise.all(activeIds.split(",").map(async (id) => {
        try {
          const response = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
          if (!response.ok) throw new Error("Reconnecting to the image engine…");
          const job = await response.json() as Job;
          if (disposed) return;
          updateJob(job);
          if (job.id === projectId && job.status !== "failed") setError("");
          if (job.id === projectId && job.status === "completed") setSelected(job);
          if (job.id === projectId && job.status === "failed") setError(job.error || "Generation failed.");
        } catch (e) { if (!disposed && id === projectId) setError((e as Error).message); }
      }));
    };
    poll();
    const timer = setInterval(poll, 2500);
    return () => { disposed = true; clearInterval(timer); };
  }, [activeIds, projectId, updateJob]);

  useEffect(() => {
    if (!currentJob || terminal(currentJob)) return;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - Date.parse(currentJob.createdAt)) / 1000)));
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [currentJob?.id, currentJob?.status, currentJob?.createdAt]);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window)) return;
    const restore = async () => {
      const response = await fetch("/api/push/key");
      const data = await response.json() as { available?: boolean; publicKey?: string };
      if (!data.available || !data.publicKey) return;
      setPushKey(data.publicKey);
      if (Notification.permission !== "granted") return;
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;
      const saved = await fetch("/api/push/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: subscription.toJSON() }) });
      if (saved.ok) setNotificationsEnabled(true);
    };
    restore().catch(() => {});
  }, []);

  async function enableNotifications() {
    if (!pushKey || !("serviceWorker" in navigator) || !("Notification" in window)) return;
    setNotificationBusy(true); setError("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Allow notifications in your browser settings to receive image updates.");
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const key = Uint8Array.from(atob(pushKey.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const response = await fetch("/api/push/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: subscription.toJSON() }) });
      if (!response.ok) throw new Error("Could not turn on notifications. Please try again.");
      setNotificationsEnabled(true);
    } catch (e) { setError((e as Error).message); }
    finally { setNotificationBusy(false); }
  }

  function clearOwnedReferences() {
    for (const ref of references) {
      if (ownedUrls.current.has(ref.url)) { URL.revokeObjectURL(ref.url); ownedUrls.current.delete(ref.url); }
    }
  }

  function openProject(project: Project | null, job: Job | null) {
    if (savingDraft || submitting) return;
    clearOwnedReferences();
    const id = project?.id || job?.id;
    if (!id) return;
    setProjectId(id);
    setPrompt(project?.prompt ?? job?.prompt ?? "");
    setNegativePrompt(project?.negativePrompt ?? job?.negativePrompt ?? PHOTO_NEGATIVE_PROMPT);
    setNegativeLocked(true);
    setQuality((project?.quality || Object.entries(qualities).find(([, value]) => value.resolution === job?.resolution)?.[0] || "Standard") as Quality);
    setRatio(project?.ratio || ratios.find((shape) => job && Math.abs(shape.x / shape.y - job.width / job.height) < 0.08)?.value || "1:1");
    setSeed(project?.seed || (job ? String(job.seed) : ""));
    setReferences((project?.references || job?.references || []).map((image, index) => ({ id: crypto.randomUUID(), name: image.filename || `Reference ${index + 1}`, url: imageUrl(image), remote: image })));
    setSelected(job?.status === "completed" ? job : null);
    setDraftState(project ? "saved" : "unsaved");
    setError(""); setView("studio");
    history.replaceState(null, "", `/?project=${encodeURIComponent(id)}`);
  }

  function newProject(copy?: Job) {
    if (savingDraft || submitting) return;
    clearOwnedReferences();
    const id = crypto.randomUUID();
    setProjectId(id);
    setPrompt(copy?.prompt || "");
    setNegativePrompt(copy?.negativePrompt ?? PHOTO_NEGATIVE_PROMPT);
    setNegativeLocked(true);
    const copiedQuality = copy && Object.entries(qualities).find(([, value]) => value.resolution === copy.resolution)?.[0];
    setQuality((copiedQuality || "Standard") as Quality);
    setRatio(copy ? ratios.find((shape) => Math.abs(shape.x / shape.y - copy.width / copy.height) < 0.08)?.value || "1:1" : "1:1");
    setSeed(copy ? String(copy.seed) : "");
    setReferences((copy?.references || []).map((image, index) => ({ id: crypto.randomUUID(), name: image.filename || `Reference ${index + 1}`, url: imageUrl(image), remote: image })));
    setSelected(null); setDraftState("unsaved"); setError(""); setView("studio");
    history.replaceState(null, "", "/");
    promptInput.current?.focus();
  }

  async function uploadDraftReference(ref: Reference): Promise<ImageFile> {
    if (ref.remote) return ref.remote;
    if (!ref.file) throw new Error("A reference image could not be opened.");
    if (hostedMode) {
      const issued = await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: ref.name, type: ref.file.type, size: ref.file.size }) });
      const upload = await issued.json() as { path?: string; putUrl?: string; filename?: string; error?: string };
      if (!issued.ok || !upload.path || !upload.putUrl || !upload.filename) throw new Error(upload.error || "Could not prepare a reference upload.");
      const sent = await fetch(upload.putUrl, { method: "PUT", headers: { "Content-Type": ref.file.type }, body: ref.file });
      if (!sent.ok) throw new Error(`Reference upload failed (${sent.status}).`);
      return { filename: upload.filename, subfolder: "", type: "input", blobPath: upload.path };
    }
    const form = new FormData(); form.set("image", ref.file);
    const response = await fetch("/api/projects/references", { method: "POST", body: form });
    const data = await response.json() as ImageFile & { error?: string };
    if (!response.ok) throw new Error(data.error || "Could not save a reference image.");
    return data;
  }

  async function saveDraft(id = projectId, seedOverride?: string): Promise<Project> {
    if (!id) throw new Error("Project is not ready yet.");
    if (!modeLoaded) throw new Error("The studio is still connecting. Try saving again in a moment.");
    setSavingDraft(true); setError("");
    try {
      const images = await Promise.all(references.map(uploadDraftReference));
      const existing = projects.find((project) => project.id === id);
      const now = new Date().toISOString();
      const draft: Project = { id, createdAt: existing?.createdAt || now, updatedAt: existing?.updatedAt || now, prompt, negativePrompt, quality, ratio: ratio as Project["ratio"], seed: seedOverride ?? seed, references: images };
      const response = await fetch(`/api/projects/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const saved = await response.json() as Project & { error?: string };
      if (!response.ok) throw new Error(saved.error || "Could not save the draft.");
      setProjects((old) => [saved, ...old.filter((project) => project.id !== id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      if (id !== projectId) setProjectId(id);
      if (seedOverride !== undefined) setSeed(seedOverride);
      setReferences((old) => old.map((ref, index) => ({ ...ref, file: undefined, remote: images[index], url: imageUrl(images[index]) })));
      for (const ref of references) {
        if (ownedUrls.current.has(ref.url)) { URL.revokeObjectURL(ref.url); ownedUrls.current.delete(ref.url); }
      }
      setDraftState("saved");
      history.replaceState(null, "", `/?project=${encodeURIComponent(id)}`);
      return saved;
    } catch (e) { setError((e as Error).message); throw e; }
    finally { setSavingDraft(false); }
  }

  function addFiles(files: File[]) {
    if (busy) return;
    setError("");
    if (references.length + files.length > 10) { setError("Use up to 10 reference images."); return; }
    if (files.some((file) => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024)) { setError("Use PNG, JPEG, or WebP images under 20 MB."); return; }
    setReferences((old) => [...old, ...files.map((file) => {
      const url = URL.createObjectURL(file); ownedUrls.current.add(url);
      return { id: crypto.randomUUID(), file, name: file.name, url };
    })]);
    setDraftState("unsaved");
  }

  function removeReference(id: string) {
    const ref = references.find((image) => image.id === id);
    if (ref && ownedUrls.current.has(ref.url)) { URL.revokeObjectURL(ref.url); ownedUrls.current.delete(ref.url); }
    setReferences((old) => old.filter((image) => image.id !== id));
    setDraftState("unsaved");
  }

  async function generate() {
    if (busy || !prompt.trim() || connected === false) return;
    setError(""); setSubmitting(true); setSettingsOpen(false);
    try {
      const preset = qualities[quality];
      const shape = ratios.find((r) => r.value === ratio)!;
      const dimension = (part: number) => Math.max(256, Math.round(preset.resolution * part / Math.max(shape.x, shape.y) / 32) * 32);
      const chosenSeed = seed.trim() ? Number(seed) : Math.floor(Math.random() * 2 ** 32);
      if (!Number.isSafeInteger(chosenSeed) || chosenSeed < 0) throw new Error("Enter a positive seed or leave it blank.");
      // A completed output keeps its own project. Generating from it starts a new picture.
      const saved = await saveDraft(currentJob ? crypto.randomUUID() : projectId, String(chosenSeed));
      const settings = { prompt, negativePrompt, width: dimension(shape.x), height: dimension(shape.y), steps: preset.steps, resolution: preset.resolution, seed: chosenSeed };
      let response: Response;
      if (hostedMode) {
        const paths = saved.references.map((ref) => {
          if (!ref.blobPath) throw new Error("A saved reference image is missing its upload.");
          return ref.blobPath;
        });
        response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings, references: paths, projectId: saved.id }) });
      } else {
        const form = new FormData();
        form.set("settings", JSON.stringify(settings));
        form.set("projectId", saved.id);
        response = await fetch("/api/generate", { method: "POST", body: form });
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start generation.");
      updateJob(data); setSelected(null); setView("studio"); setElapsed(0);
    } catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  }

  async function cancel() {
    if (!currentJob || stopping) return;
    setStopping(true);
    try {
      const response = await fetch(`/api/jobs/${currentJob.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      updateJob(data);
    } catch (e) { setError((e as Error).message); }
    finally { setStopping(false); }
  }

  function reuse(job: Job) {
    newProject(job);
  }

  function useAsReference() {
    if (!result || busy) return;
    if (references.length >= 10) { setError("Use up to 10 reference images."); return; }
    setReferences((old) => [...old, { id: crypto.randomUUID(), name: "Generated image", url: imageUrl(result), remote: result }]);
    setDraftState("unsaved");
    setView("studio"); promptInput.current?.focus();
  }

  async function downloadResult() {
    if (!result) return;
    try {
      const response = await fetch(imageUrl(result));
      if (!response.ok) throw new Error("Could not download the image.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = result.filename || "qwen-image.png";
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) { setError((e as Error).message); }
  }

  return <>
    <header className="topbar"><div className="topbar-inner">
      <a className="wordmark" href="/" aria-label="Qwen Image home"><span className="brand-icon"><Icon name="sparkle" /></span>Qwen Image<span className="version">2.1</span></a>
      <nav aria-label="Main navigation"><button className={view === "studio" ? "nav-link selected" : "nav-link"} onClick={() => setView("studio")} disabled={savingDraft || submitting}>Studio</button><button className={view === "library" ? "nav-link selected" : "nav-link"} onClick={() => setView("library")} disabled={savingDraft || submitting}>Projects{projectItems.length > 0 && <span className="nav-count">{projectItems.length}</span>}</button></nav>
    </div></header>

    <main className="main-shell">
      <div className="page-heading"><h1>{view === "studio" ? "Create." : "Your projects."}</h1><div className="heading-actions">{pushKey && !notificationsEnabled && <button className="notification-button" type="button" onClick={enableNotifications} disabled={notificationBusy}>{notificationBusy ? "Enabling…" : "Enable notifications"}</button>}{notificationsEnabled && <span className="notification-state">Notifications on</span>}<button className="new-project-button" type="button" onClick={() => newProject()} disabled={savingDraft || submitting}>+ New picture</button><div className={`connection ${connected === false ? "offline" : ""}`} title={connected === false ? "Image engine offline" : hostedMode ? "Runpod serverless is available" : "Connected to your local image engine"}><span />{connected === null ? "Connecting" : connected ? hostedMode ? "Runpod ready" : "On your Mac" : "Offline"}</div></div></div>

      {view === "studio" ? <>
        <div className="studio-grid">
          <form className={`composer ${dragging ? "dragging" : ""}`} onSubmit={(event) => { event.preventDefault(); generate(); }}
            onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); generate(); } }}
            onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}
            onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); addFiles(files); } }}>
            <div className="composer-title"><div><h2>{references.length ? "Image + text" : "Text to image"}</h2><span className="draft-state" role="status">{draftState === "saved" ? "Draft saved" : "Unsaved draft"}</span></div><button className="save-draft-button" type="button" onClick={() => { saveDraft().catch(() => {}); }} disabled={busy || !ready || !modeLoaded}>{savingDraft ? "Saving…" : "Save draft"}</button></div>
            <div className="prompt-field"><label htmlFor="positive-prompt">Positive prompt</label><textarea ref={promptInput} id="positive-prompt" name="positivePrompt" value={prompt} onChange={(e) => { setPrompt(e.target.value); setDraftState("unsaved"); }} maxLength={12000} disabled={busy} spellCheck={false} aria-required="true" placeholder="Describe the subject, setting, framing, light, and natural textures of your photograph." /><p className="prompt-hint">For a natural photo, describe what the camera sees and where the light comes from.</p></div>
            <div className={`prompt-field negative ${negativeLocked ? "locked" : ""}`}><div className="negative-heading"><label htmlFor="negative-prompt">Negative prompt <span>{negativePrompt === PHOTO_NEGATIVE_PROMPT ? "Photo preset" : "Custom"}</span></label><div className="negative-actions"><button type="button" className="negative-reset" onClick={() => { setNegativePrompt(PHOTO_NEGATIVE_PROMPT); setNegativeLocked(true); setDraftState("unsaved"); }} disabled={busy} title="Reset negative prompt to the photo preset">Reset</button><button type="button" className="negative-lock" onClick={() => setNegativeLocked((locked) => !locked)} disabled={busy} aria-label={negativeLocked ? "Unlock negative prompt" : "Lock negative prompt"} aria-pressed={!negativeLocked} title={negativeLocked ? "Unlock to edit negative prompt" : "Lock negative prompt"}><Icon name={negativeLocked ? "lock" : "unlock"} width="16" height="16" /></button></div></div><textarea id="negative-prompt" name="negativePrompt" value={negativePrompt} onChange={(e) => { if (!negativeLocked) { setNegativePrompt(e.target.value); setDraftState("unsaved"); } }} maxLength={6000} disabled={busy} readOnly={negativeLocked} aria-readonly={negativeLocked} spellCheck={false} /><p className="prompt-hint">{negativeLocked ? "Locked to prevent accidental edits. Unlock to adapt it." : "Customizing the preset. Reset restores the photo default."}</p></div>
            <div className="reference-section"><div className="field-heading"><label htmlFor="reference-input">Reference images</label>{references.length > 0 && <span>{references.length}/10</span>}</div>
              <input ref={fileInput} id="reference-input" className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
              <div className="reference-list">
                {references.map((ref, index) => <div className="reference-item" key={ref.id}><img src={ref.url} alt={`Reference ${index + 1}: ${ref.name}`} /><span className="reference-number">{index + 1}</span><button type="button" className="remove-reference" aria-label={`Remove reference ${index + 1}`} onClick={() => removeReference(ref.id)} disabled={busy}><Icon name="close" width="12" height="12" /></button></div>)}
                {references.length < 10 && <button type="button" className={`add-reference ${!references.length ? "empty" : ""}`} aria-label="Add reference images" onClick={() => fileInput.current?.click()} disabled={busy}><Icon name="plus" width="22" height="22" />{!references.length && <span>Add images</span>}</button>}
              </div>
            </div>
            <div className="composer-bottom">
              <div className="options-row"><div className="select-wrap"><span className={`ratio-glyph ratio-${ratio.replace(":", "-")}`} /><select aria-label="Aspect ratio" value={ratio} onChange={(e) => { setRatio(e.target.value); setDraftState("unsaved"); }} disabled={busy || references.length > 0}>{references.length ? <option value={ratio}>Original</option> : ratios.map((r) => <option value={r.value} key={r.value}>{r.value}</option>)}</select><Icon name="chevron" width="14" height="14" /></div>
                <div className="select-wrap quality-select"><select aria-label="Quality" value={quality} onChange={(e) => { setQuality(e.target.value as Quality); setDraftState("unsaved"); }} disabled={busy}>{Object.keys(qualities).map((name) => <option key={name}>{name}</option>)}</select><Icon name="chevron" width="14" height="14" /></div>
                <button type="button" className={`icon-button settings-button ${settingsOpen ? "active" : ""}`} aria-label="Generation settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)} disabled={busy}><Icon name="sliders" /></button>
              </div>
              {settingsOpen && <div className="settings-panel"><label htmlFor="seed">Seed</label><input id="seed" inputMode="numeric" value={seed} onChange={(e) => { setSeed(e.target.value); setDraftState("unsaved"); }} placeholder="Random" disabled={busy} /><button type="button" className="icon-button" aria-label="Randomize seed" onClick={() => { setSeed(""); setDraftState("unsaved"); }} disabled={busy}><Icon name="repeat" width="17" height="17" /></button></div>}
              {error && <div className="error-message" role="alert">{error}</div>}
              <button className="generate-button" type="submit" disabled={busy || !prompt.trim() || connected === false}>{submitting || (currentJob && !terminal(currentJob)) ? <><span className="spinner" />{submitting ? "Starting" : currentJob?.phase || "Generating"}</> : <>Generate{currentJob ? " new picture" : ""}<Icon name="arrow" /></>}</button>
            </div>
            {dragging && <div className="drop-overlay"><Icon name="plus" width="40" height="40" /></div>}
          </form>

          <section className="canvas-card" aria-label="Generated image">
            <div className={`image-stage ${busy ? "working" : ""}`}>
              {result ? <button className="image-open" aria-label="Expand generated image" onClick={() => previewDialog.current?.showModal()}><img className="result-image" src={imageUrl(result, false, true)} alt={selected?.prompt || "Generated image"} onLoad={(event) => { const image = event.currentTarget; setImageSize(`${result.width || image.naturalWidth} × ${result.height || image.naturalHeight}`); }} /></button> : <div className="empty-canvas"><span className="empty-orb"><Icon name="sparkle" width="42" height="42" /></span></div>}
              {(submitting || (currentJob && !terminal(currentJob))) && <div className="generation-overlay"><div className="progress-card" role="status" aria-live="polite"><div className="progress-top"><span className="spinner" /><span>{submitting ? "Starting" : currentJob?.phase || "Generating"}</span>{currentJob?.phase === "Generating" && currentJob.progress > 0 && <strong>{currentJob.progress}%</strong>}</div><div className="progress-track"><span className={currentJob?.progress ? "" : "indeterminate"} style={currentJob?.progress ? { width: `${currentJob.progress}%` } : undefined} /></div><div className="progress-bottom"><span>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>{!submitting && <button type="button" onClick={cancel} disabled={stopping}>{stopping ? "Stopping" : "Cancel"}</button>}</div>{currentJob && !submitting && <p className="progress-note">{notificationsEnabled ? "You can leave. We’ll notify you when it’s ready." : "You can leave and check Projects later."}</p>}</div></div>}
            </div>
            <div className="image-toolbar"><div className="image-meta">{result ? <>{imageSize || `${selected?.width} × ${selected?.height}`}<span>PNG</span></> : <span>Qwen Image 2.1</span>}</div><div className="image-actions">
              {selected && result && <><button className="icon-button" aria-label="Reuse prompt and settings" title="Reuse prompt" disabled={busy} onClick={() => reuse(selected)}><Icon name="repeat" width="18" height="18" /></button><button className="icon-button" aria-label="Use image as reference" title="Use as reference" disabled={busy} onClick={useAsReference}><Icon name="image" width="18" height="18" /></button><button className="download-button" type="button" onClick={downloadResult}><Icon name="download" width="17" height="17" />Download</button></>}
            </div></div>
          </section>
        </div>
        {completed.length > 0 && <section className="recent-section"><div className="section-heading"><h2>Recent</h2><button onClick={() => setView("library")}>View all<Icon name="arrow" width="16" height="16" /></button></div><div className="recent-grid">{completed.slice(0, 6).map((job) => <button key={job.id} className={`recent-image ${selected?.id === job.id ? "chosen" : ""}`} onClick={() => openProject(projects.find((project) => project.id === job.id) || null, job)} aria-label={`Open picture project: ${job.prompt}`} aria-pressed={projectId === job.id}><img src={imageUrl(job.images[0], false, true)} alt={job.prompt} loading="lazy" /></button>)}</div></section>}
      </> : <section className="library-grid" aria-label="Picture projects">{projectItems.length ? projectItems.map(({ id, project, job }) => <button className="library-image" key={id} onClick={() => openProject(project, job)}>{job?.status === "completed" && job.images[0] ? <img src={imageUrl(job.images[0], false, true)} alt={job.prompt} loading="lazy" /> : <span className="project-placeholder"><Icon name={job && !terminal(job) ? "sparkle" : "image"} width="40" height="40" /></span>}<span className="project-caption"><strong>{project?.prompt || job?.prompt || "Untitled picture"}</strong><small>{job?.status === "completed" ? "Ready" : job?.status === "failed" ? "Failed" : job?.status === "cancelled" ? "Cancelled" : job ? "Generating" : "Saved draft"}</small></span></button>) : <div className="library-empty"><Icon name="image" width="38" height="38" /><span>No projects yet. Save a draft or generate a picture.</span></div>}</section>}
      <footer className="footer"><span>Qwen Image Studio</span><span>{hostedMode ? "Powered by Runpod." : "Made on your Mac."}</span></footer>
    </main>
    <dialog ref={previewDialog} className="image-dialog" onClick={(event) => { if (event.target === event.currentTarget) previewDialog.current?.close(); }}><button className="dialog-close icon-button" aria-label="Close image preview" onClick={() => previewDialog.current?.close()}><Icon name="close" /></button>{result && <img src={imageUrl(result)} alt={selected?.prompt || "Generated image"} />}</dialog>
  </>;
}
