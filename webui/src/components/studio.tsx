"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { imageUrl, type ImageFile, type Job } from "@/lib/types";

type Reference = { id: string; url: string; name: string; file?: File; remote?: ImageFile };
const qualities = { Fast: { resolution: 512, steps: 12 }, Standard: { resolution: 1024, steps: 25 }, High: { resolution: 2048, steps: 40 } };
type Quality = keyof typeof qualities;
const ratios = [{ name: "Square", value: "1:1", x: 1, y: 1 }, { name: "Landscape", value: "4:3", x: 4, y: 3 }, { name: "Portrait", value: "3:4", x: 3, y: 4 }, { name: "Wide", value: "16:9", x: 16, y: 9 }];
const terminal = (job?: Job | null) => !job || !["queued", "running"].includes(job.status);

export default function Studio() {
  const [view, setView] = useState<"studio" | "library">("studio");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [quality, setQuality] = useState<Quality>("Standard");
  const [ratio, setRatio] = useState("1:1");
  const [seed, setSeed] = useState("");
  const [references, setReferences] = useState<Reference[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Job | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const [imageSize, setImageSize] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const previewDialog = useRef<HTMLDialogElement>(null);
  const ownedUrls = useRef(new Set<string>());
  const busy = submitting || !terminal(activeJob);
  const completed = jobs.filter((job) => job.status === "completed" && job.images.length);
  const result = selected?.images[0];

  const updateJob = useCallback((job: Job) => setJobs((old) => [job, ...old.filter((item) => item.id !== job.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))), []);

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem("qwen-studio-draft") || "{}");
      setPrompt(draft.prompt || ""); setNegativePrompt(draft.negativePrompt || "");
      if (draft.quality in qualities) setQuality(draft.quality);
      if (ratios.some((r) => r.value === draft.ratio)) setRatio(draft.ratio);
      setSeed(draft.seed || "");
    } catch { /* A fresh draft is valid when browser storage is unavailable. */ }
    setReady(true);
    fetch("/api/jobs").then((r) => r.json()).then((data: Job[]) => {
      setJobs(data);
      setSelected(data.find((job) => job.status === "completed" && job.images.length) || null);
      const active = data.find((job) => !terminal(job));
      if (active) { setActiveJob(active); setPrompt(active.prompt); setNegativePrompt(active.negativePrompt); setReferences(active.references.map((image, index) => ({ id: crypto.randomUUID(), name: `Reference ${index + 1}`, url: imageUrl(image), remote: image }))); }
    }).catch(() => setError("Your library could not be loaded."));
    const health = () => fetch("/api/health").then((r) => r.json()).then((d) => setConnected(d.connected)).catch(() => setConnected(false));
    health(); const timer = setInterval(health, 15000);
    const urls = ownedUrls.current;
    return () => { clearInterval(timer); urls.forEach(URL.revokeObjectURL); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem("qwen-studio-draft", JSON.stringify({ prompt, negativePrompt, quality, ratio, seed })); } catch { /* In-memory editing remains available. */ }
  }, [prompt, negativePrompt, quality, ratio, seed, ready]);

  useEffect(() => {
    if (!activeJob || terminal(activeJob)) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/jobs/${activeJob.id}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Reconnecting to the image engine…");
        const job: Job = await response.json();
        if (disposed) return;
        setActiveJob(job); updateJob(job); setError("");
        if (job.status === "completed") { setSelected(job); return; }
        if (job.status === "failed") { setError(job.error || "Generation failed."); return; }
        if (job.status === "cancelled") return;
      } catch (e) { if (!disposed) setError((e as Error).message); }
      if (!disposed) timer = setTimeout(poll, 1500);
    };
    poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [activeJob?.id, activeJob?.status, updateJob]);

  useEffect(() => {
    if (!activeJob || terminal(activeJob)) return;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - Date.parse(activeJob.createdAt)) / 1000)));
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [activeJob?.id, activeJob?.status]);

  function addFiles(files: File[]) {
    if (busy) return;
    setError("");
    if (references.length + files.length > 10) { setError("Use up to 10 reference images."); return; }
    if (files.some((file) => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024)) { setError("Use PNG, JPEG, or WebP images under 20 MB."); return; }
    setReferences((old) => [...old, ...files.map((file) => {
      const url = URL.createObjectURL(file); ownedUrls.current.add(url);
      return { id: crypto.randomUUID(), file, name: file.name, url };
    })]);
  }

  function removeReference(id: string) {
    const ref = references.find((image) => image.id === id);
    if (ref && ownedUrls.current.has(ref.url)) { URL.revokeObjectURL(ref.url); ownedUrls.current.delete(ref.url); }
    setReferences((old) => old.filter((image) => image.id !== id));
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
      const form = new FormData();
      form.set("settings", JSON.stringify({ prompt, negativePrompt, width: dimension(shape.x), height: dimension(shape.y), steps: preset.steps, resolution: preset.resolution, seed: chosenSeed }));
      for (const ref of references) {
        if (ref.file) form.append("images", ref.file);
        else {
          const response = await fetch(ref.url);
          if (!response.ok) throw new Error("A reference image could not be loaded.");
          form.append("images", await response.blob(), ref.remote?.filename || "reference.png");
        }
      }
      const response = await fetch("/api/generate", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start generation.");
      setActiveJob(data); updateJob(data); setView("studio"); setElapsed(0);
    } catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  }

  async function cancel() {
    if (!activeJob || stopping) return;
    setStopping(true);
    try {
      const response = await fetch(`/api/jobs/${activeJob.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setActiveJob(data); updateJob(data);
    } catch (e) { setError((e as Error).message); }
    finally { setStopping(false); }
  }

  function reuse(job: Job) {
    setPrompt(job.prompt); setNegativePrompt(job.negativePrompt); setSeed(String(job.seed));
    const q = Object.entries(qualities).find(([, value]) => value.resolution === job.resolution);
    setQuality(q ? q[0] as Quality : "Standard");
    const r = ratios.find((shape) => Math.abs(shape.x / shape.y - job.width / job.height) < 0.08);
    setRatio(r?.value || "1:1");
    references.forEach((ref) => { if (ownedUrls.current.has(ref.url)) { URL.revokeObjectURL(ref.url); ownedUrls.current.delete(ref.url); } });
    setReferences(job.references.map((image, index) => ({ id: crypto.randomUUID(), name: `Reference ${index + 1}`, url: imageUrl(image), remote: image })));
    setView("studio"); promptInput.current?.focus();
  }

  function useAsReference() {
    if (!result || busy) return;
    if (references.length >= 10) { setError("Use up to 10 reference images."); return; }
    setReferences((old) => [...old, { id: crypto.randomUUID(), name: "Generated image", url: imageUrl(result), remote: result }]);
    setView("studio"); promptInput.current?.focus();
  }

  return <>
    <header className="topbar"><div className="topbar-inner">
      <a className="wordmark" href="/" aria-label="Qwen Image home"><span className="brand-icon"><Icon name="sparkle" /></span>Qwen Image<span className="version">2.1</span></a>
      <nav aria-label="Main navigation"><button className={view === "studio" ? "nav-link selected" : "nav-link"} onClick={() => setView("studio")}>Studio</button><button className={view === "library" ? "nav-link selected" : "nav-link"} onClick={() => setView("library")}>Library{completed.length > 0 && <span className="nav-count">{completed.length}</span>}</button></nav>
    </div></header>

    <main className="main-shell">
      <div className="page-heading"><h1>{view === "studio" ? "Create." : "Your collection."}</h1><div className={`connection ${connected === false ? "offline" : ""}`} title={connected === false ? "Image engine offline" : "Connected to your local image engine"}><span />{connected === null ? "Connecting" : connected ? "On your Mac" : "Offline"}</div></div>

      {view === "studio" ? <>
        <div className="studio-grid">
          <form className={`composer ${dragging ? "dragging" : ""}`} onSubmit={(event) => { event.preventDefault(); generate(); }}
            onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); generate(); } }}
            onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}
            onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); addFiles(files); } }}>
            <div className="composer-title"><h2>{references.length ? "Image + text" : "Text to image"}</h2><span className="model-badge">Qwen 2.1</span></div>
            <div className="prompt-field"><label htmlFor="positive-prompt">Positive prompt</label><textarea ref={promptInput} id="positive-prompt" name="positivePrompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={12000} disabled={busy} spellCheck={false} aria-required="true" /></div>
            <div className="prompt-field negative"><label htmlFor="negative-prompt">Negative prompt</label><textarea id="negative-prompt" name="negativePrompt" value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} maxLength={6000} disabled={busy} spellCheck={false} /></div>
            <div className="reference-section"><div className="field-heading"><label htmlFor="reference-input">Reference images</label>{references.length > 0 && <span>{references.length}/10</span>}</div>
              <input ref={fileInput} id="reference-input" className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
              <div className="reference-list">
                {references.map((ref, index) => <div className="reference-item" key={ref.id}><img src={ref.url} alt={`Reference ${index + 1}: ${ref.name}`} /><span className="reference-number">{index + 1}</span><button type="button" className="remove-reference" aria-label={`Remove reference ${index + 1}`} onClick={() => removeReference(ref.id)} disabled={busy}><Icon name="close" width="12" height="12" /></button></div>)}
                {references.length < 10 && <button type="button" className={`add-reference ${!references.length ? "empty" : ""}`} aria-label="Add reference images" onClick={() => fileInput.current?.click()} disabled={busy}><Icon name="plus" width="22" height="22" />{!references.length && <span>Add images</span>}</button>}
              </div>
            </div>
            <div className="composer-bottom">
              <div className="options-row"><div className="select-wrap"><span className={`ratio-glyph ratio-${ratio.replace(":", "-")}`} /><select aria-label="Aspect ratio" value={ratio} onChange={(e) => setRatio(e.target.value)} disabled={busy || references.length > 0}>{references.length ? <option value={ratio}>Original</option> : ratios.map((r) => <option value={r.value} key={r.value}>{r.value}</option>)}</select><Icon name="chevron" width="14" height="14" /></div>
                <div className="select-wrap quality-select"><select aria-label="Quality" value={quality} onChange={(e) => setQuality(e.target.value as Quality)} disabled={busy}>{Object.keys(qualities).map((name) => <option key={name}>{name}</option>)}</select><Icon name="chevron" width="14" height="14" /></div>
                <button type="button" className={`icon-button settings-button ${settingsOpen ? "active" : ""}`} aria-label="Generation settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)} disabled={busy}><Icon name="sliders" /></button>
              </div>
              {settingsOpen && <div className="settings-panel"><label htmlFor="seed">Seed</label><input id="seed" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="Random" /><button type="button" className="icon-button" aria-label="Randomize seed" onClick={() => setSeed("")}><Icon name="repeat" width="17" height="17" /></button></div>}
              {error && <div className="error-message" role="alert">{error}</div>}
              <button className="generate-button" type="submit" disabled={busy || !prompt.trim() || connected === false}>{busy ? <><span className="spinner" />{submitting ? "Starting" : activeJob?.phase || "Generating"}</> : <>Generate<Icon name="arrow" /></>}</button>
            </div>
            {dragging && <div className="drop-overlay"><Icon name="plus" width="40" height="40" /></div>}
          </form>

          <section className="canvas-card" aria-label="Generated image">
            <div className={`image-stage ${busy ? "working" : ""}`}>
              {result ? <button className="image-open" aria-label="Expand generated image" onClick={() => previewDialog.current?.showModal()}><img className="result-image" src={imageUrl(result)} alt={selected?.prompt || "Generated image"} onLoad={(event) => { const image = event.currentTarget; setImageSize(`${image.naturalWidth} × ${image.naturalHeight}`); }} /></button> : <div className="empty-canvas"><span className="empty-orb"><Icon name="sparkle" width="42" height="42" /></span></div>}
              {busy && <div className="generation-overlay"><div className="progress-card" role="status" aria-live="polite"><div className="progress-top"><span className="spinner" /><span>{submitting ? "Starting" : activeJob?.phase || "Generating"}</span>{activeJob?.phase === "Generating" && activeJob.progress > 0 && <strong>{activeJob.progress}%</strong>}</div><div className="progress-track"><span className={activeJob?.progress ? "" : "indeterminate"} style={activeJob?.progress ? { width: `${activeJob.progress}%` } : undefined} /></div><div className="progress-bottom"><span>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>{!submitting && <button type="button" onClick={cancel} disabled={stopping}>{stopping ? "Stopping" : "Cancel"}</button>}</div></div></div>}
            </div>
            <div className="image-toolbar"><div className="image-meta">{result ? <>{imageSize || `${selected?.width} × ${selected?.height}`}<span>PNG</span></> : <span>Qwen Image 2.1</span>}</div><div className="image-actions">
              {selected && result && <><button className="icon-button" aria-label="Reuse prompt and settings" title="Reuse prompt" disabled={busy} onClick={() => reuse(selected)}><Icon name="repeat" width="18" height="18" /></button><button className="icon-button" aria-label="Use image as reference" title="Use as reference" disabled={busy} onClick={useAsReference}><Icon name="image" width="18" height="18" /></button><a className="download-button" href={imageUrl(result, true)} download><Icon name="download" width="17" height="17" />Download</a></>}
            </div></div>
          </section>
        </div>
        {completed.length > 0 && <section className="recent-section"><div className="section-heading"><h2>Recent</h2><button onClick={() => setView("library")}>View all<Icon name="arrow" width="16" height="16" /></button></div><div className="recent-grid">{completed.slice(0, 6).map((job) => <button key={job.id} className={`recent-image ${selected?.id === job.id ? "chosen" : ""}`} onClick={() => setSelected(job)} aria-label={`View image: ${job.prompt}`} aria-pressed={selected?.id === job.id}><img src={imageUrl(job.images[0])} alt={job.prompt} loading="lazy" /></button>)}</div></section>}
      </> : <section className="library-grid" aria-label="Image library">{completed.length ? completed.map((job) => <button className="library-image" key={job.id} onClick={() => { setSelected(job); setView("studio"); }}><img src={imageUrl(job.images[0])} alt={job.prompt} loading="lazy" /><span>{job.prompt}</span></button>) : <div className="library-empty"><Icon name="image" width="38" height="38" /><span>No images yet</span></div>}</section>}
      <footer className="footer"><span>Qwen Image Studio</span><span>Made on your Mac.</span></footer>
    </main>
    <dialog ref={previewDialog} className="image-dialog" onClick={(event) => { if (event.target === event.currentTarget) previewDialog.current?.close(); }}><button className="dialog-close icon-button" aria-label="Close image preview" onClick={() => previewDialog.current?.close()}><Icon name="close" /></button>{result && <img src={imageUrl(result)} alt={selected?.prompt || "Generated image"} />}</dialog>
  </>;
}
