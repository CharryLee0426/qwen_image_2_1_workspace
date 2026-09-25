"use client";

import { useState } from "react";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sign in failed.");
      location.replace(`${location.pathname}${location.search}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <main className="login-shell"><form className="login-card" onSubmit={submit}>
    <span className="login-mark">✦</span><h1>Qwen Image Studio</h1><p>Enter your studio password to generate and view images.</p>
    <label htmlFor="studio-password">Password</label><input id="studio-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
    {error && <p className="error-message" role="alert">{error}</p>}
    <button className="generate-button" disabled={busy}>{busy ? "Signing in…" : "Open studio"}</button>
  </form></main>;
}
